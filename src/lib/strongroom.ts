// Horadric Strongroom: a sealed chamber behind a portal inside a Nightmare Dungeon. It has its own
// quest block on the tracker, and every line of it comes from the game files
// (quests.json, Quest_SEC_Unique_Template_EncounterName):
//   Name / Toast        "Horadric Strongroom"
//   Callback2Header     "Slay Monsters for Horadric Attunement"
//   Callback62Header    "Invoke {DONE_OVER_NEEDED} Horadric Statues"
//   Callback73Header    "Enter the Main Chamber"
//   Callback239Header   "Enter the Artifact Pillar Room"
//   Callback249Header   "Slay the Strongroom Boss"
//   Callback251Header   "Redeem your rewards at Horadric Cache"
//   Callback237Header   "Exit the Strongroom via the Portal"
//   Callback295Header   "Reward Upgrades ({...}/6)"
//   Callback299Header   "Death penalty: {...}s"
// Not read here: the Horadric Attunement total (it floats over the world as "+8 Attunement", not on the
// tracker) and the chamber's time limit (a bare mm:ss on the tracker can just as well be a Legion's clock
// or a dungeon event's countdown, so it is left alone rather than guessed at).
// OCR slips are tolerated the way the Undercity's reader does it.
import type { OcrLine } from "./native";

export type StrongroomStage = "attunement" | "statues" | "main" | "pillar" | "boss" | "redeem" | "exit";

type Line = Pick<OcrLine, "text"> & Partial<Pick<OcrLine, "x" | "y" | "w" | "h">>;

/**
 * One objective line of the block: its stage, its pattern and the label a split gets. The order is our
 * reading of how a chamber runs, and the furthest line showing wins: "Slay Monsters for Horadric
 * Attunement" stands for the whole chamber, so a step after it is what you are on now.
 */
const STAGES: { stage: StrongroomStage; re: RegExp; label: string }[] = [
  { stage: "attunement", re: /m[o0]nsters\s*f[o0]r\s*h[o0]rad/i, label: "Attunement" },
  { stage: "statues", re: /[il1]nv[o0]ke\b|h[o0]radr?[il1]c\s*statues/i, label: "Statues" },
  { stage: "main", re: /enter\s*the\s*ma[il1]n\s*chamber/i, label: "Main Chamber" },
  { stage: "pillar", re: /art[il1]fact\s*p[il1]+ar\s*r[o0]{2}m/i, label: "Artifact Pillar Room" },
  { stage: "boss", re: /s[il1]ay\s*the\s*str[o0]ng\W?r[o0]{2}m\s*b[o0]ss/i, label: "Strongroom Boss" },
  { stage: "redeem", re: /redeem\s*y[o0]ur\s*rewards/i, label: "Rewards redeemed" },
  { stage: "exit", re: /ex[il1]t\s*the\s*str[o0]ng\W?r[o0]{2}m/i, label: "Left the Strongroom" },
];

/** The block's name line, and the word only this activity uses. */
const NAME = /str[o0]ng\W?r[o0]{2}m|h[o0]radr?[il1]c\s*(?:at+une|statues)/i;

export interface StrongroomHud {
  /** what the tracker asks for now (the first objective of the block that reads) */
  stage: StrongroomStage | null;
  /** the split's label for it ("Statues 2/3", "Main Chamber") */
  label: string;
  /** "Invoke 2/3 Horadric Statues" */
  statues: { done: number; needed: number } | null;
  upgrades: number | null;
  upgradesMax: number;
  /** "Death penalty: 10s" (it grows with every death in the chamber) */
  deathPenalty: number | null;
  /** the boss objective is up */
  boss: boolean;
  /** the rewards are open: redeem at the cache, or leave through the portal */
  done: boolean;
}

/**
 * Is this tracker the Strongroom's block? The name alone isn't enough: a Nightmare Sigil's affix reads
 * "This place will always contain a Horadric Strongroom" and its tooltip can sit over the tracker (the
 * Chronicle of Nightmares did exactly that, 2026-10-16 test). One of the block's own objectives is needed.
 */
export function inStrongroom(lines: Line[]): boolean {
  const text = lines.map((l) => l.text).join("\n");
  if (!NAME.test(text)) return false;
  return STAGES.some((s) => s.re.test(text)) || /reward\s*up[\s-]*grades?/i.test(text);
}

export function parseStrongroom(lines: Line[]): StrongroomHud | null {
  if (!inStrongroom(lines)) return null;
  const text = lines.map((l) => l.text).join("\n");
  const hit = STAGES.filter((s) => s.re.test(text));
  // "Invoke 2/3 Horadric Statues": the count can be split off its line, so it is taken from the block
  const st = text.match(/[il1]nv[o0]ke\D{0,4}(\d)\s*\/\s*(\d)/i) ?? text.match(/(\d)\s*\/\s*(\d)\s*h[o0]radr?[il1]c\s*statues/i);
  const statues = st ? { done: Number(st[1]), needed: Math.max(1, Number(st[2])) } : null;
  // same shapes as the Undercity's ("Rewqrd Upgrades", "Up-grades,(2/4")
  const up = text.match(/up[\s-]*grades?\W*\(?\s*(\d)\s*\/\s*(\d)/i) ?? text.match(/(\d)\s*\/\s*(\d)\)\W*\n\W*reward\s*up/i);
  const dp = text.match(/death\s*pena[il1]ty\W*(\d{1,3})\s*s/i);
  const cur = hit[hit.length - 1];
  const stage = cur?.stage ?? null;
  const label = stage === "statues" && statues ? `Statues ${statues.done}/${statues.needed}` : cur?.label ?? "";
  return {
    stage,
    label,
    statues,
    upgrades: up ? Number(up[1]) : null,
    upgradesMax: up ? Number(up[2]) : 6,
    deathPenalty: dp ? Number(dp[1]) : null,
    boss: hit.some((h) => h.stage === "boss"),
    done: hit.some((h) => h.stage === "redeem" || h.stage === "exit"),
  };
}

