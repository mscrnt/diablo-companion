// Reading the Character screen: the stats sheet, skill tooltips and glyph tooltips.
// Pure functions (no capture, no store) so they can be tested on logged OCR.
//
// The stats sheet sits next to the character panel, so one OCR row often holds two
// columns ("Movement Speed 165.3% Intelligence 2,682"), a header with its value on the
// next row ("Toughness" / "1,241,124"), currency and other players' names. Labels are
// matched against the game's own stat names (HeroDetailsEntries), never guessed.
import { sheetName } from "./ocrfix";
import { normName, trigramSim } from "./names";
import type { OcrLine } from "./native";

const VALUE = /^[+\-]?\d[\d,]*(?:\.\d+)?%?$/;

/** Stats shown as plain numbers; all other sheet stats are percentages. */
const FLAT =
  /^(level|strength|intelligence|willpower|dexterity|toughness|weapon damage|base .*weapon damage|weapon speed|.*armor|.*thorns|maximum (?!.*(chance|speed)).*|.*regeneration|.*on kill|life on hit|potion capacity|.*resistance|.*resist all|lucky hit life)$/i;

const valueFits = (stat: string, value: string) => (FLAT.test(stat) ? !/%/.test(value) : /%/.test(value));

/**
 * The stat a label names. Text before the name is noise from elsewhere on screen
 * ("Varyana I X Maximum Essence", "…according to the Physical Resistance"), so the
 * longest matching word-suffix wins. Currency and section headers come back too, so
 * callers can drop them.
 */
export function resolveLabel(label: string): { name: string; kind: "stat" | "currency" | "header" } | null {
  const words = label.replace(/[:.]+$/, "").trim().split(/\s+/).filter(Boolean);
  for (let i = 0; i < words.length; i++) {
    const r = sheetName(words.slice(i).join(" "));
    if (r) return r;
  }
  return null;
}

interface Seg {
  text: string;
  value: boolean;
  x: number;
  x2: number;
  y: number;
  h: number;
  row: number;
}

/** Split OCR parts into label and value pieces with estimated x positions. */
function segments(parts: OcrLine[], row: number): Seg[] {
  const out: Seg[] = [];
  for (const p of parts) {
    const toks = p.text.trim().split(/\s+/);
    const len = Math.max(1, p.text.trim().length);
    let at = 0;
    let label: Seg | null = null;
    for (const t of toks) {
      const x = p.x + (p.w * at) / len;
      const x2 = p.x + (p.w * (at + t.length)) / len;
      at += t.length + 1;
      const clean = t.replace(/[•·,;]+$/, "");
      if (VALUE.test(clean)) {
        out.push({ text: clean, value: true, x, x2, y: p.y, h: p.h, row });
        label = null;
      } else if (t === "&" && label) {
        label.text += " &"; // "Armor & Resistances"
      } else if (/^\(.*\)?$|^\d|^[^A-Za-z]*$/.test(t)) {
        label = null; // "(261)", "70", "|": player levels and icons split labels
      } else if (label) {
        label.text += " " + t;
        label.x2 = x2;
      } else {
        label = { text: t, value: false, x, x2, y: p.y, h: p.h, row };
        out.push(label);
      }
    }
  }
  return out;
}

/** Group OCR lines into rows (label left, value right), keeping positions. */
export function ocrRows(lines: OcrLine[]): OcrLine[][] {
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  const out: { y: number; h: number; parts: OcrLine[] }[] = [];
  for (const l of sorted) {
    const r = out.find((r) => Math.abs(r.y + r.h / 2 - (l.y + l.h / 2)) < Math.max(r.h, l.h) * 0.5);
    if (r) r.parts.push(l);
    else out.push({ y: l.y, h: l.h, parts: [l] });
  }
  return out.map((r) => r.parts.sort((a, b) => a.x - b.x));
}

/**
 * Read one frame of the stats sheet: { "Critical Strike Chance": "32.0%", … }.
 * Values only pair with a label in the same column, so the character panel's numbers
 * never land on a stats-list label whose own value OCR missed.
 */
