// A kind of weapon the class can't wield is no use to it, whatever its stats: a polearm was "great for your
// Necromancer" (2026-11-03). Which classes wield what comes from the game's base items (convert.ts "wieldBy").
import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import { emptyProgress } from "../src/lib/store";
import type { BuildVariant, GearSlot, ParsedItem } from "../src/lib/types";
import { tablesForTests } from "./fixtures/tables";

const slot: GearSlot = {
  slot: "weapon", slotLabel: "Weapon", group: "gear", itemSlug: "", itemName: "Legendary Weapon", kind: "aspect",
  affixes: [{ slug: "strength", name: "Strength", greater: false, masterwork: false }], tempers: [], sockets: [], implicits: [], extras: [],
};
const variant = { id: "0", name: "Endgame", description: "", gear: [slot], skillOrder: [], skillRanks: {}, skillBar: [], summons: [], paragon: [], mercenary: {}, priority: [] } as unknown as BuildVariant;
const weapon = (itemType: string): ParsedItem => ({
  name: "Accelerating Elder Weapon", rarity: "rare", itemType, slot: "weapon", itemPower: 900, aspect: null,
  affixes: [{ text: "+300 Strength", greater: false, match: "Strength" }, { text: "+2,000 Maximum Life", greater: false, match: null }],
});
const judge = (it: ParsedItem, className: string) => decide(it, variant, { prog: () => emptyProgress, className }, null);

describe("weapons a class can't wield", () => {
  beforeAll(async () => void (await tablesForTests()));

  it("a polearm is no use to a Necromancer", () => {
    const r = judge(weapon("Ancestral Rare Polearm"), "Necromancer");
    expect(r.verdict).not.toBe("WEAR");
    expect(r.reasons.join(" ")).toMatch(/can't use a Polearm/);
  });

  it("but is to a Barbarian", () => {
    expect(judge(weapon("Ancestral Rare Polearm"), "Barbarian").reasons.join(" ")).not.toMatch(/can't use/);
  });

  it("the longest kind wins: a two-handed sword isn't judged as a plain sword", () => {
    const r = judge(weapon("Ancestral Rare Two-Handed Sword (Slashing)"), "Rogue");
    expect(r.reasons.join(" ")).toMatch(/can't use a Two-Handed Sword/);
    expect(judge(weapon("Rare Sword"), "Rogue").reasons.join(" ")).not.toMatch(/can't use/);
  });
});
