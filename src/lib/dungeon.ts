// Dungeon tracker text (Nightmare Dungeons, the Pit): the objective lines OCR a little differently on
// every read ("Seaborn" / "Seabom", the dungeon name or a damage number glued on, specks of icons).
// These helpers tell a real objective change from a misread.
import { trigramSim } from "./names";

/** "Dungeon cleared", OCR slips included ("Duhgeon cleared V", "Dungeon'Cleared"). */
export const isDungeonCleared = (text: string) => /d[a-z]{1,3}geon\W{0,2}c[il1]eared/i.test(text);

export type NmdKind = "Nightmare Dungeon" | "Escalating Nightmare" | "Minor Nightmare";

/** The tracker line under the objective that names the run ("Nightmare Escalation Tier 2", "Minor Nightmare"). */
export const nightmareKind = (marker: string): NmdKind | null =>
  /^\W*nightmare dungeon\W*$/i.test(marker)
    ? "Nightmare Dungeon"
    : /^\W*nightmare\s*escalat/i.test(marker)
      ? "Escalating Nightmare"
      : /^\W*minor\s*nightmare\W*$/i.test(marker)
        ? "Minor Nightmare"
        : null;

/** A Minor Nightmare (the Chronicle's runs through old dungeons) ends on "Nightmare Cleansed" instead. */
export const isNightmareCleansed = (text: string) => /nightmare\W{0,2}c[il1]eansed/i.test(text);

/** A pickup notice floating over the tracker ("16 Veiled Crystals"), alone or glued to the dungeon name. */
export const stripPickup = (text: string) => text.replace(/^\d[\d,]*\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?\s*(?=$|\S.*\s-\s)/, "").trim();

export interface Objective {
  /** the words, lowercased, without numbers or junk ("destroy the seaborn shrine") */
  words: string;
  /** the count left ("…Shrine: 2" → 2), if any */
  count: number | null;
  /** tidy text to show as a split label */
  label: string;
}

/**
 * Clean one read of an objective. `dungeon` is dropped when the read starts with it ("Submerged Ruins
 * Destroy the …"). null for reads with too few letters to mean anything.
 */
