import { beforeEach, describe, expect, it } from "vitest";
import { bonusAlertLine, claimedIn, noteWeeklyBonusFrame, readWeeklyBonus, useWeeklyBonus, weekOf } from "../src/lib/weeklybonus";
import { currentWorldBoss } from "../src/lib/timers";
import { useProfiles } from "../src/lib/store";
import { line } from "./helpers";

const at = (iso: string) => Date.parse(iso);
/** 30 min after the 03:30 UTC spawn, whose boss the rotation knows for certain (Avarice). */
const AFTER_AVARICE = at("2026-10-23T04:00:00Z");

beforeEach(() => useWeeklyBonus.setState({ claimed: {} }));

describe("reading the weekly bonus off a frame", () => {
  it("takes a boss's own cache as proof, OCR slips and all", () => {
    expect(readWeeklyBonus([line("ASHAVA'S SPOILS"), line("Weekly Reward")])).toEqual({ boss: "Ashava", via: "cache" });
    expect(readWeeklyBonus([line("Wandering Deaths Spoiis")])).toEqual({ boss: "Wandering Death", via: "cache" });
    expect(readWeeklyBonus([line("Avarice's Spoils"), line("Use this cache to receive your rewards.")])).toMatchObject({ boss: "Avarice" });
  });

  it("is not fooled by the other chests that say Spoils", () => {
    for (const t of ["Spoils of Greater Equipment", "Spoils of Hell II", "Spoils of Talismans", "Spoils of Gold", "Midwinter Spoils", "Iron Wolves' Heroic Spoils"])
      expect(readWeeklyBonus([line(t)]), t).toBeNull();
    // the boss's health bar is not its cache
    expect(readWeeklyBonus([line("AVARICE, THE GOLD CURSED")])).toBeNull();
  });

  it("reads the event's tooltip, with the boss off the same frame when it's there", () => {
    expect(readWeeklyBonus([line("World Boss"), line("Weekly bonus claimed")])).toEqual({ boss: null, via: "claimed" });
    expect(readWeeklyBonus([line("Ashava, the Pestilent"), line("Weekly bonus ciaimed")])).toEqual({ boss: "Ashava", via: "claimed" });
    expect(readWeeklyBonus([line("Weekly Bonus Spoils")])).toEqual({ boss: null, via: "available" });
    // a claimed boss's tooltip may still name its reward: "claimed" wins
    expect(readWeeklyBonus([line("Weekly Bonus Spoils"), line("Weekly bonus claimed")])).toEqual({ boss: null, via: "claimed" });
  });
});

describe("remembering it per character and week", () => {
  it("a cache counts at once; the same week doesn't count twice", () => {
    noteWeeklyBonusFrame([line("Ashava's Spoils")], AFTER_AVARICE);
    const profile = useProfiles.getState().activeId;
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Ashava", AFTER_AVARICE)).toBe(true);
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Avarice", AFTER_AVARICE)).toBe(false);
    const first = useWeeklyBonus.getState().claimed[profile].Ashava.at;
    noteWeeklyBonusFrame([line("Ashava's Spoils")], AFTER_AVARICE + 60_000);
    expect(useWeeklyBonus.getState().claimed[profile].Ashava.at).toBe(first);
  });

  it("the general wording needs the spawn you're at and a second read that agrees", () => {
    const profile = useProfiles.getState().activeId;
    const claimed = () => claimedIn(useWeeklyBonus.getState().claimed, profile, "Avarice", AFTER_AVARICE);
    noteWeeklyBonusFrame([line("Weekly bonus claimed")], AFTER_AVARICE);
    expect(claimed()).toBe(false);
    noteWeeklyBonusFrame([line("Weekly bonus claimed")], AFTER_AVARICE + 2000);
    expect(claimed()).toBe(true);
  });

  // the map's event tooltip before a spawn: "World Boss / Wandering Death / REWARDS / Weekly Bonus Spoils / Begins in
  // 51 Minutes" (2026-10-25). The reward is still on offer, so it never counts as claimed and undoes a claim.
  it("a reward still on offer is never a claim, and clears one recorded by mistake", () => {
    const profile = useProfiles.getState().activeId;
    const frame = [line("World Boss"), line("Wandering Death"), line("REWARDS"), line("Weekly Bonus Spoils"), line("Begins in 51 Minutes 7 Seconds")];
    noteWeeklyBonusFrame(frame, AFTER_AVARICE);
    noteWeeklyBonusFrame(frame, AFTER_AVARICE + 2000);
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Wandering Death", AFTER_AVARICE)).toBe(false);
    useWeeklyBonus.getState().note(profile, "Wandering Death", weekOf(AFTER_AVARICE), AFTER_AVARICE);
    noteWeeklyBonusFrame(frame, AFTER_AVARICE + 4000);
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Wandering Death", AFTER_AVARICE)).toBe(false);
  });

  it("claims nothing when no spawn the frame could belong to is known", () => {
    // 2h40m after the spawn, and the 17:00 slot could be either of two bosses
    for (const t of [at("2026-10-26T11:10:00Z"), at("2026-10-22T18:00:00Z")]) {
      expect(currentWorldBoss(t)).toBeNull();
      noteWeeklyBonusFrame([line("Weekly bonus claimed")], t);
      noteWeeklyBonusFrame([line("Weekly bonus claimed")], t + 2000);
    }
    expect(useWeeklyBonus.getState().claimed).toEqual({});
  });

  it("comes back after the weekly reset", () => {
    const profile = useProfiles.getState().activeId;
    noteWeeklyBonusFrame([line("Avarice's Spoils")], AFTER_AVARICE);
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Avarice", AFTER_AVARICE)).toBe(true);
    // the assumed reset is Thursday 17:00 UTC: still the same week on Thursday morning, a new one after
    expect(weekOf(at("2026-10-29T16:00:00Z"))).toBe(weekOf(AFTER_AVARICE));
    expect(weekOf(at("2026-10-29T18:00:00Z"))).toBe(weekOf(AFTER_AVARICE) + 1);
    expect(claimedIn(useWeeklyBonus.getState().claimed, profile, "Avarice", at("2026-10-29T18:00:00Z"))).toBe(false);
  });

  it("is kept per character", () => {
    const first = useProfiles.getState().activeId;
    noteWeeklyBonusFrame([line("Ashava's Spoils")], AFTER_AVARICE);
    useProfiles.setState({ profiles: { ...useProfiles.getState().profiles, other: { id: "other", name: "Other", className: "", createdAt: 0, seenAt: 0, gear: null, sheet: null } }, activeId: "other" });
    expect(claimedIn(useWeeklyBonus.getState().claimed, "other", "Ashava", AFTER_AVARICE)).toBe(false);
    useProfiles.setState({ activeId: first });
  });
});

describe("what the alert says", () => {
  it("says the bonus is still yours until the app has seen it claimed", () => {
    expect(bonusAlertLine(["Ashava"], AFTER_AVARICE)).toBe("You still have this week's bonus.");
    noteWeeklyBonusFrame([line("Ashava's Spoils")], AFTER_AVARICE);
    expect(bonusAlertLine(["Ashava"], AFTER_AVARICE)).toBe("This week's bonus is claimed.");
    // an unsettled slot whose two bosses disagree says nothing rather than something wrong
    expect(bonusAlertLine(["Ashava", "Azmodan"], AFTER_AVARICE)).toBe("");
    expect(bonusAlertLine([""], AFTER_AVARICE)).toBe("");
  });
});
