// Dungeon tracker text (Nightmare Dungeons, the Pit): the objective lines OCR a little differently on
// every read ("Seaborn" / "Seabom", the dungeon name or a damage number glued on, specks of icons).
// These helpers tell a real objective change from a misread.
import { trigramSim } from "./names";

/** "Dungeon cleared", OCR slips included ("Duhgeon cleared V", "Dungeon'Cleared"). */
export const isDungeonCleared = (text: string) => /d[a-z]{1,3}geon\W{0,2}c[il1]eared/i.test(text);

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