/** What a read means for the run being timed: its own key, so a repeat of the same step is ignored. */
export const stageKey = (h: StrongroomHud) => `${h.stage ?? "-"}|${h.label}`;

// ---- timing a chamber ----------------------------------------------------------------------

/** A chamber being timed. `own`: the app runs the clock for it, because nothing else was being timed. */
export interface StrongroomRun {
  start: number;
  lastSeen: number;
  reads: number;
  stage: StrongroomStage | null;
  label: string;
  /** `stageKey` of the step showing now, so a repeat read is not a step */
  key: string;
  statues: { done: number; needed: number } | null;
  upgrades: number;
  upgradesMax: number;
  deathPenalty: number | null;
  /** the boss objective was on the tracker at some point */
  sawBoss: boolean;
  own: boolean;
  /** reads in a row with the rewards open */
  doneReads: number;
  /** rebuilt after a restart mid-chamber: the first read is taken as it stands, with no splits */
  resumed?: boolean;
}

export interface StrongroomTracker {
  run: StrongroomRun | null;
  /** when the last chamber ended: its exit objective lingers on the tracker and mustn't start another */
  endSeen: number;
}

export type StrongroomAction =
  | { kind: "start"; at: number; own: boolean; stage: StrongroomStage | null }
  /** `label` is the step that just finished (the split), `next` the one you are on now */
  | { kind: "step"; label: string; next: string; moved: boolean }
  | { kind: "upgrade"; from: number; to: number; max: number }
  | { kind: "finish"; cleared: boolean; at: number; from: number; why: string; own: boolean; upgrades: number; max: number; stage: StrongroomStage | null }
  /** too short to have been a chamber (the tail of one that was already over): drop it */
  | { kind: "discard"; why: string; own: boolean };

/** the tracker hides behind the map, the bag and loading screens: only this long without it means you left */
export const STRONGROOM_GONE_MS = 60_000;
/** a chamber takes minutes; anything shorter was over before the app looked */
export const STRONGROOM_MIN_MS = 20_000;

/**
 * Feed one tracker read (null = no Strongroom block on it). Returns what to do with the run timer:
 * start on the second read (one read of a sigil's affix text isn't a chamber), a step for each
 * objective, a reward upgrade when the count rises, and finish when the rewards are open or the
 * block has been gone for good. `canStart` is false while another activity owns the clock: the
 * chamber is then timed anyway, as one split inside that run.
 */
export function stepStrongroom(t: StrongroomTracker, read: StrongroomHud | null, now: number, canStart = true): StrongroomAction[] {
  const out: StrongroomAction[] = [];
  const s = t.run;
  if (!read) {
    // gone for good: the chamber ends where it was last seen, cleared only if its boss was on the tracker
    if (s && now - s.lastSeen > STRONGROOM_GONE_MS) {
      out.push(...endRun(s, s.sawBoss, s.lastSeen, "the block was gone for 60 s"));
      t.run = null;
    }
    return out;
  }
  if (!s) {
    if (t.endSeen && now - t.endSeen < 60_000) return out;
    t.run = {
      start: now,
      lastSeen: now,
      reads: 1,
      stage: read.stage,
      label: read.label,
      key: stageKey(read),
      statues: read.statues,
      upgrades: read.upgrades ?? 0,
      upgradesMax: read.upgradesMax,
      deathPenalty: read.deathPenalty,
      sawBoss: read.boss,
      own: false,
      doneReads: 0,
    };
    return out;
  }
  s.lastSeen = now;
  s.reads++;
  s.sawBoss ||= read.boss;
  s.upgradesMax = read.upgradesMax;
  if (read.deathPenalty != null) s.deathPenalty = read.deathPenalty;
  if (s.resumed) {
    s.resumed = false;
    s.stage = read.stage;
    s.label = read.label;
    s.key = stageKey(read);
    s.upgrades = read.upgrades ?? s.upgrades;
    return out;
  }
  // walking in on the leftover exit objective of a finished chamber starts nothing
  if (s.reads === 2 && !read.done) {
    s.own = canStart;
    out.push({ kind: "start", at: s.start, own: s.own, stage: read.stage });
  }
  // the rewards are open: two reads in a row, so one misread line never ends the chamber early
  if (read.done) {
    if (++s.doneReads >= 2) {
      out.push(...endRun(s, true, now, "the rewards are open (redeem or exit)"));
      t.run = null;
      t.endSeen = now;
    }
    return out;
  }
  s.doneReads = 0;
  const key = stageKey(read);
  if (read.stage && key !== s.key) {
    out.push({ kind: "step", label: s.label, next: read.label, moved: read.stage !== s.stage });
    s.key = key;
    s.stage = read.stage;
    s.label = read.label;
    s.statues = read.statues;
  }
  if (read.upgrades != null && read.upgrades > s.upgrades && read.upgrades <= read.upgradesMax) {
    out.push({ kind: "upgrade", from: s.upgrades, to: read.upgrades, max: read.upgradesMax });
    s.upgrades = read.upgrades;
  }
  return out;
}

function endRun(s: StrongroomRun, cleared: boolean, at: number, why: string): StrongroomAction[] {
  if (s.reads < 2) return [];
  if (at - s.start < STRONGROOM_MIN_MS) return [{ kind: "discard", why, own: s.own }];
  return [{ kind: "finish", cleared, at, from: s.start, why, own: s.own, upgrades: s.upgrades, max: s.upgradesMax, stage: s.stage }];
}
