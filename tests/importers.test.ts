// The paste-only importers: Maxroll, Icy Veins and d4builds.
// Every fixture below is hand-written in the shape each site's public endpoint returns.
// No response from any of those sites is kept in the repo.
import { beforeAll, describe, expect, it } from "vitest";
import { itemKindOf, looseRef, refOf, socketRef, temperRef } from "../src/lib/buildmap";
import { decodeFirestore, normaliseD4Builds, parseD4BuildsUrl } from "../src/lib/d4builds";
import { extractUid, normaliseIcyVeins, parseIcyVeinsUrl } from "../src/lib/icyveins";
import { importBuild, siteOf } from "../src/lib/importers";
import { extractPlanner, itemNameOf, normaliseMaxroll, parseMaxrollUrl } from "../src/lib/maxroll";
import { tablesForTests } from "./fixtures/tables";

// names only, and few: with the game data read off this PC the real tables are used instead
beforeAll(() => tablesForTests());

describe("which site a pasted link is from", () => {
  it("knows the four build sites", () => {
    expect(siteOf("https://mobalytics.gg/diablo-4/builds/necromancer-mages-necro-guide")).toBe("mobalytics");
    expect(siteOf("https://maxroll.gg/d4/build-guides/blood-wave-necromancer-guide")).toBe("maxroll");
    expect(siteOf("https://planners.maxroll.gg/profiles/d4/xf9um40q")).toBe("maxroll");
    expect(siteOf("https://www.icy-veins.com/d4/planner/?uid=61e715e1fa72")).toBe("icy-veins");
    expect(siteOf("https://d4builds.gg/builds/23ae9cbb-933e-4a88-999c-2241654cc8e2/")).toBe("d4builds");
    // a bare slug is a Mobalytics build, as the paste box has always taken
    expect(siteOf("necromancer-mages-necro-guide")).toBe("mobalytics");
  });

  it("says so plainly for anything else", async () => {
    expect(siteOf("https://example.com/builds/1")).toBeNull();
    expect(siteOf("not a url /")).toBeNull();
    await expect(importBuild("https://example.com/builds/1")).rejects.toThrow(/Mobalytics, Maxroll, Icy Veins or d4builds/);
  });
});

// ---- Maxroll ---------------------------------------------------------------

/**
 * One planner profile, as planners.maxroll.gg/profiles/d4/<id> returns it: items by the game's item id,
 * affixes ("explicits"), tempers and aspects by the game's affix sno, a board's squares as one number each.
 */
const maxroll = {
  id: "ab12cd34",
  name: "Test Blood Wave",
  class: "Necromancer",
  season: 15,
  date: "2026-10-16 17:30:55",
  user: { username: "someone" },
  data: {
    items: {
      "1": {
        id: "Runeword_Enigma",
        power: 850,
        sockets: ["Gem_Ruby_09", "Rune_Condition_Bomb"],
        explicits: [{ nid: 2602157, values: [120], greater: true }, { nid: 1829592, values: [1500], upgrade: 1 }],
        tempered: [{ nid: 1862295, values: [1500] }],
      },
      "2": { id: "Helm_Unique_Generic_005", sockets: [] },
      "3": { id: "S15_Charm_Unique_HellfireTorch", sockets: [] },
      // a plain legendary base: the aspect on it is what the build is after
      "4": { id: "Boots_Legendary_Generic_053", sockets: ["Rune_Condition_OnSpendResource"], aspects: [{ nid: 1222592 }], tempered: [{ nid: 1862314, values: [25] }] },
    },
    profiles: [
      {
        name: "Endgame",
        level: 70,
        items: { "4": 2, "5": 1, "15": 4, "21": 3 },
        skillBar: ["Necromancer_BloodWave", "Necromancer_Decrepify", null],
        mercenary: { id: "MercenaryClass_ShieldBearer", support: "MercenaryClass_BountyHunter", supportSkills: ["NPC_Mercenary_ShieldBearer_Bastion"] },
        minionUpgrades: [],
        widgetNotes: {},
        paragon: {
          position: 0,
          steps: [{ name: "Step 1", data: [{ id: "Paragon_Necro_00", nodes: { "220": 1, "241": 1 }, rotation: 90, position: { x: 0, y: 0 }, glyph: "Rare_038_Intelligence_Main", glyphLevel: 46 }] }],
        },
      },
      { name: "Push", items: {}, skillBar: [], mercenary: {} },
    ],
    strAndWeak: { strengths: ["Very fast"], weaknesses: ["Gear dependent"] },
    globalNotes: {},
  },
};

