// The app's small lookup tables, built from the extracted game data (they used to ship in src/generated/).
//
// Everything here comes from the player's own game files. The OCR vocabulary used to mix in the
// Mobalytics stat names from data/static as well; that is gone, the game's own SkillTagNames and
// skill names cover it.

import type { StringLists } from "./io";

/** The extractor's documents by path, e.g. docs["affixes.json"], docs["strings/ui.json"]. */
export type Docs = Record<string, any>;

const sCat = (docs: Docs, cat: string): StringLists => docs["strings/" + cat + ".json"] ?? {};

// ------------------------------------------------------------------------------------------------
// Infernal Hordes offers and Spoils chests, plus the Tree of Whispers caches

export interface Hordes {
  offers: { key: string; title: string; bane: string; boon: string }[];
  chests: { key: string; name: string; detail: string; cost: number | null }[];
  whisperCaches: { key: string; kind: string; tier: string; name: string; description: string }[];
}

export function genHordes(docs: Docs): Hordes {
  const actors = sCat(docs, "actors");
  const clean = (s: unknown) =>
    (s ?? "")
      .toString()
      .replace(/\{\/?[^}]*\}/g, "")
      .replace(/[ \t]+/g, " ")
      .trim();

  const offers: Hordes["offers"] = [];
  for (const [stl, m] of Object.entries(actors)) {
    const k = stl.match(/^Actor_BSK_PylChoiceGizmo_(\w+)$/)?.[1];
    if (!k || !m.ShortenedName) continue;
    const lines = clean(m.Name).split(/\n+/).map((x) => x.trim()).filter(Boolean);
    offers.push({ key: k, title: clean(m.ShortenedName), bane: lines[0] ?? "", boon: lines.slice(1).join(" ") });
  }

  const chests: Hordes["chests"] = [];
  for (const [stl, m] of Object.entries(actors)) {
    if (!/^Actor_(BSK_UniqueOpChest|Warplans_BSK_TalismanChest)/.test(stl) || /Cheap/.test(stl)) continue;
    const [name, ...rest] = clean(m.Name).split(/\n+/);
    const cost = Number(rest.join(" ").match(/requires\s+(\d+)/i)?.[1] ?? 0) || null;
    chests.push({ key: stl.replace(/^Actor_/, ""), name: name.trim(), detail: rest.join(" ").trim(), cost });
  }

  // Tree of Whispers caches (Grim Favors rewards)
  const items = sCat(docs, "items");
  const whisperCaches: Hordes["whisperCaches"] = [];
  for (const [stl, m] of Object.entries(items)) {
    const k = stl.match(/^Item_BountyMeta_Cache_(\w+)$/)?.[1];
    if (!k || !m.Name || /Bloodied|Event_Bonus/.test(k)) continue;
    const tier = /_Ancestral$/.test(k) ? "ancestral" : /_(Upgraded|Greater)$/.test(k) ? "greater" : "normal";
    const kind = k.replace(/_(Ancestral|Upgraded|Greater)$/, "");
    whisperCaches.push({ key: k, kind, tier, name: clean(m.Name), description: clean(m.Description) });
  }

  return { offers, chests, whisperCaches };
}

// ------------------------------------------------------------------------------------------------
// World-map points of interest
//
// Each poi: { k: kind, n: name (omitted for helltide_chest), r: region (Zone key), x, y: overworld
// world units (rounded), id: stable key } plus optional p (journal part), t (helltide chest tier),
// a: 1 (approximate position: side quests).

/** Kinds the app ships. Quest/campaign dungeons, seasonal rifts and one-off activity portals stay in map.json only. */
const POI_KINDS = ["waypoint", "altar", "tenet_of_akarat", "chronicle_of_creation", "journal", "stronghold",
  "dungeon", "cellar", "boss_dungeon", "undercity", "side_quest", "helltide_chest"];

