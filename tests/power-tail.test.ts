// A legendary power whose third line starts with a number ("50% Critical Strike Damage for 4") was read as a
// +50% Crit Damage stat, and the ring got a WEAR verdict on it (2026-10-13 player report).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse, type FastLine } from "../src/lib/fastparse";
import { loadStaticData } from "../src/lib/names";

beforeAll(() => loadStaticData());

const lines: FastLine[] = JSON.parse(readFileSync(new URL("./fixtures/tooltips/penitents-ring-2026-10-13.json", import.meta.url), "utf8"));

describe("a power paragraph line that starts with a number", () => {
  it("stays in the power, not the stats", () => {
    const item = fastParse(lines, false, undefined)!;
    expect(item.affixes.map((a) => a.text).join(" | ")).not.toMatch(/50%/);
    expect(item.affixes.length).toBe(5);
    expect(item.aspect?.text).toMatch(/and 50% Critical Strike Damage.*4 seconds/);
  });

  it("a wrapped stat still ends where the next one starts", () => {
    const item = fastParse(lines, false, undefined)!;
    expect(item.affixes.map((a) => a.text)).toContain("7.0% Cooldown Reduction");
  });
});
