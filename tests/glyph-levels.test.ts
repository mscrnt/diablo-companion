// Glyph levels kept current without the mapping flow: the Pit's upgrade panel as auto-judge frames read it in real
// runs (2026-10-11, 2026-10-16, 2026-10-17), and glyph tooltips hovered anywhere.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { glyphActiveText, looksLikeGlyph, ocrRows, parseGlyphHover, parseGlyphUpgrade, stepGlyphUpgrade, type GlyphUpgradeMemo } from "../src/lib/charsheet";
import { loadStaticData, table } from "../src/lib/names";
import { isPersonalLine } from "../src/lib/privacy";

const json = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/character/${name}.json`, import.meta.url), "utf8"));
const panel: { frames: { at: string; lines: { text: string; x: number; y: number; w: number; h: number }[] }[] } = json("glyph-upgrade-panel");
/** a frame as the app reads it: OCR lines joined into screen rows */
const rows = (at: string) => ocrRows(panel.frames.find((f) => f.at.replace(/[:.]/g, "-").startsWith(at))!.lines).map((r) => r.map((p) => p.text.trim()).join(" "));

let glyphs: { slug: string; name: string }[] = [];
beforeAll(async () => {
  await loadStaticData();
  glyphs = Object.entries(table("glyphs")).filter(([, g]) => !g.c || g.c === "necromancer").map(([slug, g]) => ({ slug, name: g.n }));
});

describe("the Pit's glyph upgrade panel", () => {
  it("reads the glyph, its level, the gain and the upgrades left", () => {
    expect(parseGlyphUpgrade(rows("2026-10-11T04-20-43"), glyphs)).toMatchObject({ hit: { name: "Amplify" }, level: 87, plus: 1, result: null, available: 11 });
    expect(parseGlyphUpgrade(rows("2026-10-17T04-58-06"), glyphs)).toMatchObject({ hit: { name: "Warrior" }, level: 100, plus: 1, available: 7 });
    // the panel half off the screen edge: "Level: 99" and "/ 150" are two OCR lines
    expect(parseGlyphUpgrade(rows("2026-10-16T04-54-59"), glyphs)).toMatchObject({ hit: { name: "Deadraiser" }, level: 99, available: 0 });
  });

  it("the result covers the level: \"Upgrade Success\" / \"Upgrade Failed\"", () => {
    expect(parseGlyphUpgrade(rows("2026-10-11T04-20-54"), glyphs)).toMatchObject({ hit: { name: "Warrior" }, level: null, result: "success", available: 6 });
    expect(parseGlyphUpgrade(rows("2026-10-11T04-20-59"), glyphs)).toMatchObject({ hit: { name: "Eliminator" }, result: "success", available: null });
    expect(parseGlyphUpgrade(rows("2026-10-16T04-54-47"), glyphs)).toMatchObject({ hit: { name: "Warrior" }, result: "failed", available: 4 });
  });

  it("\"Pit Level: 95\" is never the glyph's level", () => {
    // mid-animation: no level line, only the Pit's tier
    expect(parseGlyphUpgrade(rows("2026-10-11T04-20-48"), glyphs)).toMatchObject({ hit: { name: "Eliminator" }, level: null });
    expect(parseGlyphHover(rows("2026-10-11T04-20-48"), glyphs)).toBeNull();
  });

  it("a level read off the panel is saved; an upgrade shows as one", () => {
    const memo: GlyphUpgradeMemo = new Map();
    expect(stepGlyphUpgrade(memo, parseGlyphUpgrade(rows("2026-10-16T04-54-52"), glyphs)!)).toMatchObject({ name: "Deadraiser", level: 98, upgraded: false });
    expect(stepGlyphUpgrade(memo, parseGlyphUpgrade(rows("2026-10-16T04-54-59"), glyphs)!)).toMatchObject({ name: "Deadraiser", level: 99, upgraded: true });
  });

  it("\"Upgrade Success\" adds the gain once, even if the panel is closed before the new level shows", () => {
    const memo: GlyphUpgradeMemo = new Map();
    stepGlyphUpgrade(memo, parseGlyphUpgrade(rows("2026-10-11T18-00-57"), glyphs)!); // Warrior 90 (+1), 7 left
    const success = (available: number) => ({ ...parseGlyphUpgrade(rows("2026-10-11T04-20-54"), glyphs)!, available });
    expect(stepGlyphUpgrade(memo, success(6))).toMatchObject({ name: "Warrior", level: 91, upgraded: true });
    // the same animation read again: no second level
    expect(stepGlyphUpgrade(memo, success(6))).toBeNull();
    // the panel shows 91 again: nothing new
    expect(stepGlyphUpgrade(memo, { ...parseGlyphUpgrade(rows("2026-10-11T18-00-57"), glyphs)!, level: 91, available: 6 })).toMatchObject({ level: 91, upgraded: false });
    // the next try succeeds too
    expect(stepGlyphUpgrade(memo, success(5))).toMatchObject({ level: 92, upgraded: true });
    // a failure changes nothing
    expect(stepGlyphUpgrade(memo, parseGlyphUpgrade(rows("2026-10-16T04-54-47"), glyphs)!)).toBeNull();
  });

  it("a success for a glyph never read before isn't guessed", () => {
    expect(stepGlyphUpgrade(new Map(), parseGlyphUpgrade(rows("2026-10-11T04-20-59"), glyphs)!)).toBeNull();
  });

  it("the fixture names no player", () => {
    for (const f of panel.frames) for (const l of f.lines) expect(isPersonalLine(l.text), l.text).toBe(false);
  });
});

describe("glyph tooltips hovered anywhere", () => {
  it("a glyph tooltip is one; a stats panel or a skill tooltip isn't", () => {
    expect(looksLikeGlyph(json("glyphhover-warrior").lines)).toBe(true);
    expect(looksLikeGlyph(json("glyphhover-deadraiser").lines)).toBe(true);
    expect(looksLikeGlyph(json("stats-panel").lines)).toBe(false);
    expect(looksLikeGlyph(json("skillhover-blight").lines)).toBe(false);
  });

  it("the tooltip tells if the glyph is on a board", () => {
    expect(glyphActiveText(json("glyphhover-warrior").lines)).toBe(true);
    expect(glyphActiveText(["Warrior", "LEVEL 84", "Drag to Equip"])).toBe(false);
    expect(glyphActiveText(["Warrior", "LEVEL 84"])).toBeNull();
  });
});