export function parseStatSheet(lines: OcrLine[], columns = true): Record<string, string> {
  const rows = ocrRows(lines);
  const segs = rows.flatMap((r, i) => segments(r, i));
  // columns start where game labels start: cluster the x of every label we recognise
  const width = Math.max(1, ...lines.map((l) => l.x + l.w)) - Math.min(0, ...lines.map((l) => l.x));
  const xs = segs.filter((s) => !s.value && resolveLabel(s.text)).map((s) => s.x).sort((a, b) => a - b);
  const cols: number[] = [];
  if (columns) for (const x of xs) if (!cols.length || x - cols[cols.length - 1] > width * 0.12) cols.push(x);
  const col = (s: Seg) => {
    let c = 0;
    cols.forEach((x, i) => (s.x >= x - width * 0.02 ? (c = i) : 0));
    return c;
  };

  const pairs: [Seg, Seg][] = [];
  const lonelyLabels: Seg[] = [];
  const lonelyValues: Seg[] = [];
  for (let r = 0; r < rows.length; r++) {
    let pending: Seg | null = null;
    for (const s of segs.filter((s) => s.row === r)) {
      if (!s.value) {
        if (pending) lonelyLabels.push(pending);
        pending = s;
      } else if (pending && col(pending) === col(s)) {
        pairs.push([pending, s]);
        pending = null;
      } else lonelyValues.push(s);
    }
    if (pending) lonelyLabels.push(pending);
  }
  // a value alone on its row belongs to the label right above it in the same column
  // ("Toughness" / "1,241,124"), or to a label wrapped around it ("Lucky Hit Chance" / "0.0%" / "Bonus")
  const used = new Set<Seg>();
  for (const v of lonelyValues) {
    // only a value standing alone in its column, not a number inside a sentence
    if (segs.some((s) => s !== v && s.row === v.row && col(s) === col(v))) continue;
    // nearest row first; within a row the rightmost label (the end of that row)
    const near = (dir: -1 | 1) =>
      lonelyLabels
        .filter((l) => !used.has(l) && col(l) === col(v) && (dir < 0 ? l.y < v.y && v.y - l.y < v.h * 2.5 : l.y > v.y && l.y - v.y < v.h * 2.5))
        .sort((a, b) => Math.abs(a.y - v.y) - Math.abs(b.y - v.y) || b.x - a.x);
    const below = near(1)[0];
    for (const above of near(-1)) {
      const both = below && resolveLabel(`${above.text} ${below.text}`);
      // the two halves only count together when neither half names that stat alone
      if (both?.kind === "stat" && both.name !== resolveLabel(above.text)?.name && both.name !== resolveLabel(below!.text)?.name) {
        used.add(above).add(below);
        pairs.push([{ ...above, text: `${above.text} ${below.text}` }, v]);
        break;
      }
      if (resolveLabel(above.text)?.kind === "stat") {
        used.add(above);
        pairs.push([above, v]);
        break;
      }
    }
  }

  const out: Record<string, string> = {};
  for (const [l, v] of pairs) {
    const r = resolveLabel(l.text);
    if (r?.kind !== "stat" || !valueFits(r.name, v.text)) continue;
    out[r.name] ??= v.text;
  }
  return out;
}

/** Same, for rows logged as joined text (no positions): each row is read left to right as one column. */
export function statsFromRows(rows: string[]): Record<string, string> {
  return parseStatSheet(rows.map((text, i) => ({ text, x: 0, y: i * 30, w: text.length * 10, h: 24 })), false);
}

/** The big numbers on the character panel; they are what bleeds into other rows. */
const PANEL = /^(weapon damage|toughness|strength|intelligence|willpower|dexterity)$/i;

/**
 * Clean a stats map saved by older versions (label → value straight from OCR rows):
 * keep game stat names only, and drop a value that also sat next to two or more
 * non-stat labels unless it is the panel's own number — it came from the panel
 * ("Thoms 4,574" was the weapon damage next to other players' names).
 */
export function tidyStats(saved: Record<string, string>): Record<string, string> {
  const resolved = Object.entries(saved).map(([k, v]) => ({ k, v: v.replace(/\s+/g, ""), r: resolveLabel(k) }));
  const strays = new Map<string, number>();
  for (const e of resolved) if (e.r?.kind !== "stat") strays.set(e.v, (strays.get(e.v) ?? 0) + 1);
  const out: Record<string, string> = {};
  for (const e of resolved) {
    if (e.r?.kind !== "stat" || !valueFits(e.r.name, e.v)) continue;
    if ((strays.get(e.v) ?? 0) >= 2 && !PANEL.test(e.r.name)) continue;
    out[e.r.name] ??= e.v;
  }
  return out;
}

