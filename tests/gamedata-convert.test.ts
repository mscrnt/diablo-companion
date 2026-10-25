// src/lib/gamedata/convert.ts: the lookup tables built from the player's own game files, instead of the
// Mobalytics copy the app ships today. Every fixture below is hand-written in the extractor's shape
// (data/gamedata/README.md) — no game or third-party data lives in this repo.
import { describe, expect, it } from "vitest";
import { attributeLine, classOf, convert, enumParamLabels, paramResolver, plainText, slugOf, statNameOf, type Extracted } from "../src/lib/gamedata/convert";

describe("slugOf / classOf", () => {
  it("slugs a name the way builds spell it", () => {
    expect(slugOf("Aspect of Berserk Ripping")).toBe("aspect-of-berserk-ripping");
    expect(slugOf("Mjölnic Ryng")).toBe("mjolnic-ryng");
    expect(slugOf("King's Grace (1h Mace)")).toBe("kings-grace-1h-mace");
    expect(slugOf("Whirlwind: Bursting")).toBe("whirlwind-bursting");
  });

  it("names one class, or none for several", () => {
    expect(classOf(["Barbarian"])).toBe("barbarian");
    expect(classOf("Necro")).toBe("necromancer");
    expect(classOf(["All"])).toBeUndefined();
    expect(classOf(["Druid", "Sorcerer"])).toBeUndefined();
  });
});

describe("plainText", () => {
  it("blanks the values and drops the markup", () => {
    expect(plainText("{c_important}Deal{/c} [Affix_Value_1*100|1%|] more damage")).toBe("Deal #% more damage");
    expect(plainText("[{VALUE}*100|x%|] damage")).toBe("#%[x] damage");
    expect(plainText("[{VALUE}*100|0%+|] Life")).toBe("#%[+] Life");
  });

  it("takes the non-mythic branch of a conditional and the singular of a plural form", () => {
    expect(plainText("{if:SF.IsMythic}mythic{else}normal{/if} power")).toBe("normal power");
    expect(plainText("lasts 2 |4second:seconds;")).toBe("lasts 2 second");
  });
});

describe("statNameOf", () => {
  it("drops the numbers the item rolls", () => {
    expect(statNameOf("+#% Attack Speed")).toBe("Attack Speed");
    expect(statNameOf("+#%[x] Critical Strike Damage")).toBe("Critical Strike Damage");
    expect(statNameOf("+# Damage to Stunned Enemies")).toBe("Damage to Stunned Enemies");
  });

  it("drops the \"up to a\" that introduced a value, and reads a rank line as Ranks", () => {
    expect(statNameOf("Lucky Hit: Up to a # Chance to Stun for 2 Seconds")).toBe("Lucky Hit: Chance to Stun for 2 Seconds");
    expect(statNameOf("Lucky Hit: Up to a 40% Chance to Deal +# Fire Damage")).toBe("Lucky Hit: Chance to Deal Fire Damage");
    expect(statNameOf("+# to Core Skills")).toBe("Ranks to Core Skills");
  });
});

