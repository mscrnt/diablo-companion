// Snap Windows OCR text to the game's own vocabulary before parsing.
// OCR misreads small caps and stylised letters ("ARIT10R" for ARMOR, "DOTTIINANCE",
// "Thoms" for Thorns, "Pequires Level 70"). src/generated/ocr-vocab.json (built by
// scripts/gen-ocr-vocab.mjs from the datamined game strings) lists every word and stat
// line a tooltip can show. Numbers are never touched: only words are fixed, and only
// when the fix is unambiguous. When unsure, the OCR text is kept as it was.

export interface OcrVocabData {
  words: string;
  stats: string[];
  ui: string[];
  types: string[];
  rarity: string[];
  sheet: { stats: string[]; currency: string[]; headers: string[] };
}

type SheetKind = "stat" | "currency" | "header";
interface Pool {
  /** skeleton with spaces removed → canonical text ("compareotherslot" → "Compare other slot") */
  flat: Map<string, string>;
  byLen: Map<number, string[]>;
}
interface Vocab {
  words: Set<string>;
  /** confusion-normalised key → the one vocab word with that key (null = ambiguous) */
  byKey: Map<string, string | null>;
  /** vocab words bucketed by key length, for 1-edit repairs of clearly garbled words */
  byLen: Map<number, { w: string; k: string }[]>;
  stats: Set<string>;
  /** word skeletons of every UI and item type line */
  ui: Set<string>;
  /** UI lines with numbers or a colon, rebuilt from the template ("lémpers.• 3/3" → "Tempers: 3/3") */
  templates: Map<string, string>;
  statPool: Pool;
  uiPool: Pool;
  sheet: Map<string, { name: string; kind: SheetKind }>;
}

let V: Vocab | null = null;

const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
const lowerWord = (w: string) => deaccent(w).toLowerCase().replace(/[’`]/g, "'").replace(/^['\-]+|['\-]+$/g, "");

/** OCR-confusion-insensitive key: I/l/1/|/! alike, 0/O alike, "rn" = "m", small-caps M read as "ITI"/"TTI". */
export function confusionKey(w: string): string {
  return deaccent(w)
    .toLowerCase()
    .replace(/['’`]/g, "")
    .replace(/[il1|!¡]/g, "l")
    .replace(/[0ø°]/g, "o")
    .replace(/5/g, "s")
    .replace(/8/g, "b")
    .replace(/q/g, "g")
    .replace(/vv/g, "w")
    .replace(/rn/g, "m")
    .replace(/ffl/g, "m")
    .replace(/ltl|ttl/g, "m");
}

/** Words only, lowercase: "+12.5% Critical Strike Chance (+3.5%)" → "critical strike chance". */
export function skeleton(s: string): string {
  return deaccent(s)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\([^)]*\d[^)]*\)?/g, " ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function pool(texts: Iterable<string>): Pool {
  const flat = new Map<string, string>();
  for (const t of texts) {
    const sk = skeleton(t);
    if (sk) flat.set(sk.replace(/ /g, ""), t.replace(/[#+]|\bx(?=#)/g, "").replace(/\s+/g, " ").trim());
  }
  const byLen = new Map<number, string[]>();
  for (const f of flat.keys()) {
    if (!byLen.has(f.length)) byLen.set(f.length, []);
    byLen.get(f.length)!.push(f);
  }
  return { flat, byLen };
}

export function setOcrVocab(raw: OcrVocabData | null) {
  if (!raw) {
    V = null;
    return;
  }
  const words = new Set(raw.words.split(" "));
  const byKey = new Map<string, string | null>();
  const byLen = new Map<number, { w: string; k: string }[]>();
  for (const w of words) {
    const k = confusionKey(w);
    byKey.set(k, byKey.has(k) && byKey.get(k) !== w ? null : w);
    if (!byLen.has(k.length)) byLen.set(k.length, []);
    byLen.get(k.length)!.push({ w, k });
  }
  const types = [...raw.types];
  for (const t of raw.types) for (const pre of ["", "Ancestral ", "Sacred "]) for (const r of [...raw.rarity, ""]) types.push(`${pre}${r} ${t}`.trim());
  const uiTexts = [...raw.ui, ...types];
  const templates = new Map<string, string>();
  for (const u of raw.ui) if (/#|:/.test(u)) templates.set(skeleton(u), u);
  const sheet = new Map<string, { name: string; kind: SheetKind }>();
  raw.sheet.headers.forEach((n) => sheet.set(skeleton(n), { name: n, kind: "header" }));
  raw.sheet.currency.forEach((n) => sheet.set(skeleton(n), { name: n, kind: "currency" }));
  raw.sheet.stats.forEach((n) => sheet.set(skeleton(n), { name: n, kind: "stat" }));
  V = {
    words,
    byKey,
    byLen,
    stats: new Set(raw.stats.map(skeleton)),
    ui: new Set(uiTexts.map(skeleton)),
    templates,
    statPool: pool(raw.stats),
    uiPool: pool(uiTexts),
    sheet,
  };
}

export const ocrVocabReady = () => !!V;

/** Bounded Levenshtein: the distance, or max+1 as soon as it can't be ≤ max. */
export function editDistance(a: string, b: string, max = 3): number {
  if (Math.abs(a.length - b.length) > max) return max + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < best) best = cur[j];
    }
    if (best > max) return max + 1;
    prev = cur;
  }
  return prev[b.length];
}

