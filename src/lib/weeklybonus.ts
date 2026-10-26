// World boss weekly bonus: the first kill of each world boss in a week pays a bonus cache, and the
// game then marks that boss as done for the week. Wording from the datamined game files:
//   items.json  Item_WE_WeeklyReward_Ashava        "Ashava's Spoils"
//               Item_WE_WeeklyReward_TreasureBeast "Avarice's Spoils"
//               Item_WE_WeeklyReward_WanderingDeath "Wandering Death's Spoils"
//               Item_WE_WeeklyReward_Azmodan       "Azmodan's Spoils"
//               Item_WE_WeeklyReward_ChiKhan       "Chi'Khan's Spoils"
//               Item_WE_WeeklyReward_Icon          "Weekly Bonus Spoils"
//   ui.json     UIToolTips.Reward_Claimed_Weekly   "Weekly bonus claimed"
//               UIToolTips.WeeklyReward            "Weekly Reward"
// It is one cache per boss per week, so each boss is remembered on its own, per character.
// Only what the app has read off the screen counts as claimed: nothing is ever concluded from a line
// that isn't there, so a bonus is never wrongly called claimed. "Not claimed yet" means "not seen yet".
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { overlayToast } from "./alerts";
import { debugEvent } from "./debug";
import { normName, trigramSim } from "./names";
import { persistStorage } from "./persist";
import { currentWorldBoss } from "./timers";
import { useProfiles } from "./store";

/**
 * The weekly reset. The game files don't hold it (it lives on Blizzard's servers), so this is an
 * assumption: community guides put the world boss bonus reset on Thursday, at 10:00 Pacific, which is
 * 17:00 UTC in summer time. WEEK_EPOCH is a Thursday 17:00 UTC; move it if your week turns elsewhere.
 * Getting it wrong only shifts when "not claimed yet" comes back, never what the app has seen.
 */
const WEEK_EPOCH = Date.UTC(2026, 0, 1, 17, 0, 0);
const WEEK_MS = 7 * 86400_000;

/** Which bonus week `t` falls in (a plain running count, so two times in one week share a number). */
export const weekOf = (t = Date.now()) => Math.floor((t - WEEK_EPOCH) / WEEK_MS);

/** When the current bonus week ends (epoch ms). */
export const weekEnds = (t = Date.now()) => WEEK_EPOCH + (weekOf(t) + 1) * WEEK_MS;

/** Each world boss's weekly cache, as the game names it. */
export const BOSS_SPOILS: Record<string, string> = {
  Ashava: "Ashava's Spoils",
  Avarice: "Avarice's Spoils",
  "Wandering Death": "Wandering Death's Spoils",
  Azmodan: "Azmodan's Spoils",
  "Chi'Khan": "Chi'Khan's Spoils",
};

/**
 * Does this line say `phrase`? Tolerates the OCR slips the rest of the app sees ("Spoiis", "ciaimed").
 * Spaces are dropped for the fuzzy pass: a missing one ("Deaths Spoils") mustn't cost the whole match.
 */
const says = (lineText: string, phrase: string) => {
  const a = normName(lineText);
  const b = normName(phrase);
  if (!b) return false;
  if (a.includes(b)) return true;
  const squash = (s: string) => s.replace(/ /g, "");
  return squash(a).includes(squash(b)) || trigramSim(squash(a), squash(b)) >= 0.78;
};

export interface BonusRead {
  /** the boss whose bonus it is, or null when only the general wording was on screen */
  boss: string | null;
  /**
   * `cache` is a boss's own cache (proof on its own); `claimed` the game's "Weekly bonus claimed", which needs the
   * spawn you're at; `available` the map's event tooltip still listing "Weekly Bonus Spoils" under its rewards,
   * which means the bonus is still to be had (2026-10-25: it was taken for a claim and marked one falsely)
   */
  via: "cache" | "claimed" | "available";
}

/** What one OCR'd frame says about the weekly bonus (an item tooltip, the map's event tooltip, the tracker). */
export function readWeeklyBonus(lines: { text: string }[]): BonusRead | null {
  for (const l of lines) for (const [boss, item] of Object.entries(BOSS_SPOILS)) if (says(l.text, item)) return { boss, via: "cache" };
  // the general wording ("Weekly bonus claimed") names no boss: take one off the same frame if it's there
  const named = lines.flatMap((l) => Object.keys(BOSS_SPOILS).filter((b) => says(l.text, b)))[0] ?? null;
  // "claimed" anywhere wins: a claimed boss's tooltip may still name the reward it gave
  if (lines.some((l) => says(l.text, "Weekly bonus claimed"))) return { boss: named, via: "claimed" };
  if (lines.some((l) => says(l.text, "Weekly Bonus Spoils"))) return { boss: named, via: "available" };
  return null;
}

