// Turns game data read from the player's own Diablo IV install into the lookup tables the app uses
// (names.ts SlimEntry). No other company's data: everything here comes from the game files (Kenneth,
// 2026-10-16). Input is the extractor's JSON (tools/datamine/extract.mjs today, the in-app reader next).
import type { SlimEntry } from "../names";

/** The extractor's files, loosely typed: only the fields used here are read. */
export interface Extracted {
  build?: string;
  uniques?: { entries: any[] };
  aspects?: { entries: any[] };
  affixes?: { entries: any[] };
  powers?: { skills: any[] };
  gemsRunes?: { gems: any[]; runes: any[] };
  charms?: { charms: any[]; setBonuses: any[] };
  paragon?: { boards: any[]; nodes: any[]; glyphs: any[] };
  items?: { entries: any[] };
}

export type Tables = Record<string, Record<string, SlimEntry>> & { meta: Record<string, unknown> };

/** "Aspect of Berserk Ripping" → "aspect-of-berserk-ripping", "Mjölnic Ryng" → "mjolnic-ryng" (the slugs builds use). */
export const slugOf = (name: string) =>
  name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[’']/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

const CLASSES = ["barbarian", "druid", "necromancer", "rogue", "sorcerer", "spiritborn", "paladin", "warlock"];
/** "Necro" / "Necromancer" / "Barb" → "necromancer" / "barbarian"; "All" or several → undefined. */
export function classOf(x: unknown): string | undefined {
  const list = (Array.isArray(x) ? x : [x]).filter(Boolean).map((c) => String(c).toLowerCase());
  if (list.length !== 1 || list[0] === "all") return undefined;
  return CLASSES.find((c) => c.startsWith(list[0].slice(0, 4)));
}

/** Every class named ("Barbarian", "Paladin"), A to Z; empty for "All". */
const classesOf = (x: unknown) => [...new Set((Array.isArray(x) ? x : [x]).map((c) => classOf(c)).filter(Boolean) as string[])].sort();

const MULT = "\u0001";
const ADD = "\u0002";

/**
 * A game description template as plain text: values become "#" ("[Affix_Value_1*100|x%|]" → "#%[x]"), colour and
 * icon tags go, and conditional parts take the non-mythic branch.
 */
export function plainText(src: string | null | undefined): string {
  if (!src) return "";
  let s = String(src).replace(/\r\n?/g, "\n");
  // innermost {if:…}A{else}B{/if} / {if:…}A{/if} first, until none are left (non-mythic, simple tooltip)
  for (let i = 0; i < 8 && /\{if:/.test(s); i++)
    s = s.replace(/\{if:[^{}]*\}((?:(?!\{if:)[\s\S])*?)(?:\{else\}((?:(?!\{if:)[\s\S])*?))?\{\/if\}/g, (_m, _a, b) => b ?? "");
  // the game's markers for multiplicative and additive bonuses ("45%[x]") go back in after the other brackets
  s = s.replace(/\[[^\]|]*\|([^\]|]*)\|?\]/g, (_m, fmt: string) => "#" + (/x%|%x/.test(fmt) ? "%" + MULT : /\+%|%\+/.test(fmt) ? "%" + ADD : fmt.includes("%") ? "%" : ""));
  s = s.replace(/\[[^\]]*\]/g, "#");
  s = s.replace(/\{(?:c_[^}]*|\/c[^}]*|u|\/u|icon:[^}]*|\/?b)\}/gi, "");
  s = s.replace(/\{[^{}]*\}/g, "#");
  s = s.split(MULT).join("[x]").split(ADD).join("[+]");
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** An affix attribute's line ("+[{VALUE2}] Maximum {VALUE1}" with its parameter) as plain text: "+# Maximum Mana". */
export function attributeLine(attr: any): string {
  const t = String(attr?.textPlain ?? attr?.text ?? "");
  const p = attr?.paramDisplayName ?? String(attr?.paramName ?? "").replace(/^[A-Z][a-z]+_/, "").replace(/_/g, " ");
  return plainText(t.replace(/\{VALUE1\}/gi, p).replace(/\{VALUE2?\}/gi, "#")).replace(/\s+/g, " ");
}