export const knownWord = (w: string) => !!V?.words.has(lowerWord(w));

/** Is this line (numbers ignored) a stat line the game prints on items? */
export const knownStat = (text: string) => !!V?.stats.has(skeleton(text));

/** Keep the OCR'd casing style: ALL CAPS titles stay caps, Title words stay Title. */
function styled(orig: string, rep: string) {
  const letters = orig.replace(/[^A-Za-z]/g, "");
  const up = (letters.match(/[A-Z]/g) ?? []).length;
  // small caps come back as "SHAmANlSTlC" / "GREATHELm": mostly upper → upper
  if (letters.length > 2 && up >= letters.length * 0.6) return rep.toUpperCase();
  if (/^[A-Z]/.test(letters)) return rep.charAt(0).toUpperCase() + rep.slice(1);
  return rep;
}

/** A word OCR clearly garbled: digits inside letters, stray symbols, non-ASCII letters. */
const garbled = (w: string) => (/\d/.test(w) && /[a-z]{2}/i.test(w)) || /[^\x00-\x7F]/.test(w) || /[a-z][!|•][a-z]/i.test(w);
const letters = (w: string) => deaccent(w).toLowerCase().replace(/[^a-z]/g, "");

/** The vocab word for an OCR'd word, or null to keep it. */
function fixWord(w: string): string | null {
  if (!V) return null;
  const lw = lowerWord(w);
  if (V.words.has(lw) || lw.replace(/[^a-z]/g, "").length < 3) return null;
  // 1) only OCR confusions differ ("Thoms" = thorns, "ARIT10R" = armor): safe
  const k = confusionKey(w);
  let hit = V.byKey.get(k) ?? null;
  // 2) clearly garbled words may also be one real edit away ("Reduc!ion", "IntelligenceÄ")
  if (!hit && !V.byKey.has(k) && garbled(w) && k.length >= 5) {
    let n = 0;
    for (let L = k.length - 1; L <= k.length + 1; L++)
      for (const c of V.byLen.get(L) ?? [])
        if (editDistance(k, c.k, 1) <= 1 && c.w !== hit) {
          n++;
          hit = c.w;
        }
    if (n !== 1) hit = null;
  }
  // an added or dropped apostrophe alone ("armors" / "armor's") isn't worth a change
  return hit && letters(hit) !== letters(w) ? hit : null;
}