describe("affix parameters", () => {
  // the game leaves a tooltip blank as a bare enum value; the affix ids that carry it say what it means
  const affixes = [
    { id: "Damage_to_Stunned", attributes: [{ attribute: "Damage_vs_CC", param: 2, textPlain: "+# Damage to {VALUE1} Enemies" }] },
    { id: "Tempered_Damage_to_Stunned_Tier1", attributes: [{ attribute: "Damage_vs_CC", param: 2, textPlain: "+# Damage to {VALUE1} Enemies" }] },
    { id: "Damage_to_Frozen", attributes: [{ attribute: "Damage_vs_CC", param: 10, textPlain: "+# Damage to {VALUE1} Enemies" }] },
    { id: "Resistance_Single_Poison", attributes: [{ attribute: "Resistance", param: 4, textPlain: "+# {VALUE1} Resistance" }] },
    { id: "Resistance_Jewelry_Single_Poison", attributes: [{ attribute: "Resistance", param: 4, textPlain: "+# {VALUE1} Resistance" }] },
    { id: "Resistance_Single_Fire", attributes: [{ attribute: "Resistance", param: 1, textPlain: "+# {VALUE1} Resistance" }] },
  ];

  it("reads an enum label off the affix ids that share it", () => {
    const labels = enumParamLabels(affixes);
    expect(labels.get("Damage_vs_CC#2")).toBe("Stunned");
    expect(labels.get("Damage_vs_CC#10")).toBe("Frozen");
    expect(labels.get("Resistance#4")).toBe("Poison");
    expect(labels.get("Resistance#1")).toBe("Fire");
  });

  it("resolves a skill-tag parameter through the GameBalance hash and the game's tag label", () => {
    const param = paramResolver({
      affixes: { entries: [] },
      gbid: { skillTags: ["Skill_Primary_Core", "Skill_Test_Thunder"] },
      strings: { SkillTags: { Skill_Primary_Core_TagName: "Core" } },
    });
    // djb2 of the lowercased name, as the game stores it (signed 32-bit)
    expect(param({ param: -1460542966, textPlain: "+# to {VALUE1} Skills" })).toBe("Core");
    // no label for the tag: the id's own words stand in
    expect(param({ param: -1707608713, textPlain: "+# to {VALUE1} Skills" })).toBe("Test Thunder");
  });

  it("resolves a weapon requirement and a power whose id is cased differently", () => {
    const param = paramResolver({
      affixes: { entries: [] },
      strings: { ItemRequirements: { TwoHandedSlashing: "Two-Handed Slashing Weapons" }, Power_Druid_Landslide: { name: "Landslide" } },
    });
    expect(param({ paramName: "TwoHandedSlashing", textPlain: "+# Damage with {VALUE1}" })).toBe("Two-Handed Slashing Weapons");
    expect(param({ paramName: "Druid_landslide", textPlain: "+{VALUE2} to {VALUE1}" })).toBe("Landslide");
    expect(attributeLine({ paramName: "Druid_landslide", textPlain: "+{VALUE2} to {VALUE1}" }, param)).toBe("+# to Landslide");
  });
});

