// The example build the tests judge loot against: a Skeleton Warrior minion Necromancer, written by hand
// straight in the app's own model (src/lib/types.ts). It is our own composition — the items are the ones
// research/s15-knowledge.json knows for minion Necromancers, the affixes, tempers, paragon, skills and notes
// are our picks — so no build from another site is kept in the repo.
//
// Two variants, as a real build has: "0" while levelling, "1" for the endgame (the one `exampleBuild()` hands
// the tests). Game item and stat names are spelled the way the game data does, so lookups against the tables
// built from the player's install resolve.
import { slotGroup, slotLabel } from "../../src/lib/buildmap";
import type { Build, GearSlot, ItemKind, SocketRef, StatRef } from "../../src/lib/types";

/** An affix the build wants: "+" marks a Greater target, "*" the one the masterwork should land on. */
const stat = (slug: string, name: string, mark = ""): StatRef => ({ slug, name, greater: mark.includes("+"), masterwork: mark.includes("*") });
const gem = (slug: string, name: string): SocketRef => ({ slug, name, kind: "gem" });
const rune = (slug: string, name: string): SocketRef => ({ slug, name, kind: "rune" });

/** One slot of the build; the label and the group come from the app's own slot map. */
const wear = (slot: string, itemSlug: string, itemName: string, kind: ItemKind, parts: Partial<GearSlot> = {}): GearSlot => ({
  slot,
  slotLabel: slotLabel(slot),
  group: slotGroup(slot),
  itemSlug,
  itemName,
  kind,
  affixes: [],
  tempers: [],
  sockets: [],
  implicits: [],
  extras: [],
  ...parts,
});

const INT = stat("intelligence", "Intelligence");
const LIFE = stat("maximum-life", "Maximum Life");
const ARMOR = stat("armor", "Armor");
const CRIT = stat("critical-strike-chance", "Critical Strike Chance");
const CRIT_DMG = stat("critical-strike-damage-multiplier", "Critical Strike Damage Multiplier");
const VULN = stat("vulnerable-damage-multiplier", "Vulnerable Damage Multiplier");
const SHADOW = stat("shadow-damage-multiplier", "Shadow Damage Multiplier");
const ALL_RES = stat("resistance-to-all-elements", "Resistance to All Elements");
const SUMMON = stat("summon-damage", "Summon Damage");

const PROFANE = stat("profane-finesse-summon-damage", "Summon Damage (Profane Finesse)");
const ENDURANCE_LIFE = stat("worldly-endurance-maximum-life", "Maximum Life (Worldly Endurance)");

/** The talisman: five of the Black Shroud charms plus one of our own choosing, in the seal's six slots. */
const CHARMS: [string, string][] = [
  ["linta-of-the-black-shroud", "Linta of the Black Shroud"],
  ["mlor-of-the-black-shroud", "Mlor of the Black Shroud"],
  ["phoba-of-the-black-shroud", "Phoba of the Black Shroud"],
  ["fer-of-the-black-shroud", "Fer of the Black Shroud"],
  ["beru-of-the-black-shroud", "Berú of the Black Shroud"],
  ["the-furnace", "The Furnace"],
];