// ---- hover tooltips ----------------------------------------------------------------------

export interface NameRef {
  slug: string;
  name: string;
}

/**
 * Best name for a tooltip title. OCR rows join text from other panels before or after
 * the title ("Army of the Dead Barrier Bonus", "Prickly Pants Deadraiser"), so the row's
 * first and last words are tried too. On a tie the later row (nearer the rank line) wins.
 */
export function bestName(lines: string[], names: NameRef[], min = 0.8) {
  let best: (NameRef & { score: number; i: number }) | null = null;
  lines.forEach((l, i) => {
    const words = l.trim().split(/\s+/);
    for (const n of names) {
      const k = n.name.split(/\s+/).length;
      const parts = [l];
      if (words.length > k) parts.push(words.slice(0, k).join(" "), words.slice(-k).join(" "));
      const s = Math.max(...parts.map((p) => trigramSim(p, n.name)));
      if (s >= min && (!best || s >= best.score)) best = { ...n, score: s, i };
    }
  });
  return best as (NameRef & { score: number; i: number }) | null;
}

export interface SkillRead {
  hit: NameRef & { score: number; i: number };
  /** rank shown on the tooltip: points spent + gear and buff ranks */
  total: number;
  max: number | null;
  /** ranks from gear ("Item Contribution") and buffs; null when OCR lost the number */
  bonus: number | null;
  /** points you spent (total − bonus); null when the bonus couldn't be read */
  base: number | null;
}

/**
 * A skill tooltip: "Army of the Dead" / "RANK 9/15" / "(Item Contribution: 4)".
 * The rank includes gear ranks (a skill reads "RANK 34/15" with +19 from items), so the
 * points you spent are the rank minus the contributions.
 */
export function parseSkillHover(lines: string[], names: NameRef[]): SkillRead | null {
  const ri = lines.findIndex((l) => /\brank\s*:?\s*\d+/i.test(l));
  if (ri < 0) return null;
  const m = lines[ri].match(/\brank\s*:?\s*(\d+)(?:\s*\/\s*(\d+))?/i)!;
  // the skill's title sits just above its "Rank" line
  const hit = bestName(lines.slice(Math.max(0, ri - 3), ri + 1), names, 0.75);
  if (!hit) return null;
  hit.i += Math.max(0, ri - 3);
  const total = Number(m[1]);
  const max = m[2] ? Number(m[2]) : null;
  const near = lines.slice(ri, ri + 3).join(" ");
  let bonus: number | null = 0;
  for (const kind of ["item", "buffs?"]) {
    if (!new RegExp(`\\(?\\s*${kind}\\s+contribution`, "i").test(near)) continue;
    const n = near.match(new RegExp(`${kind}\\s+contribution\\s*[:.;]?\\s*(\\d+)`, "i"));
    bonus = n && bonus !== null ? bonus + Number(n[1]) : null;
  }
  // more than the max with no contribution read: OCR lost that line, the split is unknown
  if (bonus === 0 && max !== null && total > max) bonus = null;
  const base = bonus === null ? null : Math.max(0, total - bonus);
  return { hit, total, max, bonus, base };
}

/** A glyph tooltip: "Deadraiser" / "Legendary Glyph" / "LEVEL 85". A skill's "RANK 9/15" is not a glyph. */
export function parseGlyphHover(lines: string[], names: NameRef[]): { hit: NameRef & { score: number; i: number }; level: number } | null {
  const li = lines.findIndex((l) => /\blevel\s*:?\s*\d+/i.test(l));
  if (li < 0) return null;
  const level = Number(lines[li].match(/\blevel\s*:?\s*(\d+)/i)![1]);
  // the name sits a line or three above the level, next to "Legendary Glyph"
  const from = Math.max(0, li - 4);
  const hit = bestName(lines.slice(from, li + 1), names, 0.8);
  if (!hit) return null;
  hit.i += from;
  return { hit, level };
}

export const sameName = (a: string, b: string) => normName(a) === normName(b);
