// Slug → display-name resolution backed by tables built from the player's own Diablo IV install
// (src/lib/gamedata: read off this PC, converted by convert.ts). Falls back to humanising the slug
// when an entry is missing.
import { confusionKey, setOcrVocab, type OcrVocabData } from "./ocrfix";

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
  s?: string[]; // the stats a unique always rolls
  x?: 1; // deprecated / retired
  g?: string; // id indexes: the slug this game id names
  w?: number; // id indexes: a paragon board's width
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
  | "wpNodes"
  // the game's own ids, for the planners that store a build as ids (see GameId below)
  | "affixIds"
  | "boardIds"
  | "glyphIds"
  | "itemIds";

type Slim = Record<Category, Record<string, SlimEntry>> & { meta?: Record<string, unknown> };

let data: Slim | null = null;
let loading: Promise<void> | null = null;
let loaded = false;
let generated: Record<string, any> | null = null;
const listeners = new Set<() => void>();

/** What the tables come from: the app reads the player's own install; tests hand in their own. */
export interface StaticSource {
  tables: Slim | null;
  ocrVocab: OcrVocabData | null;
  /** the other tables built from the game data: hordes (offers, chests, whisper caches), mapPois */
  generated?: Record<string, any> | null;
}

/** The game data read off this PC (src/lib/gamedata), converted to the lookup tables. */
async function fromGameData(): Promise<StaticSource> {
  const [{ convert }, gd] = await Promise.all([import("./gamedata/convert"), import("./gamedata")]);
  const [x, gen] = await Promise.all([gd.loadGameData(), gd.loadGeneratedTables()]);
  return { tables: x ? (convert(x) as unknown as Slim) : null, ocrVocab: gen?.ocrVocab ?? null, generated: gen ? { hordes: gen.hordes, mapPois: gen.mapPois } : null };
}
let source: () => Promise<StaticSource> = fromGameData;

/** Use another source for the tables (tests); the next load reads it. */
export function setStaticSource(fn: () => Promise<StaticSource>) {
  source = fn;
  loading = null;
}

/** Load the tables and the OCR vocabulary once; safe to call repeatedly. Empty until the game has been read. */
export function loadStaticData(): Promise<void> {
  loading ??= source()
    .catch((): StaticSource => ({ tables: null, ocrVocab: null, generated: null }))
    .then((r) => {
      data = r.tables;
      setOcrVocab(r.ocrVocab);
      generated = r.generated ?? null;
      loaded = true;
      for (const fn of listeners) fn();
    });
  return loading;
}

/** Load again (the game was read anew, after a patch or for the first time). */
export function reloadStaticData(): Promise<void> {
  loading = null;
  return loadStaticData();
}

/** Run `fn` each time the tables (re)load, and now if they already have. */
export function onStaticData(fn: () => void): () => void {
  listeners.add(fn);
  if (loaded) fn();
  return () => listeners.delete(fn);
}

/** One of the other tables built from the game data ("hordes", "mapPois"), or null before the game is read. */
export const generatedTable = (k: string): any => generated?.[k] ?? null;

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

/** The indexes keyed by the game's own ids (convert.ts), for builds a planner stores as ids. */
export type GameId = "affixIds" | "boardIds" | "glyphIds" | "itemIds";

/**
 * What one of the game's own ids names: the entry carries the display name (`n`), the table it belongs to
 * (`t`) and the slug in it (`g`). An id the data doesn't know gives undefined, and the caller keeps whatever
 * the site itself showed.
 */
export function byGameId(index: GameId, id: string | number | null | undefined): SlimEntry | undefined {
  const key = id === null || id === undefined ? "" : String(id).trim();
  return key ? data?.[index]?.[key] : undefined;
}

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
 * Name a unique or mythic from its power text, for a capture that missed the title ("Damaging enemies with
 * a Non-Basic Skill cast marks them…" is Paingorger's Gauntlets). `itemType` narrows it to that kind of
 * item when the table knows it. Returns the name, or null without a clear match.
 */
export function identifyUnique(powerText: string, itemType = ""): string | null {
  const t = normStat(powerText);
  if (t.split(" ").length < 6) return null;
  const kind = normName(itemType).split(" ").pop() ?? "";
  let best: string | null = null;
  let bestS = 0;
  for (const u of Object.values(table("uniques"))) {
    if (u.x || !u.d) continue;
    if (kind && u.t && !normName(u.t).includes(kind) && !kind.includes(normName(u.t).split(" ").pop() ?? "")) continue;
    const s = similarity(t, u.d);
    if (s > bestS) {
      bestS = s;
      best = u.n;
    }
  }
  return bestS >= 0.6 ? best : null;
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

/** "2h Mace" against "Ancestral Mythic Unique Two-Handed Mace (Bludgeoning)". */
export function typeMatches(uniqueType: string, itemType: string): boolean {
  const t = normName(uniqueType).replace(/\b2h\b/, "two handed").replace(/\b1h\b/, "one handed");
  return !!t && normName(itemType).includes(t);
}

/** An OCR'd title against a unique's name, 0..1: letters as read, and glyph-confusion keys ("rn1Gi4T"). */
export function titleSimilarity(title: string, uniqueName: string): number {
  const key = (t: string) => confusionKey(t).replace(/4/g, "h");
  // the title shows the name without the "(2h Mace)" the data adds to tell the copies apart
  const base = uniqueName.replace(/\s*\([^)]*\)\s*$/, "");
  return Math.max(trigramSim(title, base), trigramSim(key(title), key(base)));
}

/**
 * Snap an OCR'd unique/mythic name to the official spelling. Some uniques exist once per weapon type
 * ("Infinity (2h Mace)", "Infinity (Bow)"…): `itemType` picks the one this item is.
 */
export function canonicalUnique(name: string, itemType = ""): string | null {
  let best: string | null = null;
  let bestS = 0;
  let bestType = -1;
  let bestPlain = -1;
  // OCR slips in the stylised title font ("TYRÄEL'S rn1Gi4T" = Tyrael's Might): compare glyph-confusion keys too
  const key = (t: string) => confusionKey(t).replace(/4/g, "h");
  const k = key(name);
  for (const u of Object.values(table("uniques"))) {
    if (u.x) continue;
    // the title shows the name without the "(2h Mace)" the data adds to tell the copies apart
    const base = u.n.replace(/\s*\([^)]*\)\s*$/, "");
    const s = Math.max(trigramSim(name, base), trigramSim(k, key(base)));
    const type = !u.t || !itemType ? 0 : typeMatches(u.t, itemType) ? 1 : -1;
    // on a tie the plain name beats a variant of it ("Shard of Verathiel" over "Shard of Verathiel (Crucible)")
    const plain = u.n === base ? 1 : 0;
    const tie = Math.abs(s - bestS) < 1e-9;
    if (s > bestS + 1e-9 || (tie && (type > bestType || (type === bestType && plain > bestPlain)))) {
      bestS = s;
      best = u.n;
      bestType = type;
      bestPlain = plain;
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