/** The endgame gear: the five minion uniques, three aspects and the talisman. */
const ENDGAME: GearSlot[] = [
  wear("helm", "the-undercrown", "The Undercrown", "unique", {
    affixes: [INT, stat("ranks-to-minion-skills", "Ranks to Minion Skills", "+*"), LIFE, ARMOR],
    tempers: [ENDURANCE_LIFE],
    sockets: [gem("topaz", "Topaz")],
  }),
  wear("chest-armor", "aspect-of-hardened-bones", "Aspect of Hardened Bones", "aspect", {
    affixes: [stat("maximum-life", "Maximum Life", "+*"), INT, ALL_RES, ARMOR],
    // the chest's temper is one any drop can get too, so an untouched one isn't judged against it
    tempers: [stat("worldly-endurance-maximum-resolve-stacks", "Maximum Resolve Stacks (Worldly Endurance)")],
    sockets: [rune("nagu", "Nagu"), rune("wat", "Wat")],
    extras: [{ label: "Transfigured (Horadric Cube)", stats: [SUMMON] }],
  }),
  wear("gloves", "deathgrip", "Deathgrip", "unique", {
    affixes: [INT, stat("ranks-to-skeleton-warrior", "Ranks to Skeleton Warrior"), stat("critical-strike-chance", "Critical Strike Chance", "+*"), CRIT_DMG],
    tempers: [PROFANE],
  }),
  wear("pants", "blood-moon-breeches", "Blood Moon Breeches", "unique", {
    affixes: [INT, stat("critical-strike-damage-multiplier", "Critical Strike Damage Multiplier", "+*"), LIFE, ARMOR],
    tempers: [ENDURANCE_LIFE],
    sockets: [rune("jah", "Jah"), rune("igni", "Igni")],
  }),
  wear("boots", "aspect-of-hewed-flesh", "Aspect of Hewed Flesh", "aspect", {
    affixes: [INT, stat("movement-speed", "Movement Speed", "+"), ARMOR, stat("essence-regeneration", "Essence Regeneration")],
    tempers: [stat("natural-motion-movement-speed", "Movement Speed (Natural Motion)")],
  }),
  wear("amulet", "aspect-of-reanimation-necromancer", "Aspect of Reanimation", "aspect", {
    affixes: [stat("critical-strike-chance", "Critical Strike Chance", "+*"), CRIT_DMG, VULN, SHADOW],
    tempers: [PROFANE],
    sockets: [gem("splinter-of-pain", "Splinter of Pain")],
  }),
  wear("ring-1", "hellbent-commander-aspect-necromancer", "Hellbent Commander Aspect", "aspect", {
    affixes: [stat("critical-strike-chance", "Critical Strike Chance", "+*"), VULN, CRIT_DMG, LIFE],
    tempers: [stat("minion-finesse-summon-damage", "Summon Damage (Minion Finesse)")],
    sockets: [gem("splinter-of-anguish", "Splinter of Anguish")],
  }),
  wear("ring-2", "pact-of-bone", "Pact of Bone", "unique", {
    affixes: [INT, stat("critical-strike-chance", "Critical Strike Chance", "+*"), CRIT_DMG, stat("all-damage-multiplier", "All Damage Multiplier")],
    tempers: [PROFANE],
    sockets: [gem("splinter-of-hellfire", "Splinter of Hellfire")],
  }),
  wear("weapon", "bloodless-scream", "Bloodless Scream", "unique", {
    affixes: [INT, stat("critical-strike-damage-multiplier", "Critical Strike Damage Multiplier", "+*"), SHADOW, stat("maximum-summon-life", "Maximum Summon Life")],
    tempers: [stat("worldly-destruction-critical-strike-chance", "Critical Strike Chance (Worldly Destruction)")],
    sockets: [gem("amethyst", "Amethyst"), gem("amethyst", "Amethyst")],
  }),
  // the build names no particular seal, the way a planner's seal slot usually doesn't: any seal fills it
  wear("seal", "seal", "Seal", "seal", {
    extras: [{ label: "Seal stats", stats: [stat("all-stats", "All Stats")] }],
  }),
  ...CHARMS.map(([slug, name], i) =>
    wear(`charm-${i + 1}`, slug, name, "charm", { extras: [{ label: "Charm stats", stats: [SUMMON] }] }),
  ),
];

