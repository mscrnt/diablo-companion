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
  powers?: { skills: any[]; seasonalPowers?: any[] };
  gemsRunes?: { gems: any[]; runes: any[] };
  charms?: { charms: any[]; setBonuses: any[] };
  paragon?: { boards: any[]; nodes: any[]; glyphs: any[] };
  items?: { entries: any[] };
  monsters?: { actors: any[] };
  /** gbid.json: the GameBalance name tables an affix parameter can point into. */
  gbid?: { skillTags?: string[] };
  /** strings/{items,powers,actors,world}.json merged: StringList name → its labels. */
  strings?: Record<string, Record<string, string>>;
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
  s = s.replace(/\{(?:c_[^}]*|\/c[^}]*|u|\/u|icon:[^}]*|\/?b|\/?i)\}/gi, "");
  s = s.replace(/\|4([^:;]*):([^;]*);/g, "$1"); // "|4second:seconds;" → the singular form
  s = s.replace(/\{[^{}]*\}/g, "#");
  s = s.split(MULT).join("[x]").split(ADD).join("[+]");
  return s
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** "TwoHandedBludgeoning" / "On_Hit_Execute_Chance" → "Two Handed Bludgeoning" / "On Hit Execute Chance". */
const idWords = (id: unknown) =>
  String(id ?? "")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/_/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---- affix parameters -------------------------------------------------------------------------
// Many tooltip lines keep a blank for their parameter: "+[{VALUE2}*100|1%|] Damage to {VALUE1} Enemies"
// with param 2. The extractor fills it in when the param is a power SNO (paramDisplayName); the rest are
// GameBalance ids (skill tags) or bare enum values, and paramResolver() below works those out.

/** The game's GameBalance id: djb2 over the lowercased name, kept as a signed 32-bit int (as affix params are). */
function gbidHash(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = ((h << 5) + h + name.charCodeAt(i)) >>> 0;
  return h | 0;
}

/** Words in an affix id that say nothing about which enum value it carries: seasons, rarities, slots, tiers. */
const ID_NOISE = new RegExp(
  `^(?:${[
    ...CLASSES, "barb", "necro", "sorc", "all",
    "s\\d\\d", "x\\d", "ph", "qst", "ptr", "old", "new", "zzold",
    "uber", "unique", "uberunique", "inherent", "tempered", "runeword", "cube", "horadric", "transfiguration", "transfigured",
    "talisman", "charm", "seal", "sealaffix", "set", "affix", "reroll", "tier\\d*", "generic", "jewelry", "magiconly",
    "single", "dual", "double", "triple", "quad", "greater", "lesser", "higher", "lower", "big", "verybig", "giga", "always\\d*",
    "bonus", "reduction", "percent", "pct", "only", "with", "from", "and", "the", "for", "against", "per",
  ].join("|")})$`,
  "i",
);

/**
 * The label the game's own data gives each bare enum parameter, worked out per attribute from the affix ids
 * that carry it: `Damage_to_Stunned` has param 2, `Lucky_Hit_Stun` has 2 as well, `Resistance_Single_Poison`
 * has 4. Returns "Damage_Percent_Bonus_Vs_CC_Target#2" → "Stunned". The affix id keeps the wording the line
 * needs ("Stunned" for "Damage to {VALUE1} Enemies", "Stun" for "Chance to {VALUE1}").
 */