// A whole (tiny) extractor output, hand-written in the shape data/gamedata/README.md documents.
const fixture: Extracted = {
  build: "9.9.9.1",
  affixes: {
    entries: [
      { id: "Runeword_Testament", magicType: 2, desc: "Your Evade becomes a {c_important}leap{/c}." },
      { id: "Resistance_Single_Poison", affixType: 2, attributes: [{ attribute: "Resistance", param: 4, textPlain: "+# {VALUE1} Resistance" }] },
      { id: "Resistance_Single_Fire", affixType: 2, attributes: [{ attribute: "Resistance", param: 1, textPlain: "+# {VALUE1} Resistance" }] },
      { id: "Tempered_Lucky_Hit_Stun_Tier1", affixType: 2, tempered: true, attributes: [{ attribute: "On_Hit_CC", param: 2, textPlain: "Lucky Hit: Up to a # Chance to {VALUE1} for 2 Seconds" }] },
      { id: "Lucky_Hit_Stun", affixType: 2, attributes: [{ attribute: "On_Hit_CC", param: 2, textPlain: "Lucky Hit: Up to a # Chance to {VALUE1} for 2 Seconds" }] },
      { id: "Lucky_Hit_Daze", affixType: 2, attributes: [{ attribute: "On_Hit_CC", param: 7, textPlain: "Lucky Hit: Up to a # Chance to {VALUE1} for 2 Seconds" }] },
      { id: "INHERENT_Thorns", affixType: 0, attributes: [{ attribute: "Thorns_Flat", textPlain: "+# Thorns" }] },
      { id: "X2_Transfiguration_Dexterity", affixType: 2, affixTags: ["Transfigured"], attributes: [{ attribute: "Dexterity", textPlain: "+# Dexterity" }] },
      { id: "PassiveRankBonus_Druid_Nature_T1_N1_CircleOfLife", affixType: 2, attributes: [{ attribute: "Plus_All_Stats", textPlain: "# All Stats" }] },
      { id: "testament_stats", affixType: 2, attributes: [{ attribute: "Dexterity", textPlain: "+# Dexterity" }] },
    ],
  },
  aspects: { entries: [{ id: "Asp_Legendary_Test_001", name: "of Testing", desc: "Deal [{VALUE}*100|x%|] more damage.", classes: ["Druid", "Barbarian"], category: 0 }] },
  uniques: {
    entries: [
      {
        id: "Helm_Unique_Druid_900", name: "Testhelm", itemType: "Helm", itemTypeName: "Helm", magicType: 2, classes: ["Druid"],
        uniquePower: { id: "pow", desc: "Your Storm Skills {c_important}echo{/c}." }, forcedAffixes: [{ id: "Resistance_Single_Fire" }],
      },
    ],
  },
  items: {
    entries: [
      { id: "Helm_Unique_Druid_900", name: "Testhelm", itemType: "Helm", itemTypeName: "Helm", magicType: 2, classes: ["Druid"] },
      { id: "Runeword_Testament_1HSword", name: "Testament", itemType: "Sword", itemTypeName: "Sword", magicType: 2, classes: ["All"] },
      { id: "Runeword_Testament_Axe2H", name: "Testament", itemType: "Axe2H", itemTypeName: "Two-Handed Axe", magicType: 2, classes: ["All"] },
      { id: "S99_Rune_Condition_Zeb", name: "Zeb", itemType: "ConditionRune", itemTypeName: "Rune of Ritual", magicType: 0, classes: ["All"] },
      { id: "Rune_Effect_Testing", name: "Qoz", itemType: "EffectRune", itemTypeName: "Rune of Invocation", magicType: 0, classes: ["All"] },
      { id: "RuneCrafting_RandomMagicRune", name: "Random Rune", itemType: "ConditionRune", itemTypeName: "Rune of Ritual", magicType: 0, classes: ["All"] },
    ],
  },
  gemsRunes: { gems: [], runes: [{ id: "Rune_Effect_Testing", name: "Qoz", runeDescriptionPlain: "Restore 20 Primary Resource." }] },
  charms: {
    charms: [
      { id: "Talisman_Charm_Unique_Test_001", name: "Testcharm", itemType: "Charm", itemTypeName: "Charm", classes: ["Druid", "Sorcerer"], setBonusName: "Test Set", forcedAffixes: [{ id: "x", attributeText: ["+[{VALUE}] Dexterity"] }] },
      { id: "Talisman_Seal_Test", name: "Testseal", itemType: "HoradricSeal", itemTypeName: "Horadric Seal", classes: ["All"] },
    ],
    setBonuses: [],
  },
  powers: {
    skills: [
      {
        id: "Druid_Tempest", name: "Tempest", desc: "Call a storm for {c_number}{payload:DMG}{/c} damage.",
        strings: {
          rankup_desc: "{if:Mod.UpgradeA}more{/if}",
          Mod0_Name: "Enhanced Tempest", Mod0_Description: "{c_important}Tempest{/c} also pulls enemies in.",
          Mod1_Name: "Howling", Mod1_Description: "{c_important}Tempest{/c} also deals {c_number}{payload:HOWL}{/c} damage.",
          Mod2_Name: "Damage Bonus", Mod2_Description: "{c_important}Tempest{/c} deals [{SF_1}*100|x%|] increased damage.",
          Mod3_Name: "Werebear", Mod3_Description: "{c_important}Tempest{/c} becomes a Werebear Skill.",
        },
      },
      { id: "Druid_Talent_Nature_T1_N1", name: "Circle of Life", desc: "A passive." },
      { id: "Mercenary_Test_Strike", name: "Test Strike", desc: "Hits things." },
      { id: "Sorcerer_Hidden", name: "(PH) Hidden", desc: "Not in the game yet." },
    ],
    seasonalPowers: [{ id: "S99_ChaosPerk_Generic_Rare_001", name: "Testing Chaos", descPlain: "Everything is different." }],
  },
  paragon: {
    boards: [{ id: "Paragon_Druid_90", name: "Test Board", classHint: "Druid", width: 3, height: 2, grid: [[null, "Generic_Magic_Dex", null], [null, "Druid_Rare_900", null]] }],
    nodes: [
      { id: "Generic_Magic_Dex", name: null, rarity: 2, attributes: [{ attribute: "Dexterity", textPlain: "+# Dexterity" }] },
      { id: "Druid_Rare_900", name: "Testnode", rarity: 3, attributes: [{ attribute: "Dexterity", textPlain: "+# Dexterity" }] },
    ],
    glyphs: [{ id: "ParagonGlyph_Test", name: "Testglyph", classes: ["Druid"], affixes: [{ desc: "Bonus: [{VALUE}] Dexterity" }] }],
  },
  monsters: { actors: [{ id: "Mercenary_TestHand", name: "Tesro" }] },
  gbid: { skillTags: [] },
  strings: {
    ParagonBoardUI: { NodeTypeMagic: "{c_magic}Magic Node", NodeTypeRare: "{c_rare}Rare Node", NodeTypeLegendary: "{c_legendary}Legendary Node", GlyphSocket: "Glyph Socket" },
    Item_S99_Rune_Condition_Zeb: { RuneDescription: "{c_RuneCondition}Stand still for 2 |4second:seconds;.{/c}" },
    GenericSkillTree_Warplans_TestHunt: { Name: "Test Hunt" },
    MercenaryUI: { Opportunity_Cast_When_Ready_Description: "Cast when the player is ready.", Opportunity_Cast_Slot_Description: "Cast when the player casts {powername}." },
    Achievement_X1_Achievement_Mercenaries_Level10_AllMercenaries: { Crit_1: "Tesro, the Tester" },
  },
};

