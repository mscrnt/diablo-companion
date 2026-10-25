// Your own gear: a tooltip opened from the Character panel has no "EQUIPPED" header, the panel's
// stats show around it, and the judge must never tell you to scrap what you're wearing.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse, isUnequipLine, type FastLine } from "../src/lib/fastparse";
import { decide, sameAsWorn } from "../src/lib/judge";
import { aspectFromItemName } from "../src/lib/names";
import { sheetLabel } from "../src/lib/ocrfix";
import type { ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

/** The Ocelot's Eye as the game's EQUIPPED comparison column showed it (what you wear). */
const wornAmulet = () => fastParse(fixture("lions-eye-vs-worn-ocelots-eye").equipped.lines, true, ctx.variant)!;

describe("reading helpers", () => {
  it("the footer hint Unequip, OCR variants included, but not Equip or Unique Equipped", () => {
    for (const t of ["Unequip", "Unequlp", "* Unequip", "Un equip"]) expect(isUnequipLine(t), t).toBe(true);
    for (const t of ["Equip", "Unique Equipped", "Jnique Equipped", "Unmark Item", "Unequip this item now"]) expect(isUnequipLine(t), t).toBe(false);
  });

  it("Character panel labels, also cut off by the tooltip's edge; never titles or wrapped text", () => {
    for (const t of ["Toughness", "Weapon Dama", "Stats & Material", "Equipment", "Willpower", "Dexterity"]) expect(sheetLabel(t), t).toBe(true);
    for (const t of ["ARMOR", "OF HEAVENLY STRENGTH", "REANIMATION", "Multiplier", "Damage", "increased damage while alive, up to", "122% after 10 seconds."])
      expect(sheetLabel(t), t).toBe(false);
  });

  it("names the aspect from the item name", () => {
    expect(aspectFromItemName("Ocelot's Eye of Reanimation")).toBe("Aspect of Reanimation");
    expect(aspectFromItemName("Doom Armor of Dominance")).toBe("Aspect of Dominance");
    expect(aspectFromItemName("Sovereign Mail of Nothing In Particular")).toBeNull();
  });
});

describe("your amulet, hovered in the Character panel", () => {
  it("is read as equipped, with its full name and aspect, and no panel text", () => {
    const f = fixture("ocelots-eye-character-panel");
    expect(f.ocr.some((l: string) => /^\s*equipped\s*$/i.test(l))).toBe(false);
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.equipped).toBe(true);
    expect(item.name).toBe("Ocelot's Eye of Reanimation");
    expect(item.aspect?.name).toBe("Aspect of Reanimation");
    expect(item.aspect?.imprinted).toBe(true);
    expect(item.aspect?.text).toBe("Your Summons gain 122% after 10 seconds.");
    const texts = item.affixes.map((a) => a.text);
    expect(texts).toContain("x44% Critical Strike Damage Multiplier"); // was "… Damage Intelligence Multiplier"
    expect(texts.join(" | ")).not.toMatch(/toughness|strength|willpower|dexterity|equipment|weapon dama|977|unequip|unmark/i);
  });

  it("gets WEARING with its to-do list, never SCRAP", () => {
    const item = fastParse(fixture("ocelots-eye-character-panel").lines, false, ctx.variant)!;
    const r = decide(item, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "amulet" ? wornAmulet() : undefined) }, item.compare);
    expect(r.verdict).toBe("WEARING");
    expect(r.slot).toBe("amulet");
    expect(r.steps?.length).toBeGreaterThan(0);
  });

  it("even with the Unequip hint missed, matching what you wear means it's yours", () => {
    const item: ParsedItem = { ...fastParse(fixture("ocelots-eye-character-panel").lines, false, ctx.variant)!, equipped: false };
    expect(sameAsWorn(item, wornAmulet())).toBe(true);
    const r = decide(item, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "amulet" ? wornAmulet() : undefined) }, null);
    expect(r.verdict).toBe("WEARING");
    expect(r.reasons[0]).toMatch(/looks like the one you're wearing/);
  });

  it("panel text in another column is dropped by position when lines carry boxes", () => {
    // no vocabulary: only the boxes can tell the panel ("Aged Boots", "Jack" from the panel) from the tooltip
    const L = (text: string, x: number, w: number, bullet: FastLine["bullet"] = "none", h = 24): FastLine => ({ text, bullet, h, x, w });
    const lines = [
      L("OCELOT'S EYE OF", 120, 220),
      L("Aged Boots", 0, 90, "none", 20),
      L("REANIMATION", 120, 200),
      L("Ancestral Legendary Amulet", 120, 260),
      L("900 Item Power", 120, 150),
      L("Jack Sparrowhawk", 10, 95),
      L("+219 Intelligence", 140, 170, "normal"),
      L("+9.0% Critical Strike Chance", 140, 260, "normal"),
      L("Gold Plated Something", 10, 98),
      L("+33.8% Summon Damage", 140, 220, "normal"),
      L("Requires Level 70", 260, 150),
    ];
    const item = fastParse(lines, false, ctx.variant, { snap: false })!;
    expect(item.name).toBe("Ocelot's Eye of Reanimation");
    expect(item.affixes.map((a) => a.text)).toEqual(["+219 Intelligence", "+9.0% Critical Strike Chance", "+33.8% Summon Damage"]);
    // nothing from the panel became power text; the aspect still comes from the name
    expect(item.aspect).toEqual({ name: "Aspect of Reanimation", text: "" });
  });
});