describe("Maxroll", () => {
  it("reads planner, profile and guide links", () => {
    expect(parseMaxrollUrl("https://maxroll.gg/d4/planner/xf9um40q#3")).toEqual({ id: "xf9um40q", profile: "3" });
    expect(parseMaxrollUrl("https://planners.maxroll.gg/profiles/d4/xf9um40q")).toEqual({ id: "xf9um40q", profile: undefined });
    expect(parseMaxrollUrl("https://maxroll.gg/d4/build-guides/blood-wave-necromancer-guide")).toEqual({
      guide: "https://maxroll.gg/d4/build-guides/blood-wave-necromancer-guide",
    });
    expect(parseMaxrollUrl("xf9um40q")).toEqual({ id: "xf9um40q" });
  });

  it("finds the planner a guide page embeds, and says when there is none", () => {
    expect(extractPlanner('{"attributes":{"link":"https://maxroll.gg/d4/planner/xf9um40q#3"},"blockName":"maxroll/planner"}')).toEqual({ id: "xf9um40q", profile: "3" });
    expect(() => extractPlanner("<html>no planner here</html>")).toThrow(/no build planner/);
  });

  it("names what the game's own item ids name, and says what the others are", () => {
    expect(itemNameOf("Runeword_Enigma")).toEqual({ name: "Enigma", named: true });
    expect(itemNameOf("Runeword_Insight_Scythe2H")).toEqual({ name: "Insight", named: true });
    expect(itemNameOf("S15_Charm_Unique_HellfireTorch")).toEqual({ name: "Hellfire Torch", named: true });
    expect(itemNameOf("Ring_Unique_Generic_105")).toEqual({ name: "Unique Ring", named: false });
    expect(itemNameOf("Boots_Legendary_Generic_053")).toEqual({ name: "Legendary Boots", named: false });
  });

  it("maps the header, both profiles, the named gear and the skill bar", () => {
    const b = normaliseMaxroll(maxroll, "https://maxroll.gg/d4/planner/ab12cd34");
    expect(b.source).toBe("maxroll");
    expect(b.name).toBe("Test Blood Wave");
    expect(b.className).toBe("Necromancer");
    expect(b.season).toBe("Season 15");
    expect(b.author).toBe("someone");
    expect(b.updatedAt.slice(0, 10)).toBe("2026-10-16");
    expect(b.variants.map((v) => v.name)).toEqual(["Endgame", "Push"]);

    const v = b.variants[0];
    const gear = Object.fromEntries(v.gear.map((g) => [g.slotLabel, g]));
    expect(gear["Chest"].itemName).toBe("Enigma");
    expect(gear["Chest"].kind).toBe("unique");
    // a rune is stored by the effect it grants ("Rune_Condition_Bomb" is Igni): the game data names it
    expect(gear["Chest"].sockets.map((s) => s.name)).toEqual(["Ruby", "Igni"]);
    // the game's own item id names the helm; the id's own words are only the fallback
    expect(gear["Helm"].itemName).toBe("Leoric's Crown");
    expect(gear["Charm 1"].itemName).toBe("Hellfire Torch");
    expect(gear["Charm 1"].kind).toBe("charm");
    expect(v.skillBar.map((s) => [s.position, s.name])).toEqual([
      [1, "Blood Wave"],
      [2, "Decrepify"],
    ]);
    expect(v.mercenary.primary).toMatch(/Raheir/);
    expect(v.mercenary.reinforcement).toMatch(/Subo/);
    expect(v.mercenary.reinforcementSkill).toBe("Bastion");
    expect(b.sections[0].title).toBe("Strengths and weaknesses");
    expect(b.sections[0].text).toContain("Very fast");
  });

  it("names the affixes, tempers and the masterwork from the game's affix ids", () => {
    const gear = Object.fromEntries(normaliseMaxroll(maxroll).variants[0].gear.map((g) => [g.slotLabel, g]));
    expect(gear["Chest"].affixes.map((a) => [a.name, a.greater, a.masterwork])).toEqual([
      ["Intelligence", true, false],
      ["Maximum Life", false, true],
    ]);
    expect(gear["Chest"].tempers.map((t) => t.name)).toEqual(["Maximum Life (Worldly Endurance)"]);
  });

  it("names a plain legendary by its aspect, and the rune socketed in it", () => {
    const gear = Object.fromEntries(normaliseMaxroll(maxroll).variants[0].gear.map((g) => [g.slotLabel, g]));
    expect([gear["Boots"].itemName, gear["Boots"].kind]).toEqual(["Aspect of Hardened Bones", "aspect"]);
    expect(gear["Boots"].sockets).toEqual([{ slug: "poc", name: "Poc", kind: "rune" }]);
    expect(gear["Boots"].tempers[0].name).toBe("Movement Speed (Natural Motion)");
  });

  it("maps the paragon: the board, its glyph and the squares it counts across the board", () => {
    const v = normaliseMaxroll(maxroll).variants[0];
    expect(v.paragon.map((p) => [p.name, p.glyphName, p.glyphLevel, p.rotation, p.nodes])).toEqual([
      ["Start", "Corporeal", 46, 90, ["necromancer-start-x11-y11", "necromancer-start-x11-y12"]],
    ]);
  });

  it("leaves out the skill tree: it is the planner's own node numbering", () => {
    expect(normaliseMaxroll(maxroll).variants[0].skillOrder).toEqual([]);
  });
});

