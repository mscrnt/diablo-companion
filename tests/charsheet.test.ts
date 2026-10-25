// Character page reading on logged Character-screen OCR (other players' names on screen
// replaced): stats sheet, skill ranks with gear bonus ranks, glyph levels, and cleaning a
// stats map saved by older versions.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { parseGlyphHover, parseSkillHover, parseStatSheet, statsFromRows, tidyStats } from "../src/lib/charsheet";
import { table } from "../src/lib/names";
import { hasGameData } from "./setup";
import { tablesForTests } from "./fixtures/tables";
import { line } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/character/${name}.json`, import.meta.url), "utf8"));

let skills: { slug: string; name: string }[] = [];
let glyphs: { slug: string; name: string }[] = [];
beforeAll(async () => {
  await tablesForTests();
  skills = Object.entries(table("skills")).filter(([, s]) => s.c === "necromancer" && s.t === "basic").map(([slug, s]) => ({ slug, name: s.n }));
  glyphs = Object.entries(table("glyphs")).filter(([, g]) => !g.c || g.c === "necromancer").map(([slug, g]) => ({ slug, name: g.n }));
});

describe("skill ranks", () => {
  it("splits the tooltip rank into points spent and gear ranks", () => {
    // "Army of the Dead Barrier Bonus" / "RANK 9/15 Dodge Chance" / "(Item Contribution: 4) Utility"
    const r = parseSkillHover(fixture("skillhover-army-of-the-dead").lines, skills)!;
    expect(r.hit.name).toBe("Army of the Dead");
    expect(r).toMatchObject({ total: 9, max: 15, bonus: 4, base: 5 });
  });

  it("Blight: rank 9 is 1 point + 8 from gear (the build puts 1 point in it)", () => {
    const r = parseSkillHover(fixture("skillhover-blight").lines, skills)!;
    expect(r.hit.name).toBe("Blight");
    expect(r).toMatchObject({ total: 9, bonus: 8, base: 1 });
  });

  it("leaves the points unknown when OCR cut the contribution number", () => {
    const r = parseSkillHover(fixture("skillhover-blight-contribution-cut").lines, skills)!;
    expect(r).toMatchObject({ total: 9, bonus: null, base: null });
  });

  it("a rank above the max is never taken as points spent (the old 34/15)", () => {
    expect(parseSkillHover(["Golem", "RANK 34/15", "(Item Contribution: 19)"], skills)).toMatchObject({ total: 34, bonus: 19, base: 15 });
    expect(parseSkillHover(["Golem", "RANK 34/15", "Summon"], skills)).toMatchObject({ total: 34, base: null });
    expect(parseSkillHover(["Golem", "RANK 20/15", "(Item Contribution: 3)", "(Buffs Contribution: 2)"], skills)).toMatchObject({ base: 15, bonus: 5 });
  });
});

describe("glyph levels", () => {
  it("reads the glyph above its LEVEL line, even with other text on the row", () => {
    expect(parseGlyphHover(fixture("glyphhover-warrior").lines, glyphs)).toMatchObject({ hit: { name: "Warrior" }, level: 84 });
    // "Gloomy Hat Deadraiser" / "LEVEL 85"
    expect(parseGlyphHover(fixture("glyphhover-deadraiser").lines, glyphs)).toMatchObject({ hit: { name: "Deadraiser" }, level: 85 });
  });

  it("a skill tooltip in the paragon screen isn't a glyph", () => {
    expect(parseGlyphHover(fixture("glyphflow-blight-skill").lines, glyphs)).toBeNull();
  });
});

// the sheet is read against the OCR vocabulary built from the game's own label list, not a few names
describe.skipIf(!hasGameData)("stats sheet", () => {
  it("reads both columns, headers with the value below, and nothing else", () => {
    const s = statsFromRows(fixture("stats-panel").lines);
    expect(s).toEqual({
      "Life Regeneration": "220",
      Armor: "21,362",
      "Block Reduction": "27.7%",
      "All Damage Reduction": "30.0%",
      "Barrier Bonus": "0.0%",
      "Weapon Damage": "4,574",
      "Dodge Chance": "1.8%",
      Toughness: "1,241,124",
      "Maximum Essence": "139",
      "Essence Regeneration": "3.00",
      Strength: "177",
      "Movement Speed": "165.3%",
      Intelligence: "2,682",
      "Cooldown Reduction": "7.5%",
      Willpower: "331",
      Dexterity: "301",
      "Lucky Hit Daze": "5.0%",
      "Lucky Hit Stun": "3.0%",
      "Experience Bonus": "1,519.5%",
      "Damage Reduction": "92.0%",
    });
  });

  it("ignores a skill tooltip drawn over the sheet", () => {
    const s = statsFromRows(fixture("stats-panel-under-skill").lines);
    expect(s["Weapon Damage"]).toBe("4,574");
    expect(s.Toughness).toBe("1,241,124");
    expect(Object.keys(s).every((k) => !/rank|blight|contribution/i.test(k))).toBe(true);
  });

  it("with positions: a panel number never lands on a stats-list label that lost its value", () => {
    const lines = [
      line("Critical Strike Chance", 100, 100, 220),
      line("32.0%", 440, 100, 60),
      line("Weapon Damage", 700, 100, 160),
      line("Thorns", 100, 140, 70), // its value wasn't read
      line("4,574", 700, 140, 60), // the character panel's weapon damage
      line("Lucky Hit Chance", 100, 200, 170),
      line("0.0%", 450, 215, 50),
      line("Bonus", 100, 230, 60),
      line("Strength", 700, 215, 90),
      line("177", 880, 215, 40),
      line("Obols", 100, 300, 60),
      line("25,000", 440, 300, 70),
    ];
    expect(parseStatSheet(lines)).toEqual({
      "Critical Strike Chance": "32.0%",
      "Weapon Damage": "4,574",
      "Lucky Hit Chance Bonus": "0.0%",
      Strength: "177",
    });
  });

  it("cleans a stats map saved before this fix", () => {
    const saved = fixture("saved-v0").stats as Record<string, string>;
    const s = tidyStats(saved);
    // currency, section headers and other players' names are gone
    for (const k of ["Obols", "Pale Marks", "Citadel Coins", "Artificers Stones", "Zorvak", "Pellwick", "Defensive"]) expect(s[k]).toBeUndefined();
    // "Thoms 4,574" was the weapon damage next to other players' names
    expect(s.Thorns).toBeUndefined();
    // a percentage can't be Potion Capacity
    expect(s["Potion Capacity"]).toBeUndefined();
    expect(s).toMatchObject({ Toughness: "1,241,124", Intelligence: "2,682", "Maximum Essence": "139", "Critical Strike Damage": "481.9%", "Damage with Mages": "87.5%" });
    expect(Object.keys(s).length).toBe(44);
  });
});
