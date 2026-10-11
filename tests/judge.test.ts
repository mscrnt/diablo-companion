// Replays real tooltips from the judge log through the instant parser and the verdict logic.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse, looksSane } from "../src/lib/fastparse";
import { decide } from "../src/lib/judge";
import { exampleBuild } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));

const CASES = [
  { file: "hewed-flesh-boots", name: /Hewed Flesh/, slot: "boots", rarity: "legendary", verdict: "EXTRACT", why: "build aspect, salvage it into the Codex" },
  { file: "accursed-touch-helm", name: /Accursed Touch/, slot: "helm", rarity: "legendary", verdict: "SCRAP", why: "aspect the build doesn't use" },
  { file: "sticker-thought-pants", name: /Thought/, slot: "pants", rarity: "legendary", verdict: "SCRAP", why: "aspect the build doesn't use" },
  { file: "deathgrip", name: /^Deathgrip$/, slot: "gloves", rarity: "unique", verdict: "WEAR", why: "core unique you don't own yet" },
  { file: "whisper-cache", name: /Collection of Chestplates/, slot: "other", rarity: "legendary", verdict: "STASH", why: "not gear" },
] as const;

describe("loot judge on logged tooltips", () => {
  let ctx: Awaited<ReturnType<typeof exampleBuild>>;
  beforeAll(async () => void (ctx = await exampleBuild()));

  for (const c of CASES) {
    it(`${c.file}: ${c.verdict} (${c.why})`, () => {
      const f = fixture(c.file);
      const equipped = f.ocr.some((l: string) => /^\s*equipped\s*$/i.test(l));
      const item = fastParse(f.lines, equipped, ctx.variant);
      expect(item, "fast parser should be confident").toBeTruthy();
      expect(looksSane(item!)).toBe(true);
      expect(item!.name).toMatch(c.name);
      expect(item!.slot).toBe(c.slot);
      expect(item!.rarity).toBe(c.rarity);
      const r = decide(item!, ctx.variant, { prog: ctx.prog }, item!.compare);
      expect(r.verdict).toBe(c.verdict);
      expect(r.action).toBeTruthy();
    });
  }

  it("parses a tooltip in well under a frame", () => {
    const f = fixture("hewed-flesh-boots");
    const t0 = performance.now();
    for (let i = 0; i < 20; i++) fastParse(f.lines, false, ctx.variant);
    expect((performance.now() - t0) / 20).toBeLessThan(50);
  });
});

describe("a bag item is never 'worn'", () => {
  it("ignores a stray Unequip hint when the tooltip compares itself with your gear", async () => {
    const ctx = await exampleBuild();
    const f = fixture("accursed-touch-helm");
    // a neighbouring panel's footer read along with the tooltip (seen on Black Rail of the Great Feast)
    const lines = [...f.lines, { text: "Unequip", bullet: "none" }];
    const item = fastParse(lines, false, ctx.variant)!;
    expect(item.compareRows?.length).toBeGreaterThan(0);
    expect(item.equipped).toBe(false);
    expect(decide(item, ctx.variant, { prog: ctx.prog }, item.compare).verdict).not.toBe("WEARING");
  });
});

describe("a tooltip whose title is cut off", () => {
  it("is still read locally, named by its type, and judged on its stats", async () => {
    const ctx = await exampleBuild();
    const f = fixture("untitled-sword");
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.untitled).toBe(true);
    expect(item.name).toBe("Legendary Sword");
    expect(looksSane(item)).toBe(true);
    expect(item.affixes.length).toBeGreaterThanOrEqual(3);
    expect(decide(item, ctx.variant, { prog: ctx.prog }, item.compare).verdict).not.toBe("UNKNOWN");
  });
});

describe("type line misreads", () => {
  it("a garbled rarity word doesn't end up in the name, and a panel label isn't the type line", async () => {
    const ctx = await exampleBuild();
    // seen on a Magic Scythe hovered over the Character panel ("Aged Boots" is the panel's slot label)
    const L = (text: string, h = 25) => ({ text, bullet: "normal" as const, h });
    const item = fastParse([L("YISE HAND SICKLE", 30), L("ii/ölakic Scythe"), L("Boots"), L("800 Item Power"), L("+90 Intelligence"), L("+5% Attack Speed")], false, ctx.variant)!;
    expect(item.name).toBe("Yise Hand Sickle");
    expect(item.slot).toBe("weapon");
    expect(item.rarity).toBe("magic");
  });
});

describe("greater affixes read as a star character", () => {
  it("a 4★ item whose stars OCR as \"*\" is saved for later, not scrapped", async () => {
    const ctx = await exampleBuild();
    // Serpent's Bite of Exorcism (2026-10-11): all four affixes are ★; OCR read each starburst as "*"
    const f = fixture("untitled-sword");
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.affixes.filter((a) => a.greater).length).toBe(4);
    const r = decide(item, ctx.variant, { prog: ctx.prog }, item.compare);
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Save it for later — 4★ greater affixes/);
  });
});
