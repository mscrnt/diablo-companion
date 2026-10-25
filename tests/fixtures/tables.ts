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
const necro = (list: [string, string][]): Record<string, SlimEntry> => Object.fromEntries(list.map(([slug, n]) => [slug, { n, c: "necromancer" }]));

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
    "hellbent-commander-aspect": { n: "Hellbent Commander Aspect", c: "barbarian", t: "Offensive" },
    "hellbent-commander-aspect-necromancer": { n: "Hellbent Commander Aspect", c: "necromancer", t: "Offensive" },
    "necrotic-carapace-aspect": { n: "Necrotic Carapace Aspect", c: "necromancer", t: "Defensive" },
    "aspect-of-disobedience": { n: "Aspect of Disobedience", t: "Defensive" },
  },
  stats: {
    intelligence: { n: "Intelligence", k: "gear" },
    "maximum-life": { n: "Maximum Life", k: "gear" },
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
  skills: necro([
    ["skeleton-warrior", "Skeleton Warrior"],
    ["skeleton-mage", "Skeleton Mage"],
    ["golem", "Golem"],
    ["blight", "Blight"],
    ["sever", "Sever"],
    ["decrepify", "Decrepify"],
    ["iron-maiden", "Iron Maiden"],
    ["army-of-the-dead", "Army of the Dead"],
    ["corpse-explosion", "Corpse Explosion"],
    ["blood-wave", "Blood Wave"],
    ["bone-prison", "Bone Prison"],
  ]),
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
    ["cast-when-the-player-becomes-injured", "Cast when the player becomes injured"],
    ["cast-when-the-player-casts-any-skill-in-combat", "Cast when the player casts any skill in combat"],
  ]),
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