/** Levelling: aspects in every slot, no talisman yet. */
const EARLY: GearSlot[] = [
  wear("helm", "aspect-of-heavenly-strength", "Aspect of Heavenly Strength", "aspect", { affixes: [LIFE, INT, ARMOR] }),
  wear("chest-armor", "aspect-of-hardened-bones", "Aspect of Hardened Bones", "aspect", { affixes: [LIFE, INT, ALL_RES] }),
  wear("gloves", "hellbent-commander-aspect-necromancer", "Hellbent Commander Aspect", "aspect", { affixes: [INT, CRIT, CRIT_DMG] }),
  wear("pants", "aspect-of-hardened-bones", "Aspect of Hardened Bones", "aspect", { affixes: [LIFE, ARMOR, INT] }),
  wear("boots", "aspect-of-hewed-flesh", "Aspect of Hewed Flesh", "aspect", { affixes: [INT, stat("movement-speed", "Movement Speed"), ARMOR] }),
  wear("weapon", "aspect-of-reanimation-necromancer", "Aspect of Reanimation", "aspect", { affixes: [INT, CRIT_DMG, SHADOW] }),
];

/** The paragon: the starting board and four more, each with the glyph we level in it. */
const BOARDS: [string, string, string, string, number, number, number, number][] = [
  // board slug, board name, glyph slug, glyph name, glyph level, x, y, rotation
  ["necromancer-start", "Start", "necromancer-warrior", "Warrior", 100, 0, 0, 0],
  ["necromancer-cult-leader", "Cult Leader", "necromancer-deadraiser", "Deadraiser", 100, -1, 0, 90],
  ["necromancer-flesh-eater", "Flesh-eater", "necromancer-essence", "Essence", 75, -1, 1, 180],
  ["necromancer-scent-of-death", "Scent of Death", "necromancer-eliminator", "Eliminator", 50, -2, 1, 180],
  ["necromancer-bone-graft", "Bone Graft", "necromancer-amplify", "Amplify", 25, -1, 2, 270],
];

const paragon = (board: string, name: string, glyphSlug: string, glyphName: string, glyphLevel: number, x: number, y: number, rotation: number) => ({
  slug: board,
  name,
  glyphSlug,
  glyphName,
  glyphLevel,
  x,
  y,
  rotation,
  // a few of the squares each board takes, in the board screen's own counting
  nodes: [`${board}-x11-y14`, `${board}-x11-y13`, `${board}-x12-y12`, `${board}-x13-y11`],
});