// ---- Icy Veins -------------------------------------------------------------

/** One build, as www.icy-veins.com/api/d4-builds/<uid>/ returns it (`build`). */
const icyveins = {
  uid: "abc123def456",
  name: "Test Blood Wave",
  version: "3.2.1.73552",
  updated_at: "2026-10-01T01:14:43.110Z",
  gear_data: {
    sets: [
      {
        id: "s1",
        name: "Endgame",
        class: "necromancer",
        notes: "Open with Blood Wave.",
        itemIds: {
          helmet: "Helm_Unique_Generic_005",
          boots: "Boots_Normal_Generic_001",
          ring2: "Ring_Normal_Generic_001",
          talisman_seal: "S15_Charm_Unique_Annihilus",
          talisman_charm_1: "Talisman_Charm_1",
        },
        // an empty slot shows nothing but its own item type ("Ring")
        equippedGear: { helmet: "Leoric's Crown", boots: "Boots", ring2: "Ring", talisman_seal: "Annihilus", talisman_charm_1: "Hellfire Torch" },
        itemTypes: { helmet: "Helm", boots: "Boots", ring2: "Ring", talisman_seal: "HoradricSeal", talisman_charm_1: "Charm" },
        itemAspects: { boots: "Necrotic Carapace Aspect" },
        itemQualities: { helmet: "unique", boots: "legendary", talisman_seal: "unique", talisman_charm_1: "mythic" },
        itemSockets: { helmet: ["Abyssal Splinter of Pain"], boots: ["Horadric Ruby", "Igni"] },
        itemMythicToggle: { helmet: true },
        itemUserAffixes: { helmet: [{ value: 1500, affixId: "1829592" }, { value: 120, affixId: "2602157", greaterAffix: true }], boots: [{ value: 25, affixId: "1834105" }] },
        itemTemperingAffix: { helmet: { value: 1500, affixId: "1862295" }, boots: { value: 25, affixId: "1862314" } },
        // the masterwork landed on the helm's first affix and on the boots' temper
        itemMasterworkAffix: { helmet: { index: 0, source: "user" }, boots: { index: 0, source: "tempered" } },
        itemAmuletTransfigurationAspect: {},
      },
    ],
  },
  skills_data: { sets: [{ id: "s1", equippedSkills: { skill2: "Necromancer_Decrepify", skill1: "Necromancer_BloodWave" } }] },
  paragon_data: {
    sets: [
      {
        id: "s1",
        paragonBoard: {
          actualRotations: { frailty: 90 },
          equippedGlyphs: { "7-11": { name: "Sacrificial", level: 100 }, "frailty-7-11": { name: "Dominate", level: 46 } },
          nodeStates: { "4-9": { state: "active" }, "5-8": { state: "available" }, "frailty-2-11": { state: "active" } },
          connectedBoards: { frailty: { slug: "frailty", position: { col: 0, row: -1 }, boardData: { name: "Frailty" } } },
        },
      },
    ],
  },
  mercenary_data: { sets: [{ id: "s1", selectedMercenary: "Varyana", selectedReinforcement: "Raheir", selectedSkill: "Bastion", selectedOpportunity: "Injured" }] },
};

