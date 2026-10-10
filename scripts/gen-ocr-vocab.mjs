// Build src/generated/ocr-vocab.json: the game's own words and lines, used to snap
// Windows OCR misreads ("Arit10r" → "Armor") before a tooltip or the character sheet
// is parsed. Sources: the datamined enUS strings and tables in data/gamedata (not
// shipped) plus the Mobalytics names in data/static. Re-run after a patch:
//   node scripts/gen-ocr-vocab.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const gd = (f) => JSON.parse(readFileSync(join(root, "data/gamedata", f), "utf8"));
const st = (f) => (existsSync(join(root, "data/static", f)) ? JSON.parse(readFileSync(join(root, "data/static", f), "utf8")) : {});

const strings = Object.fromEntries(["ui", "items", "powers", "affixes", "paragon", "recipes"].map((f) => [f, gd(`strings/${f}.json`)]));
const affixes = gd("affixes.json").entries;
const aspects = gd("aspects.json").entries;
const uniques = gd("uniques.json").entries;
const items = gd("items.json");
const gems = gd("gems_runes.json");
const charms = gd("charms.json");
const skills = gd("powers.json").skills ?? [];

// ---- text helpers (same normalisation as src/lib/ocrfix.ts) --------------------------------
// "|4Charge:Charges;" → the singular form (expand() adds the plural form separately)
const plural = (s, n = 1) => s.replace(/\|4([^:;]*):([^;]*);/g, n === 1 ? "$1" : "$2");
/** strip markup; every value placeholder becomes "#" */
function plain(s) {
  return plural(String(s ?? ""))
    .replace(/\{icon:[^}]*\}/gi, " ")
    .replace(/\[[^\]]*\]/g, "#")
    .replace(/\{(VALUE\d?|vALUE\d?|s\d|SF_\d+|DURATION|payload:[^}]*)\}/g, "#")
    .replace(/\{[^}]*\}/g, "")
    .replace(/\r?\n/g, " ")
    .replace(/[ \t]+/g, " ")
    .trim();
}
const deaccent = (s) => s.normalize("NFD").replace(/[̀-ͯ]/g, "");
/** words only, lowercase: "+#% Critical Strike Chance (+#%)" → "critical strike chance" */
const skel = (s) =>
  deaccent(s)
    .toLowerCase()
    .replace(/[’`]/g, "'")
    .replace(/\([^)]*\d[^)]*\)/g, " ")
    .replace(/[^a-z' ]+/g, " ")
    .replace(/(^|\s)'+|'+(?=\s|$)/g, " ")
    .replace(/\s+/g, " ")
    .trim();

// ---- vocabulary words -----------------------------------------------------------------------
const words = new Set();
function addWords(s) {
  for (const w of deaccent(plain(s)).toLowerCase().replace(/[’`]/g, "'").match(/[a-z][a-z'\-]*/g) ?? []) {
    const t = w.replace(/^['\-]+|['\-]+$/g, "");
    if (t.length < 2) continue;
    words.add(t);
    if (t.includes("-")) t.split("-").forEach((p) => p.length > 1 && words.add(p));
  }
}