export function enumParamLabels(affixes: any[]): Map<string, string> {
  // attribute → param → the affix ids that use it
  const byAttr = new Map<string, Map<number, string[]>>();
  for (const a of affixes)
    for (const at of a.attributes ?? []) {
      if (!needsParam(at) || at.paramName || !Number.isInteger(at.param)) continue;
      if (Math.abs(at.param) > 1000) continue; // a GameBalance id, not an enum value
      const m = byAttr.get(at.attribute) ?? new Map<number, string[]>();
      m.set(at.param, [...(m.get(at.param) ?? []), String(a.id ?? "")]);
      byAttr.set(at.attribute, m);
    }
  const out = new Map<string, string>();
  for (const [attr, params] of byAttr) {
    const own = new Set(idWords(attr).toLowerCase().split(" "));
    const words = (id: string) => [...new Set(idWords(id).split(" ").filter((w) => w.length > 2 && !ID_NOISE.test(w) && !own.has(w.toLowerCase())))];
    // how much of each param's ids a word covers, so a word shared with a sibling param counts for neither
    const share = new Map<number, Map<string, number>>();
    for (const [p, ids] of params) {
      const c = new Map<string, number>();
      for (const id of ids) for (const w of words(id)) c.set(w.toLowerCase(), (c.get(w.toLowerCase()) ?? 0) + 1 / ids.length);
      share.set(p, c);
    }
    for (const [p, ids] of params) {
      let best = "";
      let score = 0.4; // below this the ids don't agree on a label
      for (const [w, s] of share.get(p)!) {
        let elsewhere = 0;
        for (const [q, c] of share) if (q !== p) elsewhere = Math.max(elsewhere, c.get(w) ?? 0);
        if (s - elsewhere > score) {
          score = s - elsewhere;
          best = w;
        }
      }
      const cased = ids.flatMap((id) => words(id)).find((w) => w.toLowerCase() === best);
      if (cased) out.set(`${attr}#${p}`, cased);
    }
  }
  return out;
}

/** Does this attribute's tooltip line still have a blank for its parameter? */
const needsParam = (attr: any) => /\{value1?\}/i.test(String(attr?.textPlain ?? attr?.text ?? ""));

/** Fills the `{VALUE1}` blank in an attribute's line, from the game's own name tables. */
export function paramResolver(x: Extracted): (attr: any) => string {
  const tagNames = x.strings?.SkillTags ?? {};
  const itemReqs = x.strings?.ItemRequirements ?? {};
  const byHash = new Map<number, string>((x.gbid?.skillTags ?? []).map((t) => [gbidHash(t.toLowerCase()), t]));
  const enums = enumParamLabels(x.affixes?.entries ?? []);
  // the extractor matches a power param's StringList case-sensitively, so "Druid_landslide" finds nothing
  const powerName = new Map<string, string>();
  for (const [list, labels] of Object.entries(x.strings ?? {}))
    if (/^Power_/.test(list) && (labels.name || labels.Name)) powerName.set(list.slice(6).toLowerCase(), labels.name ?? labels.Name);
  return (attr: any) => {
    if (attr?.paramDisplayName) return String(attr.paramDisplayName); // a power: already named by the extractor
    if (attr?.paramName && powerName.has(String(attr.paramName).toLowerCase())) return powerName.get(String(attr.paramName).toLowerCase())!;
    if (attr?.paramName && itemReqs[attr.paramName]) return itemReqs[attr.paramName]; // "Two-Handed Bludgeoning Weapons"
    const tag = byHash.get(attr?.param);
    if (tag) return tagNames[`${tag}_TagName`] ?? idWords(tag.replace(/^Skill_(Primary_)?/, "")); // "Core", "Centipede"
    return enums.get(`${attr?.attribute}#${attr?.param}`) ?? (attr?.paramName ? idWords(attr.paramName) : "");
  };
}

/** An affix attribute's line ("+[{VALUE2}] Maximum {VALUE1}" with its parameter) as plain text: "+# Maximum Mana". */
export function attributeLine(attr: any, param?: (a: any) => string): string {
  const t = String(attr?.textPlain ?? attr?.text ?? "");
  const p = param ? param(attr) : (attr?.paramDisplayName ?? idWords(attr?.paramName));
  return plainText(t.replace(/\{VALUE1\}/gi, p || "{VALUE1}").replace(/\{VALUE2?\}/gi, "#")).replace(/\s+/g, " ");
}

/**
 * "+#% Attack Speed" → "Attack Speed", "Lucky Hit: Up to a #% Chance to Stun for 2 Seconds" → "Lucky Hit:
 * Chance to Stun for 2 Seconds": the stat's name, without the numbers the item rolls.
 */