export function readObjective(text: string, dungeon = ""): Objective | null {
  let t = text.replace(/\s+/g, " ").trim();
  // a damage number or icon junk in front ("1,880M Submekged Ruins Travel to …", "(227) (l 'ism A-' Destroy …")
  const verb = t.search(/\b(destroy|travel|slay|defeat|kill|deposit|collect|find|free|activate|open|escort|survive|cleanse|rescue|clear|dungeon cleared)\b/i);
  if (verb > 0) t = t.slice(verb);
  else if (dungeon) {
    const words = t.split(" ");
    const n = dungeon.split(" ").length;
    if (words.length > n && trigramSim(words.slice(0, n).join(" "), dungeon) >= 0.5) t = words.slice(n).join(" ");
  }
  const count = t.match(/(\d{1,3})\W*$/);
  const words = t
    .toLowerCase()
    .replace(/\d+/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (words.replace(/ /g, "").length < 6) return null;
  const label = t.replace(/[^A-Za-z0-9:' -]+/g, " ").replace(/\s+/g, " ").replace(/[\s:-]+$/, "").trim();
  return { words, count: count ? Number(count[1]) : null, label: (count ? label.replace(/\s*:?\s*\d{1,3}$/, `: ${count[1]}`) : label).slice(0, 40) };
}

/** Two reads of the same objective (same words, give or take OCR slips)? */
export const sameWords = (a: Objective, b: Objective) => a.words === b.words || trigramSim(a.words, b.words) >= 0.6;

/** The same objective at the same step: a misread of what's already shown. */
export const sameObjective = (a: Objective, b: Objective) => sameWords(a, b) && a.count === b.count;

/** What the run shows as its current objective, and a different read waiting for a second one to agree. */
export interface ObjectiveState {
  objective: Objective | null;
  pending: Objective | null;
}

// ---- pop-up events inside a dungeon ----
// They get their own block on the tracker, under the dungeon's ("Submerged Ruins / Destroy the Seaborn Shrine: 1 /
// Nightmare Dungeon / Cursed Shrine", 2026-10-11), with a countdown and maybe a "Mastery:" objective; a failed
// one reads "… Failed" like the Pit's masteries. Names from the game files (Quest_DE_*, Quest_Dungeon_ME_*, the
// Undercity's beacon).
export const DUNGEON_EVENTS = [
  "Altar of Bishibosh",
  "Cursed Chest",
  "Cursed Shrine",
  "Cursed Well",
  "Demon Vessel",
  "Eternal Torment",
  "Grand Spirit Beacon",
  "Hostage",
  "Immolation",
  "Impromptu Investigation",
  "Last Stand",
  "Legion",
  "Nest",
  "Potent Blood",
  "Ravenous Soul",
  "Rest For The Weary",
  "Ritual of Blood",
  "Rupture",
  "Sanguine Battery",
  "Shrine of Zagraal",
  "Sole Survivor",
  "Tides of Blood",
  "Toll of the Deep",
];

/** An event's name line ("Cursed Shrine", "Nest •", "Impromptu lnvestigation"): the event, or null. */
export function eventName(text: string): string | null {
  const t = text.replace(/^[^A-Za-z]+|[^A-Za-z]+$/g, "");
  if (t.length < 4 || t.length > 30) return null;
  for (const e of DUNGEON_EVENTS) {
    // short names must match whole ("Nest" is in "Nesting", "Legion" in "Legion 10:00 PM")
    if (e.length <= 7 ? t.toLowerCase() === e.toLowerCase() : trigramSim(t, e) >= 0.7) return e;
  }
  return null;
}

/** where a quest block other than the event's starts (the next one down the tracker) */
const NEXT_BLOCK = /^\W*(nightmare\s*(dungeon|escalat)|minor\s*nightmare|conquer\s|purge\s|report\s*to|war\s*plans?|priority\s*quest|torment\b|fl[o0]{2}r\W*$)/i;

export interface DungeonEvent {
  name: string;
  /** a "Mastery:" objective is on it */
  mastery: boolean;
  /** "… Failed" shows on it (a mastery that can't be met any more) */
  failed: boolean;
  /** the countdown, if read */
  secondsLeft: number | null;
  /** which tracker lines are the event's (they're never the dungeon's objective) */
  lines: number[];
}

/** The event block on the tracker, if one is up. */
export function readDungeonEvent(lines: { text: string }[]): DungeonEvent | null {
  const i = lines.findIndex((l) => eventName(l.text));
  if (i < 0) return null;
  const own = [i];
  for (let k = i + 1; k < Math.min(lines.length, i + 7); k++) {
    if (NEXT_BLOCK.test(lines[k].text.trim()) || eventName(lines[k].text)) break;
    own.push(k);
  }
  const block = own.map((k) => lines[k].text);
  const timer = block.map((t) => t.match(/(?:^|[^\d])(\d{1,2})\s*[:.]\s*(\d{2})\W*$/)).find(Boolean);
  return {
    name: eventName(lines[i].text)!,
    mastery: block.some((t) => /mast[e3]r[yv]/i.test(t)),
    failed: block.some((t) => /fa[il1]{2}ed/i.test(t)),
    secondsLeft: timer ? Number(timer[1]) * 60 + Number(timer[2]) : null,
    lines: own,
  };
}

/** An event being timed. */
export interface EventRun {
  name: string;
  start: number;
  lastSeen: number;
  reads: number;
  mastery: boolean;
  failed: boolean;
  /** reads in a row with the dungeon's block up but no event */
  gone: number;
}

/** An event that ended: one split for it. `mastery`: null when it had no mastery objective. */
export interface EventDone {
  name: string;
  start: number;
  end: number;
  mastery: "met" | "failed" | null;
}

/**
 * Feed one tracker read while the dungeon's block is up (`read` null = no event on it). The event ends when two
 * reads in a row don't show it; it ends when it was last seen. One read of a name isn't an event.
 */
export function stepEvent(cur: EventRun | null, read: DungeonEvent | null, now: number): { run: EventRun | null; done: EventDone | null } {
  if (read && cur && read.name === cur.name) {
    cur.lastSeen = now;
    cur.reads++;
    cur.gone = 0;
    cur.mastery ||= read.mastery;
    cur.failed ||= read.failed;
    return { run: cur, done: null };
  }
  if (read) return { run: { name: read.name, start: now, lastSeen: now, reads: 1, mastery: read.mastery, failed: read.failed, gone: 0 }, done: cur ? closeEvent(cur) : null };
  if (!cur) return { run: null, done: null };
  if (++cur.gone < 2) return { run: cur, done: null };
  return { run: null, done: closeEvent(cur) };
}

/** End an event (when it's gone, or the run ends): null when it was only a stray read. */
export function closeEvent(e: EventRun): EventDone | null {
  if (e.reads < 2) return null;
  return { name: e.name, start: e.start, end: e.lastSeen, mastery: e.failed ? "failed" : e.mastery ? "met" : null };
}

/** The split's label: "Cursed Shrine: mastery met". */
export const eventLabel = (e: EventDone) => `${e.name}${e.mastery ? `: mastery ${e.mastery}` : ""}`;

/**
 * Feed one read. Returns the objective that just finished (split there) when two reads in a row
 * agree on something new; a lone misread only waits as `pending` and is forgotten.
 */
export function stepObjective(s: ObjectiveState, read: Objective | null): Objective | null {
  if (!read) return null;
  if (!s.objective) {
    s.objective = read;
    return null;
  }
  if (sameObjective(read, s.objective)) {
    s.pending = null;
    return null;
  }
  if (s.pending && sameObjective(read, s.pending)) {
    const done = s.objective;
    s.objective = read;
    s.pending = null;
    return done;
  }
  s.pending = read;
  return null;
}