describe("Icy Veins", () => {
  it("reads planner links and keeps guide pages for a page fetch", () => {
    expect(parseIcyVeinsUrl("https://www.icy-veins.com/d4/planner/?uid=61e715e1fa72")).toEqual({ uid: "61e715e1fa72" });
    expect(parseIcyVeinsUrl("https://www.icy-veins.com/api/d4-builds/61e715e1fa72/")).toEqual({ uid: "61e715e1fa72" });
    expect(parseIcyVeinsUrl("https://www.icy-veins.com/d4/guides/blood-wave-necromancer-build")).toEqual({
      page: "https://www.icy-veins.com/d4/guides/blood-wave-necromancer-build",
    });
  });

  it("finds the build a guide page links, and says when there is none", () => {
    expect(extractUid('{"plannerUrl":"https://www.icy-veins.com/d4/planner/?uid=61e715e1fa72"}')).toBe("61e715e1fa72");
    expect(() => extractUid("<html>no build here</html>")).toThrow(/No build found/);
  });

  it("maps gear, the aspect on a plain legendary, sockets and the skill bar", () => {
    const b = normaliseIcyVeins(icyveins, "https://www.icy-veins.com/d4/planner/?uid=abc123def456");
    expect(b.source).toBe("icy-veins");
    expect(b.className).toBe("Necromancer");
    expect(b.variants.map((v) => v.name)).toEqual(["Endgame"]);

    const v = b.variants[0];
    const gear = Object.fromEntries(v.gear.map((g) => [g.slotLabel, g]));
    expect(gear["Helm"].itemName).toBe("Leoric's Crown");
    // the planner's "mythic" is a mythic-quality slot; the game's own tables say what the item is
    expect(gear["Helm"].kind).toBe("unique");
    // the aspect is what the build is after, not the plain base it sits on
    expect(gear["Boots"].itemName).toBe("Necrotic Carapace Aspect");
    expect(gear["Boots"].kind).toBe("aspect");
    expect(gear["Boots"].sockets).toEqual([
      { slug: "ruby", name: "Ruby", kind: "gem" },
      { slug: "igni", name: "Igni", kind: "rune" },
    ]);
    expect(gear["Helm"].sockets[0].name).toBe("Splinter of Pain");
    expect(gear["Seal"].kind).toBe("seal");
    expect(gear["Charm 1"].kind).toBe("charm");
    // the empty ring slot is left out rather than tracked as an item called "Ring"
    expect(gear["Ring 2"]).toBeUndefined();
    expect(v.skillBar.map((s) => s.name)).toEqual(["Blood Wave", "Decrepify"]);
    expect(v.sections[0].text).toBe("Open with Blood Wave.");
  });

  it("maps the paragon boards, their glyphs and their nodes", () => {
    const v = normaliseIcyVeins(icyveins).variants[0];
    expect(v.paragon.map((p) => [p.name, p.glyphName, p.glyphLevel, p.rotation, p.nodes])).toEqual([
      ["Starting Board", "Sacrificial", 100, 0, ["4-9"]],
      ["Frailty", "Dominate", 46, 90, ["frailty-2-11"]],
    ]);
    expect(v.paragon[0].glyphSlug).toBe("necromancer-sacrificial");
  });

  it("names the affixes, the temper and the masterwork from the game's affix ids", () => {
    const gear = Object.fromEntries(normaliseIcyVeins(icyveins).variants[0].gear.map((g) => [g.slotLabel, g]));
    expect(gear["Helm"].affixes.map((a) => [a.name, a.greater, a.masterwork])).toEqual([
      ["Maximum Life", false, true],
      ["Intelligence", true, false],
    ]);
    expect(gear["Helm"].tempers.map((t) => [t.name, t.masterwork])).toEqual([["Maximum Life (Worldly Endurance)", false]]);
    // the masterwork on this one landed on the tempered line
    expect(gear["Boots"].tempers.map((t) => [t.name, t.masterwork])).toEqual([["Movement Speed (Natural Motion)", true]]);
    expect(gear["Boots"].affixes.map((a) => a.name)).toEqual(["Maximum Resource"]);
  });

  it("names the mercenaries from the short names the planner keeps", () => {
    const m = normaliseIcyVeins(icyveins).variants[0].mercenary;
    expect(m.primary).toMatch(/Varyana/);
    expect(m.reinforcement).toMatch(/Raheir/);
    expect(m.trigger).toMatch(/Injured/);
  });
});

// ---- d4builds --------------------------------------------------------------

