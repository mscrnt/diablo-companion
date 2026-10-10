// Slug → display-name resolution backed by src/generated/static-slim.json
// (built from Mobalytics static data by scripts/slim-static.mjs). Falls back to
// humanising the slug when an entry is missing.
import { setOcrVocab, type OcrVocabData } from "./ocrfix";

export interface SlimEntry {
  n: string; // name
  d?: string; // description
  c?: string; // class
  t?: string; // type
  k?: string; // stat kind
  r?: string; // tempering recipe
  m?: 1; // mythic
  src?: string; // unique drop source
  loc?: string; // aspect dungeon/location
  set?: string; // charm set
  x?: 1; // deprecated / retired
}

export type Category =
  | "stats"
  | "aspects"
  | "uniques"
  | "skills"
  | "gems"
  | "runes"
  | "charms"
  | "seals"
  | "chaosPerks"
  | "boards"
  | "glyphs"
  | "nodes"
  | "mercs"
  | "mercSkills"
  | "mercOpp"
  | "bloodied"
  | "wpTrees"
  | "wpNodes";

type Slim = Record<Category, Record<string, SlimEntry>> & { meta?: Record<string, unknown> };

let data: Slim | null = null;
let loading: Promise<void> | null = null;

/** Lazy-load the tables (≈1.7 MB) and the OCR vocabulary once; safe to call repeatedly. */
export function loadStaticData(): Promise<void> {
  loading ??= Promise.all([
    import("../generated/static-slim.json")
      .then((m) => {
        data = (m as any).default as Slim;
      })
      .catch(() => {
        data = null;
      }),
    import("../generated/ocr-vocab.json")
      .then((m) => setOcrVocab((m as any).default as OcrVocabData))
      .catch(() => setOcrVocab(null)),
  ]).then(() => {});
  return loading;
}

export const staticReady = () => !!data;
export const staticMeta = () => data?.meta;

export function table(cat: Category): Record<string, SlimEntry> {
  return data?.[cat] ?? {};
}

const SEARCH_ORDER: Category[] = [
  "uniques",
  "aspects",
  "skills",
  "gems",
  "runes",
  "charms",
  "seals",
  "chaosPerks",
  "glyphs",
  "boards",
  "mercs",
  "mercSkills",
  "mercOpp",
  "stats",
];

export function lookup(slug: string, category?: Category): SlimEntry | undefined {
  if (!slug || !data) return undefined;
  if (category) return data[category]?.[slug];
  for (const c of SEARCH_ORDER) {
    const hit = data[c]?.[slug];
    if (hit) return hit;
  }
  return undefined;
}

const SMALL = new Set(["of", "the", "to", "in", "on", "and", "a", "for", "per"]);

export function humanize(slug: string): string {
  if (!slug) return "";
  return slug
    .replace(/[-_]+/g, " ")
    .trim()
    .split(" ")
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ");
}

const stripClass = (s: string) => s.replace(/-(necromancer|barbarian|sorcerer|rogue|druid|spiritborn|paladin)$/, "");

export function statName(slug: string): string {
  return lookup(slug, "stats")?.n ?? humanize(slug);
}

/** Tempering affixes render as "Summon Damage (Profane Finesse)". */
export function temperName(slug: string): string {
  const e = lookup(slug, "stats");
  if (e) return e.r ? `${e.n} (${e.r})` : e.n;
  return humanize(slug);
}

export function nameOf(slug: string, fallback?: string, category?: Category): string {
  const hit = lookup(slug, category);
  if (hit?.n) return hit.n;
  return fallback || humanize(stripClass(slug));
}

export function describe(slug: string, category?: Category): string | undefined {
  return lookup(slug, category)?.d;
}