export const EXAMPLE_BUILD: Build = {
  id: "example-skeleton-warriors",
  // where a build was pasted from; this one was written here, so the Build page's "from" label is the paste box's default
  source: "mobalytics",
  url: "",
  slug: "example-skeleton-warriors",
  name: "Skeleton Warrior Army",
  author: "Sanctuary Toolkit",
  className: "Necromancer",
  season: "Season 15",
  tags: [
    { group: "class", name: "Necromancer" },
    { group: "season", name: "Season 15" },
    { group: "playstyle", name: "Minions" },
  ],
  updatedAt: "2026-10-20T12:00:00.000Z",
  fetchedAt: "2026-10-20T12:00:00.000Z",
  variants: [
    {
      id: "0",
      name: "Early Army",
      description: "Levelling: raise everything, let the minions do the work.",
      gear: EARLY,
      skillOrder: [
        { slug: "skeleton-warrior", name: "Skeleton Warrior", type: "basic" },
        { slug: "skeleton-mage", name: "Skeleton Mage", type: "basic" },
        { slug: "blight", name: "Blight", type: "basic" },
        { slug: "golem", name: "Golem", type: "basic" },
      ],
      skillRanks: { "skeleton-warrior": 5, "skeleton-mage": 5, blight: 5, golem: 3 },
      skillBar: [
        { position: 1, slug: "blight", name: "Blight", description: "" },
        { position: 2, slug: "skeleton-warrior", name: "Skeleton Warrior", description: "" },
        { position: 3, slug: "skeleton-mage", name: "Skeleton Mage", description: "" },
        { position: 4, slug: "golem", name: "Golem", description: "" },
      ],
      summons: [],
      paragon: [],
      mercenary: { primary: "Raheir, the Shieldbearer", skills: [] },
      priority: ["aspect-of-hewed-flesh", "hellbent-commander-aspect-necromancer", "aspect-of-hardened-bones"],
      sections: [{ id: "early-notes", title: "While you level", text: "Keep Blight up, send the warriors in first, and pick up every aspect for the Codex.", kind: "Notes" }],
    },
    {
      id: "1",
      name: "Endgame Warriors",
      description: "Skeleton Warriors with Reaper upgrades, Shadow damage and the Black Shroud talisman.",
      gear: ENDGAME,
      skillOrder: [
        { slug: "skeleton-warrior", name: "Skeleton Warrior", type: "basic" },
        { slug: "skeleton-warrior-litany-of-death", name: "Skeleton Warrior: Litany of Death", type: "enhancement" },
        { slug: "skeleton-mage", name: "Skeleton Mage", type: "basic" },
        { slug: "golem", name: "Golem", type: "basic" },
        { slug: "golem-gargantua", name: "Golem: Gargantua", type: "enhancement" },
        { slug: "decrepify", name: "Decrepify", type: "basic" },
        { slug: "blight", name: "Blight", type: "basic" },
        { slug: "army-of-the-dead", name: "Army of the Dead", type: "basic" },
      ],
      skillRanks: {
        "skeleton-warrior": 15,
        "skeleton-warrior-litany-of-death": 1,
        "skeleton-mage": 15,
        golem: 15,
        "golem-gargantua": 1,
        decrepify: 12,
        blight: 1,
        "iron-maiden": 1,
        "army-of-the-dead": 1,
      },
      skillBar: [
        { position: 1, slug: "skeleton-warrior", name: "Skeleton Warrior", description: "Command the warriors onto a target." },
        { position: 2, slug: "skeleton-mage", name: "Skeleton Mage", description: "" },
        { position: 3, slug: "golem", name: "Golem", description: "" },
        { position: 4, slug: "decrepify", name: "Decrepify", description: "" },
        { position: 5, slug: "blight", name: "Blight", description: "" },
        { position: 6, slug: "army-of-the-dead", name: "Army of the Dead", description: "" },
      ],
      summons: [
        { type: "SKELETAL_WARRIORS", slug: "skeletal-warriors-reapers", name: "Skeletal Warriors: Reapers", description: "Reapers cleave, and their wind-up hit leaves a corpse." },
        { type: "SKELETAL_MAGES", slug: "skeletal-mages-shadow", name: "Skeletal Mages: Shadow", description: "Shadow mages add the damage type the gear scales." },
        { type: "GOLEMS", slug: "golems-iron", name: "Golems: Iron", description: "The iron golem pulls packs in and stuns them." },
      ],
      paragon: BOARDS.map((b) => paragon(...b)),
      mercenary: {
        primary: "Raheir, the Shieldbearer",
        reinforcement: "Subo, the Bounty Hunter",
        reinforcementSkill: "Cover Fire",
        trigger: "Cast when the player becomes injured",
        skills: ["Bastion", "Ready At Hand"],
      },
      priority: [
        "the-undercrown",
        "deathgrip",
        "pact-of-bone",
        "bloodless-scream",
        "blood-moon-breeches",
        "aspect-of-reanimation-necromancer",
        "hellbent-commander-aspect-necromancer",
        "aspect-of-hewed-flesh",
        "aspect-of-hardened-bones",
      ],
      sections: [
        {
          id: "endgame-gear",
          title: "Gear and aspects",
          text: "The Undercrown and Deathgrip carry the warriors. Pact of Bone goes in Ring 2, Hellbent Commander on Ring 1, Reanimation on the amulet. Temper Summon Damage wherever a slot allows it.",
          kind: "Builder",
        },
        {
          id: "endgame-rotation",
          title: "Skills and rotation",
          text: "Command the warriors onto the biggest target, curse with Decrepify, drop Blight on top, and keep Army of the Dead for a stuck pack.",
          kind: "AssignedSkills",
        },
      ],
    },
  ],
  sections: [
    {
      id: "overview",
      title: "Build overview",
      text: "A minion Necromancer that lets Skeleton Warriors do the damage. Slow to start, very safe once the uniques land.",
      kind: "Notes",
    },
  ],
};