/** One build document, decoded from the Firestore shape. */
const d4builds = {
  name: "Test Minion Necro",
  class: "Necromancer",
  season: 15,
  index: 0,
  variantName: "Endgame",
  lastUpdatedSort: 1760000000000,
  gear: { Helm: "Leoric's Crown", Boots: "Necrotic Carapace Aspect", "Ring 1": "Ring of Starless Skies", Jewelry: "ignored" },
  newStats: { Helm: ["Maximum Life", "Cooldown Reduction"], Boots: ["Movement Speed"] },
  greaterAffixes: { Helm: [1, null] },
  masterworking: { Helm: [null, 2] },
  temperingStats: { Helm: ["[1500-2000] Maximum Life (Worldly Endurance - Defensive)"] },
  newGems: { Helm: ["Splinter of Pain"], Boots: [] },
  charms: ["Hellfire Torch", null],
  charmStats: { "0": ["Maximum Life", null] },
  seal: { name: "Annihilus" },
  sealStats: ["Critical Strike Damage"],
  skills: ["Blood Wave", "Decrepify", null],
  mercenary2: "Raheir, The Shieldbearer",
  mercenarySkill2: "Bastion-v2",
  paragon: {
    selectedTiles: ["startingboard_r15c11", "frailty_r2c11"],
    boards: [
      { name: "Starting Board", glyph: "Sacrificial", glyphLevel: 100, rotation: 0, x: 0, y: 0 },
      { name: "Frailty", glyph: "Dominate", glyphLevel: 46, rotation: 540, x: 0, y: -1 },
    ],
  },
  notes: "Use Blood Wave on cooldown.",
  variants: [{ index: 1, name: "Starter", gear: { Helm: "Harlequin Crest" }, newStats: {}, skills: [] }],
};

describe("d4builds", () => {
  it("reads a build link and the variant it opens", () => {
    expect(parseD4BuildsUrl("https://d4builds.gg/builds/23ae9cbb-933e-4a88-999c-2241654cc8e2/?var=2")).toEqual({
      id: "23ae9cbb-933e-4a88-999c-2241654cc8e2",
      variant: "2",
    });
    expect(parseD4BuildsUrl("23ae9cbb-933e-4a88-999c-2241654cc8e2")).toEqual({ id: "23ae9cbb-933e-4a88-999c-2241654cc8e2", variant: undefined });
  });

  it("asks for the share link when the link only has the build's name in it", () => {
    expect(() => parseD4BuildsUrl("https://d4builds.gg/builds/blazing-scream-warlock-leveling/?var=0")).toThrow(/Share link/);
  });

  it("decodes Firestore's typed values", () => {
    expect(
      decodeFirestore({
        mapValue: {
          fields: {
            name: { stringValue: "Test" },
            season: { integerValue: "15" },
            leveling: { booleanValue: false },
            charms: { arrayValue: { values: [{ stringValue: "Hellfire Torch" }, { nullValue: null }] } },
          },
        },
      }),
    ).toEqual({ name: "Test", season: 15, leveling: false, charms: ["Hellfire Torch", null] });
  });

  it("maps the header and both variants", () => {
    const b = normaliseD4Builds(d4builds, "https://d4builds.gg/builds/23ae9cbb-933e-4a88-999c-2241654cc8e2/", "23ae9cbb-933e-4a88-999c-2241654cc8e2");
    expect(b.source).toBe("d4builds");
    expect(b.name).toBe("Test Minion Necro");
    expect(b.className).toBe("Necromancer");
    expect(b.season).toBe("Season 15");
    expect(b.id).toBe("d4builds:23ae9cbb-933e-4a88-999c-2241654cc8e2");
    expect(b.variants.map((v) => [v.id, v.name])).toEqual([
      ["0", "Endgame"],
      ["1", "Starter"],
    ]);
  });

  it("maps every gear slot with its affixes, greater, masterwork, tempers and sockets", () => {
    const v = normaliseD4Builds(d4builds).variants[0];
    const gear = Object.fromEntries(v.gear.map((g) => [g.slotLabel, g]));
    expect(v.gear[0].slotLabel).toBe("Helm");
    expect(gear["Helm"].itemName).toBe("Leoric's Crown");
    expect(gear["Helm"].kind).toBe("unique");
    expect(gear["Helm"].affixes.map((a) => [a.name, a.greater, a.masterwork])).toEqual([
      ["Maximum Life", true, false],
      ["Cooldown Reduction", false, true],
    ]);
    expect(gear["Helm"].tempers[0].name).toBe("Maximum Life (Worldly Endurance)");
    expect(gear["Helm"].sockets).toEqual([{ slug: "splinter-of-pain", name: "Splinter of Pain", kind: "gem" }]);
    expect(gear["Boots"].kind).toBe("aspect");
    expect(gear["Ring 1"].slot).toBe("ring-1");
    // gems listed per item kind ("Jewelry") belong to no one slot
    expect(gear["Jewelry"]).toBeUndefined();
  });

  it("maps the talisman, the skill bar, the paragon and the mercenaries", () => {
    const v = normaliseD4Builds(d4builds).variants[0];
    const gear = Object.fromEntries(v.gear.map((g) => [g.slotLabel, g]));
    expect([gear["Seal"].itemName, gear["Seal"].kind]).toEqual(["Annihilus", "seal"]);
    expect(gear["Seal"].affixes.map((a) => a.name)).toEqual(["Critical Strike Damage"]);
    expect([gear["Charm 1"].itemName, gear["Charm 1"].kind]).toEqual(["Hellfire Torch", "charm"]);
    expect(gear["Charm 1"].affixes.map((a) => a.name)).toEqual(["Maximum Life"]);
    expect(v.skillBar.map((s) => [s.position, s.name])).toEqual([
      [1, "Blood Wave"],
      [2, "Decrepify"],
    ]);
    expect(v.paragon.map((p) => [p.name, p.glyphName, p.glyphLevel, p.rotation, p.nodes])).toEqual([
      ["Starting Board", "Sacrificial", 100, 0, ["startingboard_r15c11"]],
      ["Frailty", "Dominate", 46, 180, ["frailty_r2c11"]],
    ]);
    expect(v.mercenary.primary).toMatch(/Raheir/);
    expect(v.mercenary.reinforcementSkill).toBe("Bastion");
    expect(v.sections[0].text).toBe("Use Blood Wave on cooldown.");
  });
});