describe("a worse amulet than yours", () => {
  const lions = () => fastParse(fixture("lions-eye-vs-worn-ocelots-eye").lines, false, ctx.variant)!;

  it("parses as the unequipped Lion's Eye with the same (imprinted) aspect", () => {
    const item = lions();
    expect(item.equipped).toBe(false);
    expect(item.name).toBe("Lion's Eye of Reanimation");
    expect(item.aspect).toMatchObject({ name: "Aspect of Reanimation", imprinted: true });
    expect(sameAsWorn(item, wornAmulet())).toBe(false);
  });

  // your Ocelot's Eye's 44% Crit Damage is its Occultist enchant: Lion's Eye (no enchant yet) can get it too,
  // giving up its weakest stat, so that 44% isn't counted against it (2026-10-11 test session)
  it("with the game's comparison: no better, and yours's enchant is credited to it", () => {
    const item = lions();
    const r = decide(item, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "amulet" ? wornAmulet() : undefined) }, wornAmulet());
    expect(r.verdict).toBe("SCRAP");
    expect(r.reasons.join(" ")).not.toMatch(/Crit Damage: yours has 44%/);
    expect(r.reasons.join(" ")).toMatch(/enchanted: compared as if this one gets the same work/);
    // what the enchant would replace (its weakest stat, here the +3 Darkness ranks a minion build barely uses) is
    // a small loss, so it can sit below the five comparison lines shown
    expect(r.reasons.join(" ")).toMatch(/imprinted/);
  });

  it("from memory alone: names your amulet, and the comparison is close", () => {
    const item: ParsedItem = { ...lions(), compare: null, compareRows: undefined };
    const r = decide(item, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "amulet" ? wornAmulet() : undefined) }, null);
    expect(r.verdict).toBe("SCRAP");
    expect(r.reasons[0]).toMatch(/(than|as) yours \(Ocelot's Eye of Reanimation\)/);
  });

  it("not imprinted: salvage it for the aspect, unless the Codex already has it", () => {
    const item: ParsedItem = { ...lions(), aspect: { ...lions().aspect!, imprinted: false } };
    const worn = (s: string) => (s === "amulet" ? wornAmulet() : undefined);
    expect(decide(item, ctx.variant, { prog: ctx.prog, worn }, wornAmulet()).verdict).toBe("EXTRACT");
    const r = decide(item, ctx.variant, { prog: ctx.prog, worn, inCodex: () => true }, wornAmulet());
    expect(r.verdict).toBe("SCRAP");
    expect(r.reasons.join(" ")).toMatch(/Codex already has Aspect of Reanimation/);
  });

  it("with nothing on record: scrap says what the build wants there", () => {
    const item: ParsedItem = { ...lions(), compare: null, compareRows: undefined };
    const r = decide(item, ctx.variant, { prog: ctx.prog }, null);
    if (r.verdict === "SCRAP") expect(r.reasons.join(" ")).toMatch(/For your Amulet your build wants .+; this has/);
    else expect(r.verdict).not.toBe("WEARING");
  });
});