export const statNameOf = (line: string) =>
  line
    .replace(/[+x\-]?\s*#\s*(%\[[x+]\]|%)?/gi, "")
    .replace(/\bup to an? *[\d.,]*%? *(?=chance)/i, "") // the value is gone, so the "up to a …" that introduced it goes too
    .replace(/^to /, "Ranks to ") // "+2 to Core Skills" is "Ranks to Core Skills"
    .replace(/\s+/g, " ")
    .replace(/^[\s,:.]+|[\s,]+$/g, "")
    .trim();

/** The stat an attribute names ("Damage to Stunned Enemies"), or "" when its line still has a blank. */
function statOf(attr: any, param: (a: any) => string): string {
  if (needsParam(attr) && !param(attr)) return "";
  const n = statNameOf(attributeLine(attr, param));
  return n.includes("#") ? "" : n;
}

function put(t: Record<string, SlimEntry>, slug: string, e: SlimEntry) {
  if (!slug || !e.n) return;
  // the first one wins, except that a real description beats an empty one
  if (!t[slug] || (!t[slug].d && e.d)) t[slug] = e;
}

/** "S14_Helm_Unique_…" → 14: the season a game entry was added or reworked in (0 for the original). */
const seasonOf = (id: unknown) => Number(String(id ?? "").match(/^S(\d+)_/)?.[1] ?? 0);

/**
 * The game's item type as builds name it: "Two-Handed Axe" → "2h Axe", "Axe" → "1h Axe", "Focus" → "Focus".
 * The weapon bases say which hand they are in their type id, not their name ("Sword_Phase_Blade" is a 1h
 * sword, "Mace2HDruid" a 2h mace), so read the id first and fall back to the display name.
 */
const WEAPON_TYPE = /^(Sword|Axe|Mace|Scythe|Dagger)(2H)?/;
const itemTypeName = (name: unknown, id?: unknown) => {
  const hand = WEAPON_TYPE.exec(String(id ?? ""));
  if (hand) return `${hand[2] ? "2h" : "1h"} ${hand[1]}`;
  const s = String(name ?? "").trim();
  return /^Two-Handed /.test(s) ? s.replace(/^Two-Handed /, "2h ") : s;
};

/** Aspect `category` → the group the Codex shows it under. */
const ASPECT_KINDS = ["Offensive", "Defensive", "Utility", "Resource", "Mobility"];

/** Druid shapeshift upgrades: the skill tree shows these as a choice, so they keep the form's bare name. */
const FORM_MOD = /^(Werewolf|Werebear|Human|Versatile)$/i;
/**
 * An upgrade named after the stat it changes ("Damage Bonus", "Movement Speed") is a talent; one with a name
 * of its own ("Bursting", "Tornado") is an enhancement. The tree's own layout is not in the extracted data.
 */
const STAT_LABEL =
  /\b(bonus|increase|increased|reduction|generation|chance|speed|duration|size|cost|healing|damage|radius|count|stacks?|strikes?|range|charges?|cooldown|resource|fury|essence|mana|spirit|energy|ferocity|unstoppable|vulnerable|weaken|slow|fortify|barrier|overpower|crit|critical|life|armor|armour|resistance|thorns|dodge|limit)\b/i;

/**
 * The named upgrades of one skill, in tree order. Most read as "Whirlwind: Bursting"; one whose name already
 * says the skill ("Enhanced Whirlwind") is listed under that name too, since builds use either wording.
 */
function skillUpgrades(skill: any): { slug: string; name: string; desc: string; kind: string }[] {
  const st = skill?.strings ?? {};
  const name = String(skill?.name ?? "");
  if (!name) return [];
  const mods = Object.keys(st)
    .map((k) => /^Mod(\d+)_Name$/.exec(k))
    .filter(Boolean)
    .map((m) => ({ i: Number(m![1]), n: String(st[m![0]]), d: String(st[`Mod${m![1]}_Description`] ?? "") }))
    .sort((a, b) => a.i - b.i);
  // an upgrade that adds a new hit (its own damage payload) belongs to the first, "enhancement" run
  const named = (m: { n: string; d: string }) => new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(m.n);
  const adds = (m: { n: string; d: string }) => !STAT_LABEL.test(m.n) && (/\{payload:|\{dot:/i.test(m.d) || /\balso\b|becomes an? /i.test(m.d));
  let last = -1;
  mods.forEach((m, i) => {
    if (named(m) || adds(m)) last = i;
  });
  return mods.flatMap((m, i) => {
    const desc = plainText(m.d);
    const kind = FORM_MOD.test(m.n) ? "choice-connector" : i <= last && !STAT_LABEL.test(m.n) ? "enhancement" : "talent";
    // the shapeshift choices stay bare ("Werebear"); the others take the skill's name as a prefix
    if (FORM_MOD.test(m.n)) return [{ slug: `${slugOf(name)}-${slugOf(m.n)}`, name: m.n.trim(), desc, kind }];
    const both = [{ slug: slugOf(`${name} ${m.n}`), name: `${name}: ${m.n}`, desc, kind }];
    if (named(m)) {
      const bare = m.n.replace(new RegExp(`\\b${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i"), "");
      both.push({ slug: `${slugOf(name)}-${slugOf(bare)}`, name: m.n.trim(), desc, kind });
    }
    return both;
  });
}

const PLACEHOLDER = /^\s*[([](?:PH|WIP|NYI)[)\]]/i;

/** The tables, from the extractor's output. */
export function convert(x: Extracted): Tables {
  const out = { meta: { source: "game files on this PC", build: x.build ?? null, converted: new Date().toISOString() } } as unknown as Tables;
  const T = (k: string) => (out[k] ??= {});
  const affixById = new Map<string, any>((x.affixes?.entries ?? []).map((a) => [a.id, a]));
  const param = paramResolver(x);
  const S = (list: string) => x.strings?.[list] ?? {};

  // uniques: the unique power, the item type and the stats it always rolls. "S10_…" entries are the chaos versions on
  // other item types ("mjolnic-ryng-chaos-helm"), "S14_…" a rework (its text is current); one name on several item
  // types gets the type in its slug and in its name ("Ancient's Pledge (Focus)"). Season 15 runewords, and a handful
  // of one-off uniques whose id doesn't say "_Unique_", are only in the item index: their power lives in an affix
  // named after the item ("Runeword_Grief"), and the rest comes from the item itself.
  const named = new Map<string, any>();
  for (const a of x.affixes?.entries ?? []) if (a.magicType === 2 && (a.desc || a.descPlain)) named.set(a.id, a);
  const gearTypes = new Set((x.uniques?.entries ?? []).map((u) => u.itemType));
  const extra = (x.items?.entries ?? [])
    .filter((i) => {
      if (!i.name || i.placeholder || (i.magicType !== 2 && i.magicType !== 4)) return false;
      if (/^(S\d\d_)?Runeword_/.test(i.id)) return true;
      // the rest has to look like a wearable item: no cosmetics, transmogs, store copies or UI stand-ins
      if (!gearTypes.has(i.itemType) || i.name === i.itemTypeName) return false;
      return !/(^|_)(QA|QST|PTR|TEST|Test|zzOld|Debug|Cheat)|_Cosmetic_|_TransmogItem|_Random_Mythic|_stor|test/i.test(i.id) && !/\[ph\]|\(PH\)/i.test(i.name);
    })
    .map((i) => ({
      ...i,
      runeword: /^(S\d\d_)?Runeword_/.test(i.id),
      uniquePower: [...named.values()].find((a) => i.id === a.id || String(i.id).startsWith(`${a.id}_`)) ?? null,
    }));

  const byName = new Map<string, any[]>();
  const known = new Set((x.uniques?.entries ?? []).map((u) => u.name));
  for (const u of [...(x.uniques?.entries ?? []), ...extra.filter((i) => !known.has(i.name))]) if (u.name) byName.set(u.name, [...(byName.get(u.name) ?? []), u]);
  const uniqueSlug = new Map<any, string>();
  const uniqueName = new Map<any, string>();
  for (const [name, list] of byName) {
    const types = new Set(list.filter((u) => seasonOf(u.id) !== 10).map((u) => itemTypeName(u.itemTypeName, u.itemType)));
    for (const u of list) {
      const type = itemTypeName(u.itemTypeName, u.itemType);
      uniqueSlug.set(u, seasonOf(u.id) === 10 ? `${slugOf(name)}-chaos-${slugOf(type)}` : types.size > 1 ? `${slugOf(name)}-${slugOf(type)}` : slugOf(name));
      // a runeword exists on a dozen weapons, and the game names every copy the same: say which one this is
      uniqueName.set(u, u.runeword && types.size > 1 ? `${name} (${type})` : name);
    }
  }
  for (const u of [...uniqueSlug.keys()].sort((a, b) => seasonOf(b.id) - seasonOf(a.id))) {
    const fixed = [...(u.inherentAffixes ?? []), ...(u.forcedAffixes ?? [])]
      .filter((f: any) => f.id !== u.uniquePower?.id)
      .flatMap((f: any) => (affixById.get(f.id)?.attributes ?? []).map((a: any) => statOf(a, param)))
      .filter(Boolean);
    put(T("uniques"), uniqueSlug.get(u)!, {
      n: uniqueName.get(u)!,
      d: plainText(u.uniquePower?.desc),
      c: classOf(u.classes),
      t: itemTypeName(u.itemTypeName, u.itemType),
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
    const t = ASPECT_KINDS[a.category];
    const classes = classesOf(a.classes);
    if (classes.length <= 1) put(T("aspects"), slugOf(n), { n, d, c: classes[0], ...(t ? { t } : {}) });
    else classes.forEach((c, i) => put(T("aspects"), i ? `${slugOf(n)}-${c}` : slugOf(n), { n, d, c, ...(t ? { t } : {}) }));
  }

  // stats: every affix line's stat name. Gear, the implicit (inherent) line of a slot, a tempering option, or a
  // Kullean transfiguration; the affix's own parameter fills the blank in its line ("Cold Resistance")
  const talentByPower = new Map<string, string>();
  for (const s of x.powers?.skills ?? []) if (s.name) talentByPower.set(String(s.id).toLowerCase(), s.name);
  for (const a of x.affixes?.entries ?? []) {
    if (/^(Asp_|Legendary)|_Unique_/.test(a.id ?? "")) continue;
    const k = a.tempered ? "tempering" : (a.affixTags ?? []).includes("Transfigured") ? "transfigured" : a.affixType === 0 ? "implicit" : "gear";
    // the "+Ranks to <passive>" amulet affixes carry a stand-in attribute; the talent they rank is in their id
    const passive = /PassiveRankBonus_([A-Za-z]+)_(.+)_[A-Za-z]+$/.exec(a.id ?? "");
    if (passive) {
      const cls = classOf(passive[1]);
      const n = cls && (talentByPower.get(`${cls}_talent_${passive[2].toLowerCase()}`) ?? talentByPower.get(`${cls}_passive_${passive[2].toLowerCase()}`));
      if (n) put(T("stats"), slugOf(`Ranks to ${n}`), { n: `Ranks to ${n}`, k });
    }
    for (const attr of a.attributes ?? []) {
      const n = statOf(attr, param);
      // the same stat is written several ways: the game's tooltip line, that line without the duration it
      // spells out, and — for a tool with no string table, which is how most build sites list it — the
      // attribute's own name. Register all of them so a build naming any of them resolves.
      for (const alias of [n, n.replace(/ for [\d.]+ seconds?$/i, ""), statNameOf(idWords(attr.attribute))]) {
        if (!alias || alias.length < 3 || alias.length > 70) continue;
        put(T("stats"), slugOf(alias), { n: alias, k });
      }
    }
  }

  // skills: "Barbarian_Whirlwind" → class barbarian, plus every named upgrade the skill tree offers under it
  // ("Whirlwind: Bursting", "Enhanced Whirlwind") from the skill's ModN_Name / ModN_Description strings
  for (const s of x.powers?.skills ?? []) {
    // the class leads the id, after an expansion or season prefix at most ("X1_Barbarian_WeaponThrow")
    const c = classOf(String(s.id ?? "").split("_").slice(0, 2).filter((p) => CLASSES.some((k) => k.startsWith(p.slice(0, 4).toLowerCase())))[0]);
    if (!s.name || !c || PLACEHOLDER.test(s.name)) continue;
    const t = /_(Talent|Passive)(_|$)/.test(s.id) ? "talent" : "basic";
    put(T("skills"), slugOf(s.name), { n: s.name, d: plainText(s.desc), c, t });
    for (const u of skillUpgrades(s)) {
      if (PLACEHOLDER.test(u.name)) continue;
      put(T("skills"), u.slug, { n: u.name, d: u.desc, c, t: u.kind });
    }
  }

  // gems (highest tier's numbers per gem), this season's splinters, and runes. The runes come from the item index
  // (gems_runes.json misses the "S15_Rune_*" ones) with their effect text from the item's own StringList
  for (const g of x.gemsRunes?.gems ?? []) {
    if (!g.name) continue;
    const base = String(g.name).replace(/^(Crude|Chipped|Flawed|Regular|Flawless|Royal|Grand)\s+/i, "");
    const d = (g.socketedEffects ?? [])
      .map((e: any) => `${String(e.target).charAt(0).toUpperCase()}${String(e.target).slice(1)}: ${(e.attributes ?? []).map((a: any) => a.textResolved ?? attributeLine(a, param)).join(", ")}`)
      .join("\n");
    out.gems ??= {};
    out.gems[slugOf(base)] = { n: base, d };
  }
  for (const i of x.items?.entries ?? []) {
    if (!/SeasonalSocketable/i.test(i.itemType ?? "") || !i.name) continue;
    const base = String(i.name).replace(/^(Lesser|Greater|Grand)\s+/i, "");
    put(T("gems"), slugOf(base), { n: base });
  }
  const runeText = new Map<string, string>((x.gemsRunes?.runes ?? []).map((r) => [String(r.id), r.runeDescriptionPlain ?? plainText(r.runeDescription)]));
  for (const i of x.items?.entries ?? []) {
    if (!/^(Condition|Effect)Rune$/.test(i.itemType ?? "") || !i.name || /^RuneCrafting_/.test(i.id ?? "")) continue;
    const d = runeText.get(String(i.id)) ?? plainText(S(`Item_${i.id}`).RuneDescription);
    put(T("runes"), slugOf(i.name), { n: i.name, ...(d ? { d } : {}), t: String(i.itemTypeName ?? "").replace(/^Rune of /, "") || (/^Condition/.test(i.itemType) ? "Ritual" : "Invocation") });
  }

  // charms and seals: one a class owns keeps the plain slug, one several classes share gets "-<class>" too
  for (const c of x.charms?.charms ?? []) {
    const n = String(c.name ?? "").trim();
    if (!n) continue;
    const d = [...(c.forcedAffixes ?? []), ...(c.inherentAffixes ?? [])].flatMap((f: any) => (f.attributeText ?? []).map((t: string) => plainText(t.replace(/\{value1?\}/gi, "#")))).join("\n");
    const isSeal = /seal/i.test(`${c.itemType} ${c.itemTypeName} ${c.id}`);
    const entry = { n, ...(d ? { d } : {}), ...(c.setBonusName ? { set: c.setBonusName } : {}) };
    const classes = classesOf(c.classes);
    if (isSeal || classes.length <= 1) put(T(isSeal ? "seals" : "charms"), slugOf(n), { ...entry, c: classes[0] });
    else classes.forEach((cls, i) => put(T("charms"), i ? `${slugOf(n)}-${cls}` : slugOf(n), { ...entry, c: cls }));
  }

  // paragon: boards, the nodes at each square of their grid ("barbarian-blood-rage-x10-y5"), and the glyphs.
  // A magic node has no name of its own, so it takes the label the board screen gives its kind.
  const nodeById = new Map<string, any>((x.paragon?.nodes ?? []).map((n) => [n.id, n]));
  const ui = S("ParagonBoardUI");
  const NODE_KIND = [
    { t: "glyph-socket", of: (n: any) => n.socket, label: ui.GlyphSocket },
    { t: "legendary-node", of: (n: any) => n.rarity >= 4, label: ui.NodeTypeLegendary },
    { t: "rare-node", of: (n: any) => n.rarity >= 3, label: ui.NodeTypeRare },
    { t: "magic-node", of: (n: any) => n.rarity >= 2, label: ui.NodeTypeMagic },
  ];
  for (const b of x.paragon?.boards ?? []) {
    if (!b.name) continue;
    const c = classOf(b.classHint);
    const board = slugOf(`${c ?? "generic"} ${b.name}`);
    put(T("boards"), board, { n: b.name, c });
    (b.grid ?? []).forEach((row: any[], y: number) =>
      row.forEach((id, col) => {
        const node = nodeById.get(id);
        const kind = node && NODE_KIND.find((k) => k.of(node));
        if (!kind) return; // the plain stat tiles and the gates the app never names
        const d = (node.attributes ?? []).map((a: any) => attributeLine(a, param)).filter(Boolean).join("\n");
        // the board screen counts its squares from 1
        put(T("nodes"), `${board}-x${col + 1}-y${y + 1}`, { n: node.name ?? plainText(kind.label), ...(d ? { d } : {}), t: kind.t });
      }),
    );
  }
  // paragon glyphs: one per class that can use it ("barbarian-challenger", "paladin-challenger")
  for (const g of x.paragon?.glyphs ?? []) {
    if (!g.name) continue;
    const d = (g.affixes ?? []).map((a: any) => plainText(a.desc)).filter(Boolean).join("\n");
    const classes = classesOf(g.classes);
    for (const c of classes.length ? classes : ["all"]) put(T("glyphs"), slugOf(`${c} ${g.name}`), { n: g.name, ...(d ? { d } : {}), ...(c !== "all" ? { c } : {}) });
  }

  // this season's Chaos perks (CollectiblePower), and the War Plans activity trees
  for (const p of x.powers?.seasonalPowers ?? []) {
    if (!/ChaosPerk/i.test(p.id ?? "") || !p.name) continue;
    put(T("chaosPerks"), slugOf(p.name), { n: p.name, d: p.descPlain ?? plainText(p.desc) });
  }
  for (const [list, labels] of Object.entries(x.strings ?? {})) {
    if (!/^GenericSkillTree_Warplans_/.test(list) || !labels.Name) continue;
    put(T("wpTrees"), slugOf(labels.Name), { n: labels.Name });
  }

  // mercenaries: the four hirelings, their skill trees, and the triggers a reinforcement can be set to
  const mercTitle = new Map<string, string>();
  for (const [label, text] of Object.entries(S("Achievement_X1_Achievement_Mercenaries_Level10_AllMercenaries")))
    if (/^Crit_/.test(label) && text.includes(",")) mercTitle.set(text.split(",")[0].trim(), text);
  for (const a of x.monsters?.actors ?? []) {
    if (!/^Mercenary_/.test(a.id ?? "") || !a.name) continue;
    const n = mercTitle.get(String(a.name)) ?? a.name;
    put(T("mercs"), slugOf(n), { n });
  }
  for (const s of x.powers?.skills ?? []) {
    if (!/Mercenary_/i.test(s.id ?? "") || /_enemy$/i.test(s.id) || !s.name) continue;
    put(T("mercSkills"), slugOf(s.name), { n: s.name, d: plainText(s.desc) });
  }
  for (const [label, text] of Object.entries(S("MercenaryUI"))) {
    if (!/^Opportunity_.*_Description$/.test(label) || /\{powername\}/i.test(text)) continue;
    const n = plainText(text).replace(/\.$/, "");
    put(T("mercOpp"), slugOf(n), { n });
  }

  return out;
}
