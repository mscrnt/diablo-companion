// Naming a unique from several signals (title, unique power, the stats it always rolls, optionally the icon),
// so one bad read doesn't decide: measured on 57 real test-mode items (2026-10-12), title + power + stats
// named 96% right with no confident mistakes, and 91% with the title removed.
import { beforeAll, describe, expect, it } from "vitest";
import { confident, identifyUnique } from "../src/lib/identify";
import { loadStaticData } from "../src/lib/names";

beforeAll(() => loadStaticData());

const deathgripPower = "Your maximum number of Skeleton Warriors is increased by 2. Skeleton Warriors cleave with their attacks and deal 120% increased damage.";
const name = (r: ReturnType<typeof identifyUnique>) => confident(r)?.name ?? null;

describe("identifying a unique", () => {
  it("a title merged with the comparison column's item still names it", () => {
    const r = identifyUnique({ title: "DEATHGRIP F o c USED STRIDER'S", itemType: "Ancestral Unique Gloves", power: deathgripPower, stats: ["+225 Intelligence", "+4 to Skeleton Warrior"] });
    expect(name(r)).toBe("Deathgrip");
  });

  it("no title at all: the power and stats are enough", () => {
    const r = identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: deathgripPower, stats: [] });
    expect(name(r)).toBe("Deathgrip");
  });

  it("the item type rules out the copy for another weapon type", () => {
    const r = identifyUnique({ title: "IN.?INIT.Y", itemType: "Ancestral Mythic Unique Two-Handed Mace", power: "", stats: [] });
    expect(r[0].name).toBe("Infinity (2h Mace)");
  });

  it("two uniques sharing one icon are told apart by their power", () => {
    // Deathgrip and Endurant Faith use the same picture for a Necromancer: the icon ties, the text decides
    const icon = { Deathgrip: 0.91, "Endurant Faith": 0.91 };
    const r = identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: deathgripPower, stats: [], icon });
    expect(name(r)).toBe("Deathgrip");
  });

  it("nothing to go on: no confident answer", () => {
    expect(name(identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: "", stats: [] }))).toBeNull();
  });
});