export function genMapPois(map: any) {
  const pois: any[] = [];
  for (const e of map.entries) {
    if (!POI_KINDS.includes(e.kind) || !e.region) continue;
    const o: any = { k: e.kind, n: e.name, r: e.region, x: Math.round(e.x), y: Math.round(e.y), id: e.hiddenCache || e.item || e.key };
    if (e.extra?.part) o.p = e.extra.part;
    if (e.kind === "helltide_chest") {
      // ~460 spawn points: the name is implied by the kind; id = "<MarkerSet sno>:<marker id>"
      delete o.n;
      o.id = `${e.markerSet}:${e.markerId}`;
      if (e.extra?.tier) o.t = e.extra.tier;
    }
    if (e.precision === "approx") o.a = 1;
    pois.push(o);
  }

  const { span, artSize, artCenter } = map.projection;
  return {
    build: map.build,
    source: "the game files on this PC",
    // zone-map UV: u = artCenter.x/artSize + (y - x)/(span*sqrt2), v = artCenter.y/artSize + (x + y)/(span*sqrt2)
    projection: { span, artSize, artCenter },
    regions: map.regions,
    pois,
  };
}

// ------------------------------------------------------------------------------------------------
// OCR vocabulary: the game's own words and lines, used to snap Windows OCR misreads
// ("Arit10r" -> "Armor") before a tooltip or the character sheet is parsed.

// ---- text helpers (same normalisation as src/lib/ocrfix.ts)
/** "|4Charge:Charges;" -> the singular form (expand() adds the plural form separately) */
const plural = (s: string, n = 1) => s.replace(/\|4([^:;]*):([^;]*);/g, n === 1 ? "$1" : "$2");
/** strip markup; every value placeholder becomes "#" */
function plain(s: unknown) {
  return plural(String(s ?? ""))
    .replace(/\{icon:[^}]*\}/gi, " ")
    .replace(/\[[^\]]*\]/g, "#")
    .replace(/\{(VALUE\d?|vALUE\d?|s\d|SF_\d+|DURATION|payload:[^}]*)\}/g, "#")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
const deaccent = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** words only, lowercase: "+#% Critical Strike Chance (+#%)" -> "critical strike chance" */
const skel = (s: string) =>
  deaccent(s)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\([^)]*\d[^)]*\)/g, " ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const DAMAGE = ["Physical", "Fire", "Lightning", "Cold", "Poison", "Shadow", "Holy", "Non-Physical", "Fire and Holy", "Elemental"];
const RESOURCE = ["Mana", "Fury", "Spirit", "Energy", "Essence", "Vigor", "Faith", "Wrath", "Dominance", "Resource", "Primary Resource"];
const CC = ["Stun", "Slow", "Immobilize", "Freeze", "Daze", "Knock Down", "Chill", "Fear", "Taunt", "Root", "Weaken", "Make Vulnerable", "Pull In"];
const ENEMY = ["Close", "Distant", "Elite", "Injured", "Healthy", "Stunned", "Frozen", "Chilled", "Slowed", "Dazed", "Feared", "Immobilized", "Knocked Down", "Crowd Controlled", "Vulnerable", "Poisoned", "Bleeding", "Burning", "Trapped", "Weakened", "Taunted", "Corrupted"];
const RARITY = ["Common", "Magic", "Rare", "Legendary", "Unique", "Mythic Unique", "Set"];
const GEAR = /^(Helm|Chest Armor|Gloves|Pants|Boots|Ring|Amulet|Shield|Focus|Totem|Sword|Two-Handed Sword|Axe|Two-Handed Axe|Mace|Two-Handed Mace|Staff|Scythe|Two-Handed Scythe|Dagger|Wand|Bow|Crossbow|Hand Crossbow|Polearm|Glaive|Quarterstaff|Flail|Charm|Horadric Seal|Seal|Gem|Rune|Rune of Ritual|Rune of Invocation|Soul Splinter|Whisper Cache|Nightmare Sigil|Elixir|Incense)$/;

