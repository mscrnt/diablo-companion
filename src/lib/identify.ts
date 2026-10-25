// Which unique is this? Several independent signals, so one bad read (a mangled title, a cut-off power, two
// uniques that share their icon) doesn't decide alone:
//   - the item type from the type line filters the candidates ("Gloves", "Two-Handed Mace")
//   - title: the OCR'd name against each unique's name
//   - power: the unique power text against each unique's power description
//   - stats: the stats this unique always rolls (Paingorger's: Primary Core Stat, Attack Speed) against the read lines
//   - icon (optional): the item art's similarity to each unique's icon, from the icon recogniser
import { normName, normStat, similarity, table, titleSimilarity, typeMatches } from "./names";

export interface IdentifyInput {
  /** the title as read, possibly garbled; "" when the capture missed it */
  title: string;
  /** the type line ("Ancestral Unique Gloves") */
  itemType: string;
  /** the unique power text as read */
  power: string;
  /** the stat lines as read */
  stats: string[];
  /** the player's class (a class unique for another class can't drop for them) */
  className?: string;
  /** icon similarity per unique name (0..1 cosine), when icon recognition is on */
  icon?: Record<string, number>;
}

export interface Candidate {
  name: string;
  score: number;
  parts: { title: number; power: number; stats: number; icon: number | null };
}

/**
 * Weights for the signals, and the cosines the icon signal is read between (tuned on the
 * 2026-10-12 and 2026-10-17 test sets; see scripts/dev/identify-eval.ts and icon-eval.ts).
 *
 * `icon` stays below `power`: the picture is a second opinion that can break a tie the text can't,
 * never the deciding vote against a unique power that was read whole. Measured on 187 real tooltip
 * crops: the right unique's art scores about 0.84, another unique's about 0.72, and the worst false
 * high about 0.83, so `iconFloor` throws away the noise and the weight keeps the rest in its place.
 */
export const WEIGHTS = { title: 1, power: 0.7, stats: 0.35, icon: 0.6, iconFloor: 0.8, iconTop: 0.94 };

const MAIN = /\b(strength|intelligence|dexterity|willpower)\b/i;

/** How many of a unique's fixed stats show up in the read lines, 0..1. */
function statsScore(listed: string[] | undefined, lines: string[]): number {
  if (!listed?.length || !lines.length) return 0;
  let hit = 0;
  for (const s of listed) {
    const want = normStat(s);
    const found = /primary core stat/i.test(s) ? lines.some((l) => MAIN.test(l)) : lines.some((l) => similarity(normStat(l), want) >= 0.6);
    if (found) hit++;
  }
  return hit / listed.length;
}

/** An icon cosine (about 0.72 for unrelated art, 1 for the same picture) as 0..1. */
const iconScore = (cos: number | undefined, w: typeof WEIGHTS) =>
  cos == null ? 0 : Math.max(0, Math.min(1, (cos - w.iconFloor) / (w.iconTop - w.iconFloor)));

/** Candidates for the item, best first. */
export function identifyUnique(inp: IdentifyInput, w = WEIGHTS): Candidate[] {
  const all = Object.values(table("uniques")).filter((u) => !u.x);
  const typed = inp.itemType ? all.filter((u) => u.t && typeMatches(u.t, inp.itemType)) : [];
  const pool = (typed.length ? typed : all).filter((u) => !inp.className || !u.c || normName(u.c) === normName(inp.className));
  const out: Candidate[] = [];
  for (const u of pool) {
    const title = inp.title.trim() ? titleSimilarity(inp.title, u.n) : 0;
    const power = inp.power.trim() && u.d ? similarity(inp.power, u.d) : 0;
    const stats = statsScore(u.s, inp.stats);
    const icon = inp.icon ? iconScore(inp.icon[u.n], w) : null;
    const score = w.title * title + w.power * power + w.stats * stats + (icon == null ? 0 : w.icon * icon);
    out.push({ name: u.n, score, parts: { title, power, stats, icon } });
  }
  return out.sort((a, b) => b.score - a.score);
}

/** The winner when it's clearly ahead of the next candidate, else null (the card can say "probably X"). */
export function confident(c: Candidate[], margin = 0.08): Candidate | null {
  return c[0] && (!c[1] || c[0].score - c[1].score >= margin) ? c[0] : null;
}