describe("convert", () => {
  const t = convert(fixture);

  it("keeps where the tables came from", () => {
    expect(t.meta).toMatchObject({ source: "game files on this PC", build: "9.9.9.1" });
  });

  it("names a unique, its item type and the stats it always rolls", () => {
    expect(t.uniques["testhelm"]).toMatchObject({ n: "Testhelm", c: "druid", t: "Helm", d: "Your Storm Skills echo.", s: ["Fire Resistance"] });
  });

  it("builds a runeword from the item index and its power affix, one entry per weapon it fits", () => {
    expect(t.uniques["testament-1h-sword"]).toMatchObject({ n: "Testament (1h Sword)", t: "1h Sword", d: "Your Evade becomes a leap." });
    expect(t.uniques["testament-2h-axe"]).toMatchObject({ n: "Testament (2h Axe)", t: "2h Axe" });
    expect(t.uniques["testament"]).toBeUndefined();
  });

  it("gives an aspect its Codex group, and one slug per class that can use it", () => {
    expect(t.aspects["aspect-of-testing"]).toMatchObject({ n: "Aspect of Testing", c: "barbarian", t: "Offensive" });
    expect(t.aspects["aspect-of-testing-druid"]).toMatchObject({ c: "druid" });
  });

  it("fills the blank in a stat's line and tags where the stat comes from", () => {
    expect(t.stats["poison-resistance"]).toMatchObject({ n: "Poison Resistance", k: "gear" });
    expect(t.stats["lucky-hit-chance-to-stun-for-2-seconds"]).toMatchObject({ n: "Lucky Hit: Chance to Stun for 2 Seconds" });
    expect(t.stats["lucky-hit-chance-to-stun"]).toMatchObject({ n: "Lucky Hit: Chance to Stun" }); // the same line without its duration
    expect(t.stats["thorns"]).toMatchObject({ k: "implicit" });
    expect(t.stats["dexterity"]).toMatchObject({ k: "transfigured" });
    expect(t.stats["ranks-to-circle-of-life"]).toMatchObject({ n: "Ranks to Circle of Life" });
  });

  it("emits a skill, its tree upgrades and their kinds", () => {
    expect(t.skills["tempest"]).toMatchObject({ n: "Tempest", c: "druid", t: "basic" });
    expect(t.skills["tempest-howling"]).toMatchObject({ n: "Tempest: Howling", t: "enhancement", d: "Tempest also deals # damage." });
    expect(t.skills["tempest-damage-bonus"]).toMatchObject({ n: "Tempest: Damage Bonus", t: "talent" });
    // an upgrade whose own name says the skill is listed both ways, because builds use either
    expect(t.skills["tempest-enhanced"]).toMatchObject({ n: "Enhanced Tempest" });
    expect(t.skills["tempest-enhanced-tempest"]).toMatchObject({ n: "Tempest: Enhanced Tempest" });
    // a shapeshift choice keeps the form's bare name
    expect(t.skills["tempest-werebear"]).toMatchObject({ n: "Werebear", t: "choice-connector" });
    expect(t.skills["circle-of-life"]).toMatchObject({ t: "talent" });
    // placeholders and non-player powers stay out
    expect(t.skills["ph-hidden"]).toBeUndefined();
    expect(t.skills["test-strike"]).toBeUndefined();
  });

  it("reads every rune from the item index, including a season's new ones", () => {
    expect(t.runes["zeb"]).toMatchObject({ n: "Zeb", t: "Ritual", d: "Stand still for 2 second." });
    expect(t.runes["qoz"]).toMatchObject({ n: "Qoz", t: "Invocation", d: "Restore 20 Primary Resource." });
    expect(t.runes["random-rune"]).toBeUndefined();
  });

  it("splits charms from seals and gives a shared charm a slug per class", () => {
    expect(t.charms["testcharm"]).toMatchObject({ n: "Testcharm", c: "druid", set: "Test Set", d: "+# Dexterity" });
    expect(t.charms["testcharm-sorcerer"]).toMatchObject({ c: "sorcerer" });
    expect(t.seals["testseal"]).toMatchObject({ n: "Testseal" });
    expect(t.charms["testseal"]).toBeUndefined();
  });

  it("lays out a paragon board, its nodes by square, and the glyphs", () => {
    expect(t.boards["druid-test-board"]).toMatchObject({ n: "Test Board", c: "druid" });
    expect(t.nodes["druid-test-board-x2-y1"]).toMatchObject({ n: "Magic Node", t: "magic-node", d: "+# Dexterity" });
    expect(t.nodes["druid-test-board-x2-y2"]).toMatchObject({ n: "Testnode", t: "rare-node" });
    expect(t.glyphs["druid-testglyph"]).toMatchObject({ n: "Testglyph", c: "druid", d: "Bonus: # Dexterity" });
  });

  it("covers the seasonal perks, the War Plans trees and the mercenaries", () => {
    expect(t.chaosPerks["testing-chaos"]).toMatchObject({ n: "Testing Chaos" });
    expect(t.wpTrees["test-hunt"]).toMatchObject({ n: "Test Hunt" });
    expect(t.mercs["tesro-the-tester"]).toMatchObject({ n: "Tesro, the Tester" });
    expect(t.mercSkills["test-strike"]).toMatchObject({ n: "Test Strike" });
    expect(t.mercOpp["cast-when-the-player-is-ready"]).toMatchObject({ n: "Cast when the player is ready" });
    // the per-skill trigger has a placeholder for the skill, so it is not a trigger of its own
    expect(Object.keys(t.mercOpp)).toHaveLength(1);
  });
});