// ---- stat line skeletons ---------------------------------------------------------------------
// The game prints affixes from AttributeDescriptions templates; {VALUE1} is a skill, skill tag,
// damage type, resource or crowd-control name. Expand with the names we know.
const DAMAGE = ["Physical", "Fire", "Lightning", "Cold", "Poison", "Shadow", "Holy", "Non-Physical", "Fire and Holy", "Elemental"];
const RESOURCE = ["Mana", "Fury", "Spirit", "Energy", "Essence", "Vigor", "Faith", "Wrath", "Dominance", "Resource", "Primary Resource"];
const CC = ["Stun", "Slow", "Immobilize", "Freeze", "Daze", "Knock Down", "Chill", "Fear", "Taunt", "Root", "Weaken", "Make Vulnerable", "Pull In"];
const ENEMY = ["Close", "Distant", "Elite", "Injured", "Healthy", "Stunned", "Frozen", "Chilled", "Slowed", "Dazed", "Feared", "Immobilized", "Knocked Down", "Crowd Controlled", "Vulnerable", "Poisoned", "Bleeding", "Burning", "Trapped", "Weakened", "Taunted", "Corrupted"];
const tags = new Set();
const skillNames = new Set(skills.map((s) => plain(s.name)).filter(Boolean));
const statNames = Object.values(st("stats.json")).map((v) => v?.displayName || v?.name).filter(Boolean);
for (const n of statNames) {
  const m = n.match(/^Ranks? to (.+?) Skills$/i) ?? n.match(/^(.+?) Skill Damage$/i);
  if (m) tags.add(m[1]);
}
const stats = new Set();
const addStat = (s) => {
  if (/\|4/.test(s)) addStat(plural(s, 2));
  const k = skel(plain(s));
  // internal names ("Tag Earthquake", "SubPower …") never reach a tooltip
  if (k && k.length >= 3 && k.split(" ").length <= 14 && !/\b(tag|subpower|value|ph)\b/.test(k)) stats.add(k);
};
function expand(tpl) {
  if (!/\{VALUE1\}/.test(tpl)) return addStat(tpl);
  // unresolved {VALUE1}: try every plausible filler
  const t = plain(tpl);
  const fill = /Resistance|Damage|Critical/.test(t) ? [...DAMAGE, ...tags] : /Enemies|while/.test(t) ? ENEMY : /Chance to|Duration/.test(t) ? CC : [...RESOURCE, ...tags];
  for (const f of fill) addStat(tpl.replace(/\{VALUE1\}/g, f));
}
// only the attribute lines item affixes can actually print
const attrDesc = strings.powers.AttributeDescriptions ?? {};
const usedAttrs = new Set(affixes.flatMap((a) => (a.attributes ?? []).map((at) => at.attribute)));
for (const [k, v] of Object.entries(attrDesc)) if (usedAttrs.has(k) && v.length < 140 && !/\r?\n/.test(v)) expand(v);
for (const a of affixes)
  for (const at of a.attributes ?? []) {
    if (!at.text) continue;
    if (/\{VALUE1\}/.test(at.text) && at.paramDisplayName) addStat(at.text.replace(/\{VALUE1\}/g, at.paramDisplayName));
    else if (!/\{VALUE1\}/.test(at.text)) addStat(at.text);
  }
for (const g of gems.gems ?? []) for (const e of g.socketedEffects ?? []) for (const at of e.attributes ?? []) at.textResolved && addStat(at.textResolved);
for (const u of uniques) for (const f of [...(u.forcedAffixes ?? []), ...(u.inherentAffixes ?? [])]) for (const t of f.attributeText ?? []) /\{VALUE1\}/.test(t) || addStat(t);
// Mobalytics names: "Ranks to Bone Prison" is printed "+3 to Bone Prison"
for (const n of statNames) addStat(n.replace(/^Ranks? to /i, "to "));
// tooltip base lines that read like stats
["Armor", "All Resist", "Damage Per Second", "Damage per Hit", "Attacks per Second", "Attacks per Second (Fast)", "Item Power", "Quality", "Toughness", "Block Chance", "Life"].forEach(addStat);
// "+4 to Darkness Skills" style for every skill and tag the build data knows
for (const t of tags) addStat(`to ${t} Skills`);

// ---- tooltip UI lines (templates with # for numbers) -----------------------------------------
const tips = strings.ui.UIToolTips ?? {};
const ui = new Set();
for (const k of ["ItemComparePropertiesLost", "AccountBound", "EmptySocket", "UniqueEquipped", "ItemLegendaryPower", "ItemUniquePower", "ItemSetPower", "ItemSealPower", "TooltipScrollUp", "TooltipScrollDown", "ItemHideCompare", "ItemShowCompare", "AlternateTooltip", "ItemMarkJunk", "ItemUnmarkJunk", "ItemLock", "ItemUnlock", "CannotSalvage", "Unmodifiable", "Equipped", "QuickEquip", "QuickUnequip", "LinkToChat", "QuickDrop_Controller", "Tempers", "Durability", "ItemPower", "LostSocket", "TransmogUnlockInstruction", "Seasonal", "ItemCompareSkillChanges", "BindOnAccountEquip", "ItemEntitlementRequirement_X1", "ItemEntitlementRequirement_X2"])
  if (tips[k]) ui.add(plain(tips[k]));
["Requires Level #", "Sell Value: #", "Sell Value: Cannot Be Sold", "Cannot Be Sold", "Transfigured", "Amalgamable", "Upgrades an Aspect in the Codex of Power on salvage", "Upgrades an Aspect in the Codex of Power", "on salvage", "Imprinted:", "Mark as Favorite", "# Damage Per Second", "# Damage per Hit", "# All Resist", "# Armor", "Socket", "Character", "Hide", "Compare", "Seasonal Item", "Ancestral", "Sacred"].forEach((s) => ui.add(s));
for (const k of ["WeaponSpeed_Fast1", "WeaponSpeed_Fast2", "WeaponSpeed_Slow1", "WeaponSpeed_Slow2"]) if (tips[k]) ui.add(`# Attacks per Second ${plain(tips[k])}`);

