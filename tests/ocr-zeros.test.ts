// The tooltip font's zeros as 1080p OCR reads them: without the item power a rare failed the sanity check and, with
// no AI model to fall back on, wasn't judged at all (17 tooltips on a player's PC, 2026-11-02).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fastParse, fullReadWins, looksSane, zeros } from "../src/lib/fastparse";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));

describe("zeros the OCR misreads", () => {
  it("reads them back as zeros inside a number", () => {
    expect(zeros("9(H) Item Power")).toBe("900 Item Power");
    expect(zeros("+3,5()() Shadow Resistance")).toBe("+3,500 Shadow Resistance");
    expect(zeros("2,94Ø")).toBe("2,940");
  });

  it("leaves comparison brackets and roll ranges alone", () => {
    expect(zeros("x30% Physical Damage Multiplier ( +30%)")).toBe("x30% Physical Damage Multiplier ( +30%)");
    expect(zeros("+8.5% Critical Strike Chance [6.5 - 8.5]%")).toBe("+8.5% Critical Strike Chance [6.5 - 8.5]%");
  });

  it("a rare read at 1080p is judged, item power and all", () => {
    const f = fixture("rare-gloves-1080p-zeros");
    const item = fastParse(f.lines, f.equippedLabel, undefined)!;
    expect(item.itemPower).toBe(900);
    expect(item.slot).toBe("gloves");
    expect(looksSane(item)).toBe(true);
  });

  it("a rare whose item power is unreadable still passes when its stats were read", () => {
    const f = fixture("rare-gloves-1080p-zeros");
    const lines = f.lines.map((l: { text: string }) => (/item power/i.test(l.text) ? { ...l, text: "9?? Item Power" } : l));
    const item = fastParse(lines, f.equippedLabel, undefined)!;
    expect(item.itemPower ?? null).toBeNull();
    expect(looksSane(item)).toBe(true);
  });
});

// A tooltip read twice: the scan frame (can catch it fading in) and the full crop read again enlarged.
describe("the scan read or the full read", () => {
  const reads = (name: string) => {
    const f = fixture(name);
    return [fastParse(f.scan, false, undefined), fastParse(f.full, false, undefined)] as const;
  };

  it("the full read wins when it's the same item and reads more", () => {
    const [scan, full] = reads("two-reads-cleats");
    expect(full!.name).toBe(scan!.name);
    expect(full!.affixes.length).toBeGreaterThan(scan!.affixes.length);
    expect(fullReadWins(scan, full)).toBe(true);
  });

  it("the scan wins when the crop shows another item: the mouse moved on", () => {
    const [scan, full] = reads("two-reads-moved-on");
    expect(scan!.name).toMatch(/Gohr/);
    expect(fullReadWins(scan, full)).toBe(false);
  });

  it("no full read, or one that makes no sense, keeps the scan", () => {
    const [scan] = reads("two-reads-cleats");
    expect(fullReadWins(scan, null)).toBe(false);
    expect(fullReadWins(scan, { ...scan!, name: "x", affixes: [] })).toBe(false);
  });
});