// ---- what each character has claimed (persisted) ------------------------------------------

interface BonusState {
  /** character profile id → boss → the week its bonus was last seen claimed */
  claimed: Record<string, Record<string, { week: number; at: number }>>;
  note: (profile: string, boss: string, week: number, at: number) => void;
  forget: (profile: string, boss: string) => void;
}

export const useWeeklyBonus = create<BonusState>()(
  persist(
    (set) => ({
      claimed: {},
      note: (profile, boss, week, at) => set((s) => ({ claimed: { ...s.claimed, [profile]: { ...s.claimed[profile], [boss]: { week, at } } } })),
      forget: (profile, boss) =>
        set((s) => {
          const mine = { ...s.claimed[profile] };
          delete mine[boss];
          return { claimed: { ...s.claimed, [profile]: mine } };
        }),
    }),
    { name: "weekly-bonus", storage: persistStorage },
  ),
);

/** Pure form for the UI, so a React view re-renders when a bonus comes in. */
export const claimedIn = (claimed: BonusState["claimed"], profile: string, boss: string, now = Date.now()) => claimed[profile]?.[boss]?.week === weekOf(now);

/** Has the character you play been seen claiming this boss's bonus this week? */
export const bonusClaimed = (boss: string, now = Date.now(), profile = useProfiles.getState().activeId) => claimedIn(useWeeklyBonus.getState().claimed, profile, boss, now);

/** The world boss alert's extra line; "" when the bosses of an unsettled slot disagree. */
export function bonusAlertLine(bosses: string[], now = Date.now()): string {
  const states = bosses.filter(Boolean).map((b) => bonusClaimed(b, now));
  if (!states.length) return "";
  if (states.every((x) => x)) return "This week's bonus is claimed.";
  if (states.every((x) => !x)) return "You still have this week's bonus.";
  return "";
}

// ---- reading it off the screen -------------------------------------------------------------

/** a reading that needs a second one to agree (the general wording alone is no proof) */
let pending: { boss: string; at: number } | null = null;

/**
 * One OCR'd frame, from the scans the app already makes. A boss's own cache name is proof by itself;
 * the general wording has to be matched to the spawn you're at and read twice, so a stray line or a
 * tooltip glimpsed on the way past never claims a bonus.
 */
export function noteWeeklyBonusFrame(lines: { text: string }[], now = Date.now()) {
  const read = readWeeklyBonus(lines);
  if (!read) return;
  const boss = read.boss ?? currentWorldBoss(now);
  if (!boss) return void debugEvent("weeklybonus", "unattributed", { via: read.via, why: "no world boss spawn this frame could belong to" });
  const profile = useProfiles.getState().activeId;
  const known = claimedIn(useWeeklyBonus.getState().claimed, profile, boss, now);
  // the game still offers the bonus: it isn't claimed, whatever was recorded
  if (read.via === "available") {
    if (!known) return;
    useWeeklyBonus.getState().forget(profile, boss);
    return void debugEvent("weeklybonus", "unclaimed", { boss, why: "the event still lists Weekly Bonus Spoils" });
  }
  if (known) return;
  if (read.via !== "cache" && !(pending && pending.boss === boss && now - pending.at <= 60_000)) {
    pending = { boss, at: now };
    return void debugEvent("weeklybonus", "pending", { boss, via: read.via, why: "waiting for a second read to agree" });
  }
  pending = null;
  const week = weekOf(now);
  useWeeklyBonus.getState().note(profile, boss, week, now);
  debugEvent("weeklybonus", "claimed", { boss, via: read.via, week });
  overlayToast("Weekly bonus: got it", `${boss}: this week's bonus cache is yours.`, "#d4ad62", 8000);
}

/** What the weekly bonus tracking believes right now (debug snapshot). */
export function weeklyBonusDebug(now = Date.now()) {
  const profile = useProfiles.getState().activeId;
  const mine = useWeeklyBonus.getState().claimed[profile] ?? {};
  return {
    week: weekOf(now),
    weekEndsInH: Math.round(((weekEnds(now) - now) / 3600_000) * 10) / 10,
    spawnBoss: currentWorldBoss(now),
    claimed: Object.keys(BOSS_SPOILS).filter((b) => mine[b]?.week === weekOf(now)),
    pending: pending && { boss: pending.boss, agoS: Math.round((now - pending.at) / 1000) },
  };
}
