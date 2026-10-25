import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import { buildProfile, statKey, statWeight } from "../src/lib/statvalue";
import type { ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

const A = (text: string, match: string | null = null, greater = false) => ({ text, match, greater, tempered: false, masterwork: false, enchanted: false });
const chest = (name: string, affixes: ReturnType<typeof A>[], ip = 900): ParsedItem =>
  ({ name, rarity: "legendary", itemType: "Ancestral Legendary Chest Armor", slot: "chest", itemPower: ip, affixes, aspect: null }) as any;

describe("build-aware stat value (Skeletal Warrior minion necro)", () => {
  it("reads stat names off tooltip lines", () => {
    expect(statKey("+4 to Minion Skills")).toBe("ranks to minion skills");
    expect(statKey("+1,304 Maximum Life (+1,155)")).toBe("maximum life");
    expect(statKey("x26.5% Shadow Damage Multiplier [20 - 30]%")).toBe("shadow damage");
  });

  it("weighs stats by what they do for this build", () => {
    const prof = buildProfile(ctx.variant);
    const gloves = ctx.variant.gear.find((g) => g.slot === "gloves")!;
    const w = (t: string) => statWeight(statKey(t), gloves, prof);
    expect(prof.mainStat).toBe("intelligence");
    expect(w("x12% Critical Strike Damage Multiplier")).toBeGreaterThanOrEqual(1); // wanted on the gloves
    expect(w("+3 to Minion Skills")).toBe(0.6); // wanted elsewhere: still good
    expect(w("+2 to Curse Skills")).toBeLessThan(0.1); // not this build's skills
    expect(w("+20% Fire Damage")).toBeLessThan(0.1); // wrong element
    expect(w("+1,000 Maximum Life")).toBeGreaterThan(w("+2,000 Cold Resistance"));
  });

  it("an item with bigger rolls of the build's stats beats yours, even off the guide's list", () => {
    const yours = chest("Old Chestplate", [A("+90 Intelligence", "Intelligence"), A("+1,000 Maximum Life", "Maximum Life"), A("+2,000 Cold Resistance"), A("+1 to Curse Skills")]);
    const loot = chest("New Chestplate", [A("+125 Intelligence", "Intelligence"), A("+1,600 Maximum Life", "Maximum Life"), A("+4 to Minion Skills"), A("+5.5% Critical Strike Chance")]);
    const r = decide(loot, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "chest-armor" ? yours : undefined) }, null);
    expect(r.verdict).toBe("WEAR");
    expect(r.reasons[0]).toMatch(/better than yours/);
  });

  it("smaller rolls of the same stats lose", () => {
    const yours = chest("Old Chestplate", [A("+125 Intelligence", "Intelligence"), A("+1,600 Maximum Life", "Maximum Life"), A("+458 Resistance to All Elements", "Resistance to All Elements")]);
    const loot = chest("New Chestplate", [A("+95 Intelligence", "Intelligence"), A("+1,100 Maximum Life", "Maximum Life"), A("+300 Resistance to All Elements", "Resistance to All Elements")]);
    const r = decide(loot, ctx.variant, { prog: ctx.prog, worn: (s) => (s === "chest-armor" ? yours : undefined) }, null);
    expect(r.verdict).not.toBe("WEAR");
    expect(r.reasons.join(" | ")).toMatch(/Intelligence 95 vs yours 125/);
  });
});
