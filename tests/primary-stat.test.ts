import { describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import type { BuildVariant, GearSlot, ParsedItem } from "../src/lib/types";

// Guides often ask for "Primary Core Stat": the class's main stat, which the tooltip names (Intelligence for a
// Necromancer). It counted as missing on every item until 2026-10-25 (The Undercrown read "0 of 2").
const stat = (name: string) => ({ slug: name.toLowerCase().replace(/\W+/g, "-"), name, greater: false, masterwork: false });
const slot = (s: string, names: string[]): GearSlot => ({
  slot: s, slotLabel: s, group: "gear", itemSlug: "", itemName: "", kind: "legendary", affixes: names.map(stat), tempers: [], sockets: [], implicits: [], extras: [],
});
const variant = (gear: GearSlot[]): BuildVariant => ({
  id: "1", name: "Test", description: "", gear, skillOrder: [], skillRanks: {}, skillBar: [], summons: [], paragon: [], mercenary: {} as any, priority: [], sections: [],
});
const helm = (lines: string[]): ParsedItem => ({
  name: "Test Helm", rarity: "legendary", itemType: "Helm", slot: "helm", itemPower: 800, equipped: true,
  affixes: lines.map((text) => ({ text, match: text.replace(/^[+x\d.,%\s]+/, "") }) as any),
});
const prog = () => ({ state: "have", masterwork: 0, tempered: false }) as any;

describe("Primary Core Stat", () => {
  it("is the main stat the build names elsewhere", () => {
    const v = variant([slot("helm", ["Primary Core Stat", "Movement Speed"]), slot("ring-1", ["Intelligence", "Critical Strike Chance"])]);
    const r = decide(helm(["+108 Intelligence", "+1,400 Maximum Life"]), v, { prog });
    expect(r.matched).toEqual(["Primary Core Stat"]);
    expect(decide(helm(["+108 Strength", "+1,400 Maximum Life"]), v, { prog }).matched).toEqual([]);
  });

  it("is any main stat when the build never names one", () => {
    const v = variant([slot("helm", ["Primary Core Stat", "Movement Speed"])]);
    expect(decide(helm(["+108 Willpower", "+5% Movement Speed"]), v, { prog }).matched).toEqual(["Primary Core Stat", "Movement Speed"]);
  });
});