export function genOcrVocab(docs: Docs, build: string | null) {
  const strings = {
    ui: sCat(docs, "ui"), items: sCat(docs, "items"), powers: sCat(docs, "powers"),
    affixes: sCat(docs, "affixes"), paragon: sCat(docs, "paragon"), recipes: sCat(docs, "recipes"),
  };
  const affixes: any[] = docs["affixes.json"]?.entries ?? [];
  const aspects: any[] = docs["aspects.json"]?.entries ?? [];
  const uniques: any[] = docs["uniques.json"]?.entries ?? [];
  const items = docs["items.json"] ?? {};
  const gems = docs["gems_runes.json"] ?? {};
  const charms = docs["charms.json"] ?? {};
  const skills: any[] = docs["powers.json"]?.skills ?? [];

  // ---- vocabulary words
  const words = new Set<string>();
  function addWords(s: unknown) {
    for (const w of deaccent(plain(s)).toLowerCase().replace(/[’`]/g, "'").match(/[a-z][a-z'\-]*/g) ?? []) {
      const t = w.replace(/^['\-]+|['\-]+$/g, "");
      if (t.length < 2) continue;
      words.add(t);
      if (t.includes("-")) t.split("-").forEach((p) => p.length > 1 && words.add(p));
    }
  }

  // ---- stat line skeletons
  // The game prints affixes from AttributeDescriptions templates; {VALUE1} is a skill, skill tag,
  // damage type, resource or crowd-control name. Expand with the names the game knows.
  // Skill tag groups ("+4 to Darkness Skills"), from the game's own lists. Only the key families
  // that really are groups:
  //   SkillTagNames  SKILL_TAG_* / PRIMARY_TAG_*  the shared ones (Core, Corpse, Ultimate, Frost)
  //                  the rest of that list is attributes and conditions the in-game search filters
  //                  by (Intelligence, Armor, Cooldown, Vulnerable), which print as stats, not tags
  //   SkillTags      Skill_*_TagName              the class ones (Occult, Judicator, Potency)
  //                  Search_*/Keyword_*/Tag_*/Subpower_* in that list are filters, keywords and
  //                  single skills, and S\d\d_* mixes in seasonal tuning categories
  // The Spiritborn spirits and the Paladin oaths read as tags too, and live in their own lists.
  const tags = new Set<string>();
  const addTag = (v: unknown) => {
    const t = plain(v);
    if (t && t.length < 32 && !/^\[PH\]|#/.test(t)) tags.add(t);
  };
  for (const [k, v] of Object.entries(strings.powers.SkillTagNames ?? {})) if (/^(SKILL_TAG|PRIMARY_TAG)_/.test(k)) addTag(v);
  for (const [k, v] of Object.entries(strings.powers.SkillTags ?? {})) if (/^Skill_.*_TagName$/.test(k)) addTag(v);
  Object.values(strings.powers.SpiritbornMechanic ?? {}).forEach(addTag);
  for (const [k, v] of Object.entries(strings.powers.PaladinOath ?? {})) if (/^Oath\d+Name$/.test(k)) addTag(v);
  const skillNames = new Set(skills.map((s) => plain(s.name)).filter(Boolean));
  const stats = new Set<string>();
  const addStat = (s: string) => {
    if (/\|4/.test(s)) addStat(plural(s, 2));
    const k = skel(plain(s));
    // internal names ("Tag Earthquake", "SubPower …") never reach a tooltip
    if (k && k.length >= 3 && k.split(" ").length <= 14 && !/\b(tag|subpower|value|ph)\b/.test(k)) stats.add(k);
  };
  function expand(tpl: string) {
    if (!/\{VALUE1\}/.test(tpl)) return addStat(tpl);
    // unresolved {VALUE1}: try every plausible filler
    const t = plain(tpl);
    const fill = /Resistance|Damage|Critical/.test(t) ? [...DAMAGE, ...tags] : /Enemies|while/.test(t) ? ENEMY : /Chance to|Duration/.test(t) ? CC : [...RESOURCE, ...tags];
    for (const f of fill) addStat(tpl.replace(/\{VALUE1\}/g, f));
  }
  // only the attribute lines item affixes can actually print
  const attrDesc = strings.powers.AttributeDescriptions ?? {};
  const usedAttrs = new Set(affixes.flatMap((a) => (a.attributes ?? []).map((at: any) => at.attribute)));
  for (const [k, v] of Object.entries(attrDesc)) if (usedAttrs.has(k) && v.length < 140 && !/\r?\n/.test(v)) expand(v);
  for (const a of affixes)
    for (const at of a.attributes ?? []) {
      if (!at.text) continue;
      if (/\{VALUE1\}/.test(at.text) && at.paramDisplayName) addStat(at.text.replace(/\{VALUE1\}/g, at.paramDisplayName));
      else if (!/\{VALUE1\}/.test(at.text)) addStat(at.text);
    }
  for (const g of gems.gems ?? []) for (const e of g.socketedEffects ?? []) for (const at of e.attributes ?? []) at.textResolved && addStat(at.textResolved);
  for (const u of uniques) for (const f of [...(u.forcedAffixes ?? []), ...(u.inherentAffixes ?? [])]) for (const t of f.attributeText ?? []) /\{VALUE1\}/.test(t) || addStat(t);
  // "+3 to Bone Prison" style: the skill's own name after a rank number
  for (const n of skillNames) addStat(`to ${n}`);
  // tooltip base lines that read like stats
  ["Armor", "All Resist", "Damage Per Second", "Damage per Hit", "Attacks per Second", "Attacks per Second (Fast)", "Item Power", "Quality", "Toughness", "Block Chance", "Life"].forEach(addStat);
  // "+4 to Darkness Skills" style for every skill tag the game has
  for (const t of tags) addStat(`to ${t} Skills`);

  // ---- tooltip UI lines (templates with # for numbers)
  const tips = strings.ui.UIToolTips ?? {};
  const ui = new Set<string>();
  for (const k of ["ItemComparePropertiesLost", "AccountBound", "EmptySocket", "UniqueEquipped", "ItemLegendaryPower", "ItemUniquePower", "ItemSetPower", "ItemSealPower", "TooltipScrollUp", "TooltipScrollDown", "ItemHideCompare", "ItemShowCompare", "AlternateTooltip", "ItemMarkJunk", "ItemUnmarkJunk", "ItemLock", "ItemUnlock", "CannotSalvage", "Unmodifiable", "Equipped", "QuickEquip", "QuickUnequip", "LinkToChat", "QuickDrop_Controller", "Tempers", "Durability", "ItemPower", "LostSocket", "TransmogUnlockInstruction", "Seasonal", "ItemCompareSkillChanges", "BindOnAccountEquip", "ItemEntitlementRequirement_X1", "ItemEntitlementRequirement_X2"])
    if (tips[k]) ui.add(plain(tips[k]));
  ["Requires Level #", "Sell Value: #", "Sell Value: Cannot Be Sold", "Cannot Be Sold", "Transfigured", "Amalgamable", "Upgrades an Aspect in the Codex of Power on salvage", "Upgrades an Aspect in the Codex of Power", "on salvage", "Imprinted:", "Mark as Favorite", "# Damage Per Second", "# Damage per Hit", "# All Resist", "# Armor", "Socket", "Character", "Hide", "Compare", "Seasonal Item", "Ancestral", "Sacred"].forEach((s) => ui.add(s));
  for (const k of ["WeaponSpeed_Fast1", "WeaponSpeed_Fast2", "WeaponSpeed_Slow1", "WeaponSpeed_Slow2"]) if (tips[k]) ui.add(`# Attacks per Second ${plain(tips[k])}`);

  // ---- item type lines and names
  // type lines ("Ancestral Legendary Two-Handed Scythe") are combined from these at runtime
  const types = new Set<string>();
  for (const v of Object.values<any>(items.itemTypes ?? {})) if (v && v !== "null" && !/^[A-Z][a-z]+[A-Z]|^#|_|Placeholder/.test(plain(v))) types.add(plain(v));
  ["Horadric Seal", "Charm", "Seal", "Soul Splinter", "Witch Power", "Set Charm", "Unique Charm"].forEach((t) => types.add(t));

  for (const s of [...stats, ...ui, ...types]) addWords(s);
  for (const t of RARITY) addWords(t);
  for (const u of uniques) {
    addWords(u.name);
    addWords(u.flavor);
    addWords(u.uniquePower?.descPlain);
    for (const f of [...(u.forcedAffixes ?? []), ...(u.inherentAffixes ?? [])]) addWords(f.descPlain);
  }
  for (const a of aspects) (addWords(a.name), addWords(a.descPlain));
  for (const a of affixes) {
    addWords(a.name);
    addWords(a.namePrefix);
    addWords(a.nameSuffix);
    if (a.magicType !== 0) addWords(a.descPlain);
  }
  for (const e of items.entries ?? []) if (GEAR.test(e.itemTypeName ?? "")) addWords(e.name);
  for (const [stl, m] of Object.entries(strings.items)) if (/^RareNameStrings|^ItemType_|^TalismanRarityNames|^ItemLabels/.test(stl)) Object.values(m).forEach(addWords);
  for (const g of gems.gems ?? []) (addWords(g.name), addWords(g.flavor));
  for (const r of gems.runes ?? []) (addWords(r.name), addWords(r.runeDescriptionPlain));
  for (const c of charms.charms ?? []) (addWords(c.name), addWords(c.setBonusName));
  for (const b of charms.setBonuses ?? []) {
    addWords(b.name);
    for (const t of b.tiers ?? []) addWords(t.affix?.descPlain);
  }
  skillNames.forEach(addWords);
  // keyword tooltips under item powers ("Resolve increases your Armor by 25% while active.")
  for (const [stl, m] of Object.entries(strings.ui)) if (/^(Keyword|Tooltip|Glossary)/i.test(stl)) Object.values(m).forEach((v) => v.length < 400 && addWords(v));

  // ---- character sheet (Character -> Stats & Materials)
  const hero = strings.ui.HeroDetailsEntries ?? {};
  const sheet = new Set<string>();
  const currency = new Set<string>();
  for (const [k, v] of Object.entries(hero)) {
    if (!k.endsWith("_name") || !v || /^\[PH\]/.test(v)) continue;
    const tip = hero[k.replace(/_name$/, "_tooltip")] ?? "";
    const names = /\{(PRIMARY|SECONDARY)_RESOURCE\}/.test(v) ? RESOURCE.slice(0, 9).map((r) => v.replace(/\{(PRIMARY|SECONDARY)_RESOURCE\}/, r)) : [v];
    // materials tab entries: "Used to purchase…", "Earned from…"
    const isCurrency = /\b(used to|used in|earned (from|by)|exchanged for|currency)\b/i.test(plain(tip)) && !/damage|resist|armor|life|maximum/i.test(v);
    for (const n of names) (isCurrency ? currency : sheet).add(plain(n));
  }
  sheet.add("Weapon Damage"); // the big number under the portrait
  const hd = strings.ui.HeroDetails ?? {};
  const headers = new Set(["Stats & Materials", "Materials", "Equipment", "Character", "Currency"]);
  for (const k of ["CategoryOffense", "CategoryDefenses", "CategoryUtility", "CategoryCoreStats", "PvP", "Resistances", "CategoryWeaponDamage", "CategoryToughness", "CategoryMaterials", "Currencies", "Offensive", "Defensive", "Utility", "CoreStats"])
    if (hd[k]) headers.add(plain(hd[k]));
  [...sheet, ...currency, ...headers].forEach(addWords);

  const sorted = (s: Set<string>) => [...s].sort();
  return {
    meta: { source: "game files " + (build ?? ""), generatedAt: new Date().toISOString() },
    words: sorted(words).join(" "),
    stats: sorted(stats),
    ui: sorted(ui),
    types: sorted(types),
    rarity: RARITY,
    sheet: { stats: sorted(sheet), currency: sorted(currency), headers: sorted(headers) },
  };
}