// ---- item type lines and names ---------------------------------------------------------------
// type lines ("Ancestral Legendary Two-Handed Scythe") are combined from these at runtime
const RARITY = ["Common", "Magic", "Rare", "Legendary", "Unique", "Mythic Unique", "Set"];
const types = new Set();
for (const v of Object.values(items.itemTypes ?? {})) if (v && v !== "null" && !/^[A-Z][a-z]+[A-Z]|^#|_|Placeholder/.test(plain(v))) types.add(plain(v));
["Horadric Seal", "Charm", "Seal", "Soul Splinter", "Witch Power", "Set Charm", "Unique Charm"].forEach((t) => types.add(t));

for (const s of [...stats, ...ui, ...types]) addWords(s);
for (const t of RARITY) addWords(t);
for (const u of uniques) {
  addWords(u.name);
  addWords(u.flavor);
  addWords(u.uniquePower?.descPlain);
  for (const f of [...(u.forcedAffixes ?? []), ...(u.inherentAffixes ?? [])]) addWords(f.descPlain);
}
for (const a of aspects) addWords(a.name), addWords(a.descPlain);
for (const a of affixes) {
  addWords(a.name);
  addWords(a.namePrefix);
  addWords(a.nameSuffix);
  if (a.magicType !== 0) addWords(a.descPlain);
}
const GEAR = /^(Helm|Chest Armor|Gloves|Pants|Boots|Ring|Amulet|Shield|Focus|Totem|Sword|Two-Handed Sword|Axe|Two-Handed Axe|Mace|Two-Handed Mace|Staff|Scythe|Two-Handed Scythe|Dagger|Wand|Bow|Crossbow|Hand Crossbow|Polearm|Glaive|Quarterstaff|Flail|Charm|Horadric Seal|Seal|Gem|Rune|Rune of Ritual|Rune of Invocation|Soul Splinter|Whisper Cache|Nightmare Sigil|Elixir|Incense)$/;
for (const e of items.entries ?? []) if (GEAR.test(e.itemTypeName ?? "")) addWords(e.name);
for (const [stl, m] of Object.entries(strings.items)) if (/^RareNameStrings|^ItemType_|^TalismanRarityNames|^ItemLabels/.test(stl)) Object.values(m).forEach(addWords);
for (const g of gems.gems ?? []) addWords(g.name), addWords(g.flavor);
for (const r of gems.runes ?? []) addWords(r.name), addWords(r.runeDescriptionPlain);
for (const c of charms.charms ?? []) addWords(c.name), addWords(c.setBonusName);
for (const b of charms.setBonuses ?? []) {
  addWords(b.name);
  for (const t of b.tiers ?? []) addWords(t.affix?.descPlain);
}
skillNames.forEach(addWords);
for (const v of Object.values(st("aspects.json"))) addWords(v?.name), addWords(v?.description);
for (const v of Object.values(st("uniques.json"))) addWords(v?.name), addWords(v?.description);
// keyword tooltips under item powers ("Resolve increases your Armor by 25% while active.")
for (const [stl, m] of Object.entries(strings.ui)) if (/^(Keyword|Tooltip|Glossary)/i.test(stl)) Object.values(m).forEach((v) => v.length < 400 && addWords(v));

// ---- character sheet (Character → Stats & Materials) -----------------------------------------
const hero = strings.ui.HeroDetailsEntries ?? {};
const sheet = new Set();
const currency = new Set();
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

const sorted = (s) => [...s].sort();
const out = {
  meta: { source: "data/gamedata " + (gd("manifest.json").build?.version ?? ""), generatedAt: new Date().toISOString() },
  words: sorted(words).join(" "),
  stats: sorted(stats),
  ui: sorted(ui),
  types: sorted(types),
  rarity: RARITY,
  sheet: { stats: sorted(sheet), currency: sorted(currency), headers: sorted(headers) },
};
mkdirSync(join(root, "src/generated"), { recursive: true });
const file = join(root, "src/generated/ocr-vocab.json");
writeFileSync(file, JSON.stringify(out));
console.log(`wrote ${file} (${(JSON.stringify(out).length / 1024).toFixed(0)} KB): ${words.size} words, ${stats.size} stat lines, ${ui.size} UI lines, ${sheet.size} sheet stats, ${currency.size} currencies`);
