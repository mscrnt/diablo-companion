// OCR snapping: misread words are fixed against the game's own text, numbers are kept,
// and real text the vocabulary doesn't know is left alone.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse } from "../src/lib/fastparse";
import { knownStat, snapLine } from "../src/lib/ocrfix";
import { exampleBuild } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

describe("snapLine fixes misreads from the judge log", () => {
  const FIXES: [string, string][] = [
    ["ARIT10R", "ARMOR"],
    ["DOTTIINANCE", "DOMINANCE"],
    ["REANITTIATION", "REANIMATION"],
    ["REANIITIATION", "REANIMATION"],
    ["DOIITIINANCE", "DOMINANCE"],
    ["COTTIPOUND", "COMPOUND"],
    ["SHAmANlSTlC", "SHAMANISTIC"],
    ["+1,145 Thoms", "+1,145 Thorns"],
    ["* Gain 2,137 Thoms while Channeling", "* Gain 2,137 Thorns while Channeling"],
    ["Pequires Level 70", "Requires Level 70"],
    ["ocount Bound", "Account Bound"],
    ["Jnique Equipped", "Unique Equipped"],
    ["lémpers.• 3/3", "Tempers: 3/3"],
    ["Compareotherslot", "Compare other slot"],
    ["5.0% Cooldown Reduc!ion (+5.0%)", "5.0% Cooldown Reduction (+5.0%)"],
    ["+139 IntelligenceÄ(-239)", "+139 Intelligence (-239)"],
    ["+2, 195 Maximum Life", "+2,195 Maximum Life"],
    ["+1,534Life (+1,534)", "+1,534 Life (+1,534)"],
    ["+1,512 Life OnHit (+1,512)", "+1,512 Life On Hit (+1,512)"],
    ["o +9.0% Critical Strike Chance", "+9.0% Critical Strike Chance"],
    ["X +11.0% Critical Strike Chance", "+11.0% Critical Strike Chance"],
    ["x26% Critical Strike Damage Multlplier", "x26% Critical Strike Damage Multiplier"],
    ["Sell Value: 38,450 •", "Sell Value: 38,450"],
  ];
  for (const [ocr, want] of FIXES) it(`${ocr} → ${want}`, () => expect(snapLine(ocr)).toBe(want));
});

describe("snapLine doesn't over-correct", () => {
  const KEEP = [
    // real text, already right
    "+9.8% Critical Strike Chance (+0.8%)",
    "x21 % All Damage Multiplier (+21 %)",
    "4,573 Damage Per Second",
    "PERPLEX ROUND",
    "OF AKARAT'S",
    "BLESSING * *",
    "OF HEWED FLESH",
    "Ancestral Chest Armor",
    "* You deal 83% increased Corrupting",
    // half a line (the rest is on the next line): not a different, longer line
    "Legendary Two-Handed",
    "Ancestral Legendary Two-",
    "_atred Item",
    // words the game data doesn't know, or that need more than an OCR slip
    "Kelara",
    "Remove from Cube",
    "on chest armors, gems",
    "Aged poots",
    "a 25% chance to",
  ];
  for (const t of KEEP) it(`keeps "${t}"`, () => expect(snapLine(t)).toBe(t));
});

describe("tooltips with misreads", () => {
  it("Doom Armor of Dominance: name and aspect repaired", () => {
    const f = fixture("doom-armor-of-dominance");
    const before = fastParse(f.lines, false, ctx.variant, { snap: false })!;
    expect(before.name).toBe("Doom Arit10r of Dottiinance");
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.name).toBe("Doom Armor of Dominance");
    expect(item.slot).toBe("chest");
    expect(item.aspect?.name).toBe("Aspect of Dominance");
    // "2 Resolve." is the end of the power, not an affix
    expect(item.affixes.map((a) => a.text)).not.toContain("2 Resolve.");
  });

  it("Grave Bulwark: garbled stat words fixed, panel text dropped", () => {
    const item = fastParse(fixture("vanquishing-grave-bulwark").lines, false, ctx.variant)!;
    const texts = item.affixes.map((a) => a.text);
    expect(texts).toContain("+139 Intelligence");
    expect(texts).toContain("5.0% Cooldown Reduction");
    expect(item.affixes.find((a) => a.text === "+139 Intelligence")?.match).toBe("Intelligence");
    expect(item.aspect?.text).toBe("You deal 70% more damage to Incapacitated enemies.");
    expect(item.affixes.every((a) => knownStat(a.text))).toBe(true);
  });

  it("Ring of Decay over the character panel: character name and panel fragments left out", () => {
    const f = fixture("ring-of-decay-character-panel");
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.name).not.toMatch(/zorvak/i);
    expect(item.name).toMatch(/Ring of Decay$/);
    const texts = item.affixes.map((a) => a.text);
    expect(texts).toContain("+100 Intelligence"); // was "+100 Intelligence Damage"
    expect(texts.some((t) => /\bess\b/.test(t))).toBe(false);
  });

  it("Serrated Reaper: the power paragraph isn't read as a Crit Chance affix", () => {
    const f = fixture("serrated-reaper");
    const before = fastParse(f.lines, false, ctx.variant, { snap: false })!;
    expect(before.affixes.some((a) => /increased Critical Strike Chance and/.test(a.text))).toBe(true);
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.affixes.some((a) => /increased Critical Strike Chance and/.test(a.text))).toBe(false);
    expect(item.aspect?.name).toBe("Aspect of Serration");
  });
});