/** "+#% Attack Speed" → "Attack Speed": the stat's name without its value. */
export const statNameOf = (line: string) =>
  line
    .replace(/^[+x\-]?\s*#\s*(%\[[x+]\]|%)?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();

function put(t: Record<string, SlimEntry>, slug: string, e: SlimEntry) {
  if (!slug || !e.n) return;
  // the first one wins, except that a real description beats an empty one
  if (!t[slug] || (!t[slug].d && e.d)) t[slug] = e;
}

/** "S14_Helm_Unique_…" → 14: the season a game entry was added or reworked in (0 for the original). */
const seasonOf = (id: unknown) => Number(String(id ?? "").match(/^S(\d+)_/)?.[1] ?? 0);

/** The tables, from the extractor's output. */
export function convert(x: Extracted): Tables {
  const out = { meta: { source: "game files on this PC", build: x.build ?? null, converted: new Date().toISOString() } } as unknown as Tables;
  const T = (k: string) => (out[k] ??= {});
  const affixById = new Map<string, any>((x.affixes?.entries ?? []).map((a) => [a.id, a]));

  // uniques: the unique power, the item type and the stats it always rolls. "S10_…" entries are the chaos versions on
  // other item types ("mjolnic-ryng-chaos-helm"), "S14_…" a rework (its text is current); one name on several item
  // types gets the type in its slug ("ancients-pledge-focus")
  const byName = new Map<string, any[]>();
  for (const u of x.uniques?.entries ?? []) if (u.name) byName.set(u.name, [...(byName.get(u.name) ?? []), u]);
  const uniqueSlug = new Map<any, string>();
  for (const [name, list] of byName) {
    const types = new Set(list.filter((u) => seasonOf(u.id) !== 10).map((u) => u.itemTypeName ?? u.itemType));
    for (const u of list) {
      const type = slugOf(String(u.itemTypeName ?? u.itemType ?? ""));
      uniqueSlug.set(u, seasonOf(u.id) === 10 ? `${slugOf(name)}-chaos-${type}` : types.size > 1 ? `${slugOf(name)}-${type}` : slugOf(name));
    }
  }
  for (const u of [...uniqueSlug.keys()].sort((a, b) => seasonOf(b.id) - seasonOf(a.id))) {
    const fixed = [...(u.inherentAffixes ?? []), ...(u.forcedAffixes ?? [])]
      .filter((f: any) => f.id !== u.uniquePower?.id)
      .flatMap((f: any) => (affixById.get(f.id)?.attributes ?? []).map((a: any) => statNameOf(attributeLine(a))))
      .filter((s: string) => s && !s.includes("#"));
    put(T("uniques"), uniqueSlug.get(u)!, {
      n: u.name,
      d: plainText(u.uniquePower?.desc),
      c: classOf(u.classes),
      t: u.itemTypeName ?? u.itemType,
      ...(u.mythic ? { m: 1 as const } : {}),
      ...(fixed.length ? { s: [...new Set<string>(fixed)] } : {}),
    });
  }

  // aspects: "of Berserk Ripping" → "Aspect of Berserk Ripping", "Slaking" → "Slaking Aspect". One several classes share:
  // the first class (A to Z) has the plain slug, the others "-<class>" ("duelists-aspect-druid")
  for (const a of x.aspects?.entries ?? []) {
    if (!a.name) continue;
    const n = /^of\s/i.test(a.name) ? `Aspect ${a.name.trim()}` : `${a.name.trim()} Aspect`;
    const d = a.descPlain ? String(a.descPlain).trim() : plainText(a.desc);
    const classes = classesOf(a.classes);
    if (classes.length <= 1) put(T("aspects"), slugOf(n), { n, d, c: classes[0] });
    else classes.forEach((c, i) => put(T("aspects"), i ? `${slugOf(n)}-${c}` : slugOf(n), { n, d, c }));
  }

  // stats: every affix line's stat name, gear or tempering
  for (const a of x.affixes?.entries ?? []) {
    if (/^(Asp_|Legendary)|_Unique_/.test(a.id ?? "")) continue;
    for (const attr of a.attributes ?? []) {
      const n = statNameOf(attributeLine(attr));
      if (!n || n.length < 3 || n.includes("#") || n.length > 70) continue;
      put(T("stats"), slugOf(n), { n, k: a.tempered ? "tempering" : "gear" });
    }
  }

  // skills: "Barbarian_Whirlwind" → class barbarian
  for (const s of x.powers?.skills ?? []) {
    if (!s.name) continue;
    put(T("skills"), slugOf(s.name), { n: s.name, d: plainText(s.desc), c: classOf(String(s.id ?? "").split("_")[0]) });
  }

  // gems (highest tier's numbers per gem), this season's splinters, and runes
  for (const g of x.gemsRunes?.gems ?? []) {
    if (!g.name) continue;
    const base = String(g.name).replace(/^(Crude|Chipped|Flawed|Regular|Flawless|Royal|Grand)\s+/i, "");
    const d = (g.socketedEffects ?? [])
      .map((e: any) => `${String(e.target).charAt(0).toUpperCase()}${String(e.target).slice(1)}: ${(e.attributes ?? []).map((a: any) => a.textResolved ?? attributeLine(a)).join(", ")}`)
      .join("\n");
    out.gems ??= {};
    out.gems[slugOf(base)] = { n: base, d };
  }
  for (const i of x.items?.entries ?? []) {
    if (!/SeasonalSocketable/i.test(i.itemType ?? "") || !i.name) continue;
    const base = String(i.name).replace(/^(Lesser|Greater|Grand)\s+/i, "");
    put(T("gems"), slugOf(base), { n: base });
  }
  for (const r of x.gemsRunes?.runes ?? []) {
    if (!r.name) continue;
    put(T("runes"), slugOf(r.name), { n: r.name, d: r.runeDescriptionPlain ?? plainText(r.runeDescription), t: String(r.kind ?? "").replace(/^\w/, (c: string) => c.toUpperCase()) });
  }

  // charms and seals
  for (const c of x.charms?.charms ?? []) {
    const n = String(c.name ?? "").trim();
    if (!n) continue;
    const d = [...(c.forcedAffixes ?? []), ...(c.inherentAffixes ?? [])].flatMap((f: any) => (f.attributeText ?? []).map((t: string) => plainText(t.replace(/\{value1?\}/gi, "#")))).join("\n");
    const isSeal = /seal/i.test(`${c.itemType} ${c.itemTypeName} ${c.id}`);
    put(T(isSeal ? "seals" : "charms"), slugOf(n), { n, ...(d ? { d } : {}), ...(c.setBonusName ? { set: c.setBonusName } : {}) });
  }

  // paragon glyphs: one per class that can use it ("barbarian-challenger", "paladin-challenger")
  for (const g of x.paragon?.glyphs ?? []) {
    if (!g.name) continue;
    const d = (g.affixes ?? []).map((a: any) => plainText(a.desc)).filter(Boolean).join("\n");
    const classes = classesOf(g.classes);
    for (const c of classes.length ? classes : ["all"]) put(T("glyphs"), slugOf(`${c} ${g.name}`), { n: g.name, ...(d ? { d } : {}), ...(c !== "all" ? { c } : {}) });
  }

  return out;
}
