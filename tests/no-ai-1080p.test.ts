// A player at 1920x1080 with no AI model set up (2026-10-12 report): the quick parser is all there is, and
// 45 of their tooltips came out "couldn't read". White and blue items, a wrapped type line, a speck of OCR
// junk under the title, a garbled "Mythic Unique", and the wrong copy of a unique that exists per weapon type.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse, type FastLine } from "../src/lib/fastparse";
import { decide } from "../src/lib/judge";
import { loadStaticData } from "../src/lib/names";
import { exampleBuild } from "./helpers";

const fx: Record<string, FastLine[]> = JSON.parse(readFileSync(new URL("./fixtures/tooltips/1080p-no-ai.json", import.meta.url), "utf8"));
const read = (k: string) => fastParse(fx[k], false, undefined);

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => {
  await loadStaticData();
  ctx = await exampleBuild();
});

describe("1080p, no AI model", () => {
  it("a blue item whose type line wraps ('Ancestral Magic Two-' / 'Handed Mace')", () => {
    const item = read("vigorousMaul")!;
    expect(item).toMatchObject({ name: "Vigorous Maul", rarity: "magic", slot: "weapon" });
    expect(item.affixes.some((a) => a.greater)).toBe(false); // blue items never roll ★
  });

  it("a white item with no rarity word ('Ancestral Axe (Slashing)')", () => {
    expect(read("handAxe")).toMatchObject({ name: "Hand Axe", rarity: "common" });
  });

  it("a speck of OCR junk between the title and the type line", () => {
    expect(read("crudeHammerJunkLine")).toMatchObject({ name: "Crude Hammer", rarity: "common" });
  });

  it("a yellow item with only one stat read", () => {
    expect(read("rareOneStat")).toMatchObject({ name: "Strife Reaper", rarity: "rare" });
  });

  it("Infinity the two-handed mace, not Infinity (Bow)", () => {
    expect(read("infinityMace")?.name).toBe("Infinity (2h Mace)");
  });

  it("a garbled 'Mythic Unique' still reads as mythic, so no imprint advice", () => {
    const item = read("garbledMythicRarity")!;
    expect(item.rarity).toBe("mythic");
    const r = decide(item, ctx.variant, { prog: ctx.prog }, null);
    expect([r.action, ...(r.steps ?? [])].join(" ")).not.toMatch(/imprint/i);
  });

  it("white and blue items get a verdict, not 'couldn't read'", () => {
    for (const k of ["vigorousMaul", "handAxe", "crudeHammerJunkLine"]) {
      const r = decide(read(k)!, ctx.variant, { prog: ctx.prog }, null);
      expect(["SELL", "SCRAP"], k).toContain(r.verdict);
    }
  });
});