/** "OnHit" → "On Hit", "Chillingthem" → "Chilling them" when both halves are game words. */
function splitWord(w: string): string | null {
  if (!V || w.length < 5 || !/^[A-Za-z]+$/.test(w) || V.words.has(w.toLowerCase())) return null;
  const lw = w.toLowerCase();
  for (let i = 2; i <= w.length - 2; i++) {
    const a = lw.slice(0, i),
      b = lw.slice(i);
    // a capital in the middle marks a lost space; otherwise only split long words into long parts
    const camel = /[a-z]/.test(w[i - 1]) && /[A-Z]/.test(w[i]);
    if ((camel || (a.length >= 4 && b.length >= 4)) && V.words.has(a) && V.words.has(b)) return w.slice(0, i) + " " + w.slice(i);
  }
  return null;
}

const WORD_RUN = /[A-Za-zÀ-ÿ][A-Za-zÀ-ÿ0-9'’!|•\-]*[A-Za-zÀ-ÿ0-9]|[A-Za-zÀ-ÿ]/;
const SMALL = new Set(["of", "to", "the", "and", "per", "a", "an", "for", "with", "from", "in", "on", "vs", "while", "up"]);
const title = (w: string, i: number) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1));

/** Replace the words of a line with a canonical line's words, keeping every number and the delta. */
function replaceWords(line: string, canonical: string): string {
  const toks = line.split(/(\s+)/);
  const wi = toks.map((t, i) => (/[A-Za-zÀ-ÿ]/.test(t) && !/^\(/.test(t) && !/^[+x\-]?\d[\d.,]*%?$/.test(t) ? i : -1)).filter((i) => i >= 0);
  const cw = canonical.split(" ").filter(Boolean);
  if (!wi.length) return line;
  if (wi.length === cw.length) {
    wi.forEach((ti, n) => (toks[ti] = toks[ti].replace(WORD_RUN, (m) => (m.toLowerCase() === cw[n].toLowerCase() ? m : styled(m, cw[n])))));
    return toks.join("");
  }
  // different word count: swap the word run only if no number sits inside it
  const a = wi[0],
    b = wi[wi.length - 1];
  if (toks.slice(a, b + 1).some((t) => /\d/.test(t))) return line;
  const lead = toks[a].match(/^[^A-Za-zÀ-ÿ0-9]*/)![0];
  const trail = toks[b].match(/[^A-Za-zÀ-ÿ0-9']*$/)![0];
  const caps = toks.slice(a, b + 1).join("").replace(/[^A-Za-z]/g, "");
  // stat lines are stored lowercase (title-case them); UI lines carry the game's own casing
  const text = caps.length > 2 && caps === caps.toUpperCase() ? canonical.toUpperCase() : /[A-Z]/.test(canonical) ? canonical : cw.map(title).join(" ");
  return [...toks.slice(0, a), lead + text + trail, ...toks.slice(b + 1)].join("");
}

/** Closest known line (skeleton without spaces), or null when not close, not unique, or just a longer line. */
function nearestLine(sk: string, p: Pool): string | null {
  const flat = sk.replace(/ /g, "");
  if (flat.length < 6) return null;
  const max = flat.length <= 10 ? 1 : flat.length <= 20 ? 2 : 3;
  let best: string | null = null;
  let bestD = max + 1;
  let tie = false;
  for (let L = flat.length - max; L <= flat.length + max; L++)
    for (const c of p.byLen.get(L) ?? []) {
      const d = editDistance(flat, c, Math.min(bestD, max));
      if (d < bestD) {
        bestD = d;
        best = c;
        tie = false;
      } else if (d === bestD && d <= max && c !== best) tie = true;
    }
  if (!best || tie || bestD > max) return null;
  const text = p.flat.get(best)!;
  // every OCR'd word is already in the candidate: it's a wrapped / cut line or a different
  // real line ("Legendary Two-Handed" + "Scythe" on the next line), not a misread
  const cand = new Set(skeleton(text).split(" "));
  if (sk.split(" ").every((w) => cand.has(w))) return null;
  return text;
}

/** "Tempers: #/#" + the numbers OCR read → "Tempers: 3/3". */
function fromTemplate(line: string, tpl: string): string {
  const nums = line.match(/[+\-]?\d[\d.,]*%?/g) ?? [];
  const slots = (tpl.match(/#/g) ?? []).length;
  if (nums.length !== slots) return line;
  let i = 0;
  return tpl.replace(/#/g, () => nums[i++]);
}

/** Snap one OCR'd tooltip line. Returns the line unchanged when nothing is certain. */
export function snapLine(text: string): string {
  if (!V || !text.trim()) return text;
  let s = text
    // "+2, 195 Maximum Life" → "+2,195"; "+1,534Life" → "+1,534 Life"; "IntelligenceÄ(-239)" → "… (-239)"
    .replace(/(\d),\s(\d{3})(?!\d)/g, "$1,$2")
    .replace(/(\d%?)([A-Z][a-z]{2,})/g, "$1 $2")
    .replace(/([A-Za-zÀ-ÿ])\((?=[+\-]?\d)/g, "$1 (")
    // a bullet icon read as a letter: "o +9.0% …", "P +33.8% Summon Damage", "X +11.0% …"
    .replace(/^(?:[oO0•*◆◇¤✸✷·°]\s+(?=[+x\-]?\s?\d)|[PpVvX]\s+(?=[+x]\s?\d))/, "");
  // 1) words
  const toks = s.split(/(\s+)/);
  for (let i = 0; i < toks.length; i++) {
    const m = toks[i].match(WORD_RUN);
    if (!m || !/[A-Za-zÀ-ÿ]{2}/.test(m[0]) || /^[+x\-]?\d/.test(toks[i])) continue;
    const core = m[0];
    const fixed = fixWord(core) ?? null;
    const rep = fixed ? styled(core, fixed) : splitWord(core);
    if (rep) toks[i] = toks[i].replace(core, rep);
  }
  s = toks.join("");
  // 2) the whole line: exact, glued ("Compareotherslot") or a near miss ("Pequires Level 70")
  const sk = skeleton(s);
  if (!sk) return s;
  const statLike = /^[+x\-]?\s?\d/.test(s.trim());
  const tpl = V.templates.get(sk);
  if (tpl) return /:/.test(tpl) ? fromTemplate(s, tpl) : s;
  if (V.stats.has(sk) || V.ui.has(sk)) return s;
  const flat = sk.replace(/ /g, "");
  const glued = (statLike && V.statPool.flat.get(flat)) || V.uiPool.flat.get(flat);
  if (glued) return replaceWords(s, glued);
  const nWords = sk.split(" ").length;
  // power-text fragments are long sentences; only stat lines and short UI-ish lines get a fuzzy match,
  // and never against stat names unless the line starts with a number
  let near: string | null = null;
  if (statLike && nWords <= 8) near = nearestLine(sk, V.statPool) ?? nearestLine(sk, V.uiPool);
  else if (!statLike && nWords <= 4 && !/[.,]$/.test(s.trim())) near = nearestLine(sk, V.uiPool);
  if (!near) return s;
  const t = V.templates.get(skeleton(near));
  return t && /:/.test(t) ? fromTemplate(s, t) : replaceWords(s, near);
}

export function snapLines<T extends { text: string }>(lines: T[]): T[] {
  if (!V) return lines;
  return lines.map((l) => {
    const text = snapLine(l.text);
    return text === l.text ? l : { ...l, text };
  });
}

/** Character sheet: the stat / currency / header a label names, matched strictly. */
export function sheetName(label: string): { name: string; kind: SheetKind } | null {
  if (!V) return null;
  const sk = skeleton(label);
  if (!sk) return null;
  const exact = V.sheet.get(sk);
  if (exact) return exact;
  // allow a couple of OCR slips, never a different stat ("Damage Mages" ≠ "Damage with Mages")
  const k = confusionKey(sk);
  const max = k.length >= 12 ? 2 : k.length >= 6 ? 1 : 0;
  let best: { name: string; kind: SheetKind } | null = null;
  let bestD = max + 1;
  let tie = false;
  for (const [s, v] of V.sheet) {
    const d = editDistance(k, confusionKey(s), max);
    if (d < bestD) (bestD = d), (best = v), (tie = false);
    else if (d === bestD && d <= max && v !== best) tie = true;
  }
  return best && !tie && bestD <= max ? best : null;
}