// ---- name mapping ----------------------------------------------------------

describe("names from another site → the app's slugs", () => {
  it("resolves a name to the game's spelling, with the class where a table needs it", () => {
    expect(refOf("Leoric's Crown", "uniques")).toEqual({ slug: "leorics-crown", name: "Leoric's Crown" });
    expect(refOf("Sacrificial", "glyphs", "Necromancer")).toEqual({ slug: "necromancer-sacrificial", name: "Sacrificial" });
    expect(refOf("aspect of hewed flesh", "aspects").slug).toBe("aspect-of-hewed-flesh");
  });

  it("keeps a name no table knows, so nothing is lost", () => {
    expect(refOf("Thing From Next Season", "uniques")).toEqual({ slug: "thing-from-next-season", name: "Thing From Next Season" });
    expect(refOf("")).toEqual({ slug: "", name: "" });
  });

  it("matches the one entry a half-name can only mean", () => {
    expect(looseRef("Varyana", "mercs").name).toMatch(/Varyana/);
    expect(looseRef("ShieldBearer", "mercs").name).toMatch(/Raheir/);
    // two mercenaries would fit, so neither is picked
    expect(looseRef("The", "mercs").name).toBe("The");
  });

  it("drops the tier a site puts in front of a gem or a splinter", () => {
    expect(socketRef("Royal Ruby")).toEqual({ slug: "ruby", name: "Ruby", kind: "gem" });
    expect(socketRef("Abyssal Splinter of Sin")).toEqual({ slug: "splinter-of-sin", name: "Splinter of Sin", kind: "gem" });
    expect(socketRef("Igni").kind).toBe("rune");
    expect(socketRef("Nothing Like It").kind).toBe("other");
  });

  it("says what fills a slot: the tables first, then the site's own word for it", () => {
    expect(itemKindOf("leorics-crown", "Leoric's Crown")).toBe("unique");
    expect(itemKindOf("aspect-of-hewed-flesh", "Aspect of Hewed Flesh")).toBe("aspect");
    // a charm that copies a unique carries the unique's name: the slot decides
    expect(itemKindOf("fists-of-fate", "Fists of Fate")).toBe("unique");
    expect(itemKindOf("fists-of-fate", "Fists of Fate", "charm")).toBe("charm");
    expect(itemKindOf("thing-from-next-season", "Thing From Next Season", "mythic")).toBe("mythic");
    expect(itemKindOf("thing-from-next-season", "Thing From Next Season")).toBe("other");
  });

  it("reads a tempering line as the stat and its recipe", () => {
    expect(temperRef("[62.5-85%] Critical Strike Damage (Berserking Finesse - Offensive)").name).toBe("Critical Strike Damage (Berserking Finesse)");
    expect(temperRef("Movement Speed (Natural Motion - Mobility)")).toEqual({
      slug: "movement-speed",
      name: "Movement Speed (Natural Motion)",
      greater: false,
      masterwork: false,
    });
  });
});
