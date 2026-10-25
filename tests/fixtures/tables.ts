// Small hand-written lookup tables, in the names.ts SlimEntry shape, so tests that only need a handful of
// names run without the game data (CI). Names, classes, item types and tempering manuals only: no tooltip or
// power text, so tests that match against the game's own wording stay on the real data (tests/setup.ts).
//
// On this PC the real tables win: `tablesForTests()` only steps in when there is no game data, so a test
// asserting on these names asserts the same thing in both modes.
import { reloadStaticData, setStaticSource, type Category, type SlimEntry } from "../../src/lib/names";
import { hasGameData } from "../setup";

export type TestTables = Partial<Record<Category, Record<string, SlimEntry>>>;

const names = (list: [string, string][]): Record<string, SlimEntry> => Object.fromEntries(list.map(([slug, n]) => [slug, { n }]));
const necro = (list: [string, string][], t?: string): Record<string, SlimEntry> =>
  Object.fromEntries(list.map(([slug, n]) => [slug, { n, c: "necromancer", ...(t ? { t } : {}) }]));

/** The names the tests name: the example build's gear, the few items the importers map, and this class's lists. */
export const TABLES: TestTables = {
  uniques: {
    "the-undercrown": { n: "The Undercrown", c: "necromancer", t: "Helm", s: ["Ranks to Minion Skills"] },
    deathgrip: { n: "Deathgrip", c: "necromancer", t: "Gloves", s: ["Ranks to Skeleton Warrior"] },
    "pact-of-bone": { n: "Pact of Bone", c: "necromancer", t: "Ring" },
    "bloodless-scream": { n: "Bloodless Scream", c: "necromancer", t: "2h Scythe" },
    "blood-moon-breeches": { n: "Blood Moon Breeches", c: "necromancer", t: "Pants" },
    "ring-of-the-sacrilegious-soul": { n: "Ring of the Sacrilegious Soul", c: "necromancer", t: "Ring" },
    "leorics-crown": { n: "Leoric's Crown", t: "Helm" },
    "harlequin-crest": { n: "Harlequin Crest", t: "Helm", m: 1 },
    "ring-of-starless-skies": { n: "Ring of Starless Skies", t: "Ring", m: 1 },
    "fists-of-fate": { n: "Fists of Fate", t: "Gloves" },
    // one unique that exists once per weapon type, so the item type has to pick the right copy
    "infinity-2h-mace": { n: "Infinity (2h Mace)", t: "2h Mace" },
    "infinity-bow": { n: "Infinity (Bow)", t: "Bow" },
    temerity: { n: "Temerity", t: "Pants" },
    enigma: { n: "Enigma", t: "Chest Armor" },
    insight: { n: "Insight", t: "2h Scythe" },
    "tal-rashas-iridescent-loop": { n: "Tal Rasha's Iridescent Loop", c: "sorcerer", t: "Ring" },
  },
  aspects: {
    "aspect-of-hewed-flesh": { n: "Aspect of Hewed Flesh", t: "Resource" },
    "aspect-of-hardened-bones": { n: "Aspect of Hardened Bones", c: "necromancer", t: "Defensive" },
    "aspect-of-heavenly-strength": { n: "Aspect of Heavenly Strength", t: "Utility" },
    "aspect-of-reanimation": { n: "Aspect of Reanimation", c: "barbarian", t: "Offensive" },
    "aspect-of-reanimation-necromancer": { n: "Aspect of Reanimation", c: "necromancer", t: "Offensive" },
    // an aspect several classes share: the first class (A to Z) keeps the plain slug
    "hellbent-commander-aspect": { n: "Hellbent Commander Aspect", c: "barbarian", t: "Offensive" },
    "hellbent-commander-aspect-necromancer": { n: "Hellbent Commander Aspect", c: "necromancer", t: "Offensive" },
    "hellbent-commander-aspect-sorcerer": { n: "Hellbent Commander Aspect", c: "sorcerer", t: "Offensive" },
    "necrotic-carapace-aspect": { n: "Necrotic Carapace Aspect", c: "necromancer", t: "Defensive" },
    "aspect-of-disobedience": { n: "Aspect of Disobedience", t: "Defensive" },
  },
  stats: {
    intelligence: { n: "Intelligence", k: "gear" },
    "maximum-life": { n: "Maximum Life", k: "gear" },
    "maximum-resource": { n: "Maximum Resource", k: "gear" },
    armor: { n: "Armor", k: "gear" },
    "total-armor": { n: "Total Armor", k: "implicit" },
    "critical-strike-chance": { n: "Critical Strike Chance", k: "gear" },
    "critical-strike-damage": { n: "Critical Strike Damage", k: "gear" },
    "critical-strike-damage-multiplier": { n: "Critical Strike Damage Multiplier", k: "gear" },
    "vulnerable-damage-multiplier": { n: "Vulnerable Damage Multiplier", k: "gear" },
    "shadow-damage-multiplier": { n: "Shadow Damage Multiplier", k: "gear" },
    "all-damage-multiplier": { n: "All Damage Multiplier", k: "gear" },
    "resistance-to-all-elements": { n: "Resistance to All Elements", k: "gear" },
    "movement-speed": { n: "Movement Speed", k: "gear" },
    "attack-speed": { n: "Attack Speed", k: "gear" },
    "cooldown-reduction": { n: "Cooldown Reduction", k: "gear" },
    "summon-damage": { n: "Summon Damage", k: "gear" },
    "maximum-summon-life": { n: "Maximum Summon Life", k: "gear" },
    "essence-regeneration": { n: "Essence Regeneration", k: "gear" },
    "all-stats": { n: "All Stats", k: "gear" },
    "ranks-to-minion-skills": { n: "Ranks to Minion Skills", k: "implicit" },
    "ranks-to-skeleton-warrior": { n: "Ranks to Skeleton Warrior", k: "implicit" },
    "ranks-to-darkness-skills": { n: "Ranks to Darkness Skills", k: "gear" },
    "ranks-to-curse-skills": { n: "Ranks to Curse Skills", k: "gear" },
    "maximum-resolve-stacks": { n: "Maximum Resolve Stacks", k: "tempering" },
    // tempering options are listed under "<manual> <stat>" too, the way a build names a temper
    "worldly-endurance-maximum-life": { n: "Maximum Life", k: "tempering", r: "Worldly Endurance" },
    "worldly-endurance-maximum-resolve-stacks": { n: "Maximum Resolve Stacks", k: "tempering", r: "Worldly Endurance" },
    "natural-motion-movement-speed": { n: "Movement Speed", k: "tempering", r: "Natural Motion" },
    "worldly-destruction-critical-strike-chance": { n: "Critical Strike Chance", k: "tempering", r: "Worldly Destruction" },
    "profane-finesse-summon-damage": { n: "Summon Damage", k: "tempering", r: "Profane Finesse" },
    "minion-finesse-summon-damage": { n: "Summon Damage", k: "tempering", r: "Minion Finesse" },
    "berserking-finesse-critical-strike-damage": { n: "Critical Strike Damage", k: "tempering", r: "Berserking Finesse" },
  },
  skills: necro(
    [
      ["skeleton-warrior", "Skeleton Warrior"],
      ["skeleton-mage", "Skeleton Mage"],
      ["golem", "Golem"],
      ["blight", "Blight"],
      ["sever", "Sever"],
      ["reap", "Reap"],
      ["decrepify", "Decrepify"],
      ["iron-maiden", "Iron Maiden"],
      ["army-of-the-dead", "Army of the Dead"],
      ["corpse-explosion", "Corpse Explosion"],
      ["corpse-tendrils", "Corpse Tendrils"],
      ["blood-wave", "Blood Wave"],
      ["blood-surge", "Blood Surge"],
      ["bone-prison", "Bone Prison"],
      ["bone-spirit", "Bone Spirit"],
    ],
    "basic",
  ),
  glyphs: necro([
    ["necromancer-warrior", "Warrior"],
    ["necromancer-deadraiser", "Deadraiser"],
    ["necromancer-essence", "Essence"],
    ["necromancer-eliminator", "Eliminator"],
    ["necromancer-amplify", "Amplify"],
    ["necromancer-sacrificial", "Sacrificial"],
    ["necromancer-dominate", "Dominate"],
    ["necromancer-corporeal", "Corporeal"],
  ]),
  boards: necro([
    ["necromancer-start", "Start"],
    ["necromancer-cult-leader", "Cult Leader"],
    ["necromancer-flesh-eater", "Flesh-eater"],
    ["necromancer-scent-of-death", "Scent of Death"],
    ["necromancer-bone-graft", "Bone Graft"],
    ["necromancer-frailty", "Frailty"],
  ]),
  charms: {
    "linta-of-the-black-shroud": { n: "Linta of the Black Shroud", c: "necromancer", set: "Peace of the Black Shroud" },
    "mlor-of-the-black-shroud": { n: "Mlor of the Black Shroud", c: "necromancer", set: "Peace of the Black Shroud" },
    "phoba-of-the-black-shroud": { n: "Phoba of the Black Shroud", c: "necromancer", set: "Peace of the Black Shroud" },
    "fer-of-the-black-shroud": { n: "Fer of the Black Shroud", c: "necromancer", set: "Peace of the Black Shroud" },
    "beru-of-the-black-shroud": { n: "Berú of the Black Shroud", c: "necromancer", set: "Peace of the Black Shroud" },
    "phoba-of-the-waking-touch": { n: "Phoba of the Waking Touch", c: "necromancer", set: "Rathma's Waking Touch" },
    "the-furnace": { n: "The Furnace", c: "barbarian" },
    "hellfire-torch": { n: "Hellfire Torch" },
    // a charm that copies a unique and carries its name: only the slot says which it is
    "fists-of-fate": { n: "Fists of Fate" },
  },
  seals: names([
    ["seal-of-the-diamond-mind", "Seal of the Diamond Mind"],
    ["annihilus", "Annihilus"],
  ]),
  gems: names([
    ["topaz", "Topaz"],
    ["amethyst", "Amethyst"],
    ["ruby", "Ruby"],
    ["splinter-of-pain", "Splinter of Pain"],
    ["splinter-of-anguish", "Splinter of Anguish"],
    ["splinter-of-hellfire", "Splinter of Hellfire"],
    ["splinter-of-sin", "Splinter of Sin"],
  ]),
  runes: names([
    ["nagu", "Nagu"],
    ["wat", "Wat"],
    ["jah", "Jah"],
    ["igni", "Igni"],
    ["poc", "Poc"],
  ]),
  mercs: names([
    ["raheir-the-shieldbearer", "Raheir, the Shieldbearer"],
    ["subo-the-bounty-hunter", "Subo, the Bounty Hunter"],
    ["varyana-the-berserker-crone", "Varyana, the Berserker Crone"],
    ["aldkin-the-cursed-child", "Aldkin, the Cursed Child"],
  ]),
  mercSkills: names([
    ["bastion", "Bastion"],
    ["cover-fire", "Cover Fire"],
    ["ready-at-hand", "Ready At Hand"],
    ["flame-surge", "Flame Surge"],
  ]),
  mercOpp: names([
    ["cast-when-the-player-becomes-injured", "Cast when the player becomes Injured"],
    ["cast-when-the-player-casts-any-skill-in-combat", "Cast when the player casts any skill in combat"],
  ]),
  // the game's own ids, the way Maxroll and Icy Veins store a build (convert.ts builds these from the
  // install; the few below are the ids the importer tests use, with the same names the real index gives)
  affixIds: {
    "1829592": { n: "Maximum Life", g: "maximum-life", t: "stats", k: "gear" },
    "2602157": { n: "Intelligence", g: "intelligence", t: "stats", k: "gear" },
    "1834105": { n: "Maximum Resource", g: "maximum-resource", t: "stats", k: "gear" },
    "1862295": { n: "Maximum Life", g: "maximum-life", t: "stats", k: "tempering", r: "Worldly Endurance" },
    "1862314": { n: "Movement Speed", g: "movement-speed", t: "stats", k: "tempering", r: "Natural Motion" },
    "1222592": { n: "Aspect of Hardened Bones", g: "aspect-of-hardened-bones", t: "aspects" },
  },
  boardIds: { Paragon_Necro_00: { n: "Start", g: "necromancer-start", w: 21 } },
  glyphIds: { Rare_038_Intelligence_Main: { n: "Corporeal", g: "necromancer-corporeal" } },
  itemIds: {
    Helm_Unique_Generic_005: { n: "Leoric's Crown", g: "leorics-crown", t: "uniques" },
    Runeword_Enigma: { n: "Enigma", g: "enigma", t: "uniques" },
    S15_Charm_Unique_HellfireTorch: { n: "Hellfire Torch", g: "hellfire-torch", t: "uniques", m: 1 },
    S15_Charm_Unique_Annihilus: { n: "Annihilus", g: "annihilus", t: "uniques" },
    Rune_Condition_OnSpendResource: { n: "Poc", g: "poc", t: "runes" },
    Rune_Condition_Bomb: { n: "Igni", g: "igni", t: "runes" },
    Gem_Ruby_09: { n: "Ruby", g: "ruby", t: "gems" },
  },
};

/**
 * Hand the tables above to names.ts when this PC has no game data, so the test runs in CI too. With the game
 * data there, the real tables stay. `extra` adds or replaces categories for one test file.
 */
export async function tablesForTests(extra: TestTables = {}) {
  if (hasGameData) return;
  const tables = { ...TABLES, ...extra } as any;
  setStaticSource(async () => ({ tables, ocrVocab: null, generated: null }));
  await reloadStaticData();
}
