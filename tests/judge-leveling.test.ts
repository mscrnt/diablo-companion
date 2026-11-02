// A new character's drops (2026-11-01 player report): small upgrades were all sold, and the leveling guide's
// "Legendary Gloves" was handed out as an aspect to imprint. Real tooltips from that session.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { fastParse } from "../src/lib/fastparse";
import { decide } from "../src/lib/judge";
import { emptyProgress } from "../src/lib/store";
import type { BuildVariant, GearSlot } from "../src/lib/types";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));
const stat = (name: string) => ({ slug: name.toLowerCase().replace(/\s+/g, "-"), name, greater: false, masterwork: false });
const slot = (s: string, label: string, stats: string[]): GearSlot => ({
  slot: s, slotLabel: label, group: "gear", itemSlug: "", itemName: `Legendary ${label}`, kind: "aspect",
  affixes: stats.map(stat), tempers: [], sockets: [], implicits: [], extras: [],
});
const variant = (name: string) =>
  ({
    id: "0", name, description: "",
    gear: [
      slot("amulet", "Amulet", ["Strength", "Maximum Life", "Vulnerable Damage", "Critical Strike Damage", "All Damage"]),
      slot("pants", "Pants", ["Strength", "Maximum Life", "Fury Regeneration", "Armor", "All Resist"]),
      slot("gloves", "Gloves", ["Ranks to Whirlwind", "Physical Damage", "Strength", "Maximum Life", "All Damage", "Vulnerable Damage"]),
    ],
    skillOrder: [], skillRanks: {}, skillBar: [], summons: [], paragon: [], mercenary: {}, priority: [],
  }) as unknown as BuildVariant;
const judge = (file: string, v = variant("Leveling 1-70")) => {
  const item = fastParse(fixture(file).lines, false, v)!;
  return { item, r: decide(item, v, { prog: () => emptyProgress, className: "Barbarian" }, item.compare) };
};

describe("loot judge while leveling", () => {
  it("reads a Toughness change as the swap's, not as less armor or resist on yours", () => {
    const { item } = judge("leveling-amulet-toughness");
    expect(item.toughness).toBe(11);
    expect(item.compareRows?.find((r) => /all resist/i.test(r.label))?.yours).toBe(58);
  });

  it("wears a blue amulet that only adds Toughness and gives up nothing", () => {
    const { r } = judge("leveling-amulet-toughness");
    expect(r.verdict).toBe("WEAR");
    expect(r.action).toMatch(/a little better/);
  });

  it("still wears it for a build that isn't a leveling guide: nothing is given up", () => {
    expect(judge("leveling-amulet-toughness", variant("Endgame")).r.verdict).toBe("WEAR");
  });

  it("never asks to imprint the guide's placeholder \"Legendary Pants\"", () => {
    const { r } = judge("leveling-pants-empty-slot");
    expect(r.verdict).toBe("WEAR");
    expect(r.action).not.toMatch(/Legendary Pants/);
  });

  it("sells gloves that are a bit worse than yours", () => {
    expect(judge("leveling-gloves-worse").r.verdict).not.toBe("WEAR");
  });
});