/** Normalise stat/affix text for fuzzy comparison ("+12.5% Critical Strike Chance [10-14]%" → "critical strike chance"). */
export function normStat(s: string): string {
  return s
    .toLowerCase()
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[+\-]?\d+([.,]\d+)?%?/g, " ")
    .replace(/\b(x|multiplier|increased|bonus|to|the|of|your|all|ranks?)\b/g, " ")
    .replace(/[^a-z ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Identify a legendary aspect from its power text (item names like "Peerless Pelte of
 * Terror" don't reliably name the aspect). Compares against the game's aspect
 * descriptions with numbers stripped. Returns the aspect name or null.
 */
export function identifyAspect(powerText: string, className?: string): string | null {
  const t = normStat(powerText);
  if (t.split(" ").length < 4) return null;
  let best: string | null = null;
  let bestS = 0;
  for (const a of Object.values(table("aspects"))) {
    if (a.x || !a.d) continue;
    if (className && a.c && a.c !== className.toLowerCase()) continue;
    const s = similarity(t, a.d);
    if (s > bestS) {
      bestS = s;
      best = a.n;
    }
  }
  return bestS >= 0.55 ? best : null;
}

/**
 * The aspect a legendary's name points to: "Ocelot's Eye of Reanimation" → Aspect of
 * Reanimation, "Skullbreaker's Helm" → Skullbreaker's Aspect. Only real aspects from the
 * game data count (a name suffix with no aspect behind it returns null), and only one
 * clear best match: used when the power text is too garbled to identify.
 */
export function aspectFromItemName(itemName: string, className?: string): string | null {
  const name = normName(itemName);
  if (name.split(" ").length < 2) return null;
  const cut = name.lastIndexOf(" of ");
  const suffix = cut >= 0 ? name.slice(cut + 4) : "";
  let best: string | null = null;
  let bestS = 0;
  let tie = false;
  for (const a of Object.values(table("aspects"))) {
    if (a.x) continue;
    if (className && a.c && a.c !== className.toLowerCase()) continue;
    const an = normName(a.n);
    let s = 0;
    if (an.startsWith("aspect of ")) {
      if (suffix) s = trigramSim(suffix, an.slice(10));
    } else if (an.endsWith(" aspect")) {
      const pre = an.slice(0, -7);
      if (name.startsWith(pre + " ")) s = 0.8 + pre.length / 1000; // longest prefix wins
    }
    if (s > bestS + 1e-9) {
      bestS = s;
      best = a.n;
      tie = false;
    } else if (Math.abs(s - bestS) < 1e-9 && a.n !== best) tie = true;
  }
  return best && !tie && bestS >= 0.8 ? best : null;
}

/** Character-trigram Dice similarity — robust to OCR letter swaps ("Reaniitiation"). */
export function trigramSim(a: string, b: string): number {
  const grams = (s: string) => {
    const t = `  ${normName(s)} `;
    const m = new Map<string, number>();
    for (let i = 0; i < t.length - 2; i++) m.set(t.slice(i, i + 3), (m.get(t.slice(i, i + 3)) ?? 0) + 1);
    return m;
  };
  const A = grams(a),
    B = grams(b);
  let inter = 0,
    na = 0,
    nb = 0;
  for (const v of A.values()) na += v;
  for (const v of B.values()) nb += v;
  for (const [k, v] of A) inter += Math.min(v, B.get(k) ?? 0);
  return na + nb ? (2 * inter) / (na + nb) : 0;
}

/** Snap an OCR'd unique/mythic name to the official spelling. */
export function canonicalUnique(name: string): string | null {
  let best: string | null = null;
  let bestS = 0;
  for (const u of Object.values(table("uniques"))) {
    if (u.x) continue;
    const s = trigramSim(name, u.n);
    if (s > bestS) {
      bestS = s;
      best = u.n;
    }
  }
  return bestS >= 0.6 ? best : null;
}

/** Token-overlap similarity in [0,1]. */
export function similarity(a: string, b: string): number {
  const A = new Set(normStat(a).split(" ").filter(Boolean));
  const B = new Set(normStat(b).split(" ").filter(Boolean));
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const t of A) if (B.has(t)) inter++;
  return (2 * inter) / (A.size + B.size);
}

export function normName(s: string): string {
  return s.toLowerCase().replace(/[’'`]/g, "").replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
}
