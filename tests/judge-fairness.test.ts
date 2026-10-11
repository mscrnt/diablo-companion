import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import type { ParsedItem, SlotProgress } from "../src/lib/types";
import { emptyProgress } from "../src/lib/store";
import { exampleBuild } from "./helpers";

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

const A = (text: string, match: string | null = null, o: { greater?: boolean; tempered?: boolean; masterwork?: boolean } = {}) => ({
  text, match, greater: !!o.greater, tempered: !!o.tempered, masterwork: !!o.masterwork, enchanted: false,
});
const item = (name: string, slot: string, rarity: string, affixes: ReturnType<typeof A>[], extra: Partial<ParsedItem> = {}): ParsedItem =>
  ({ name, slot, rarity, itemType: `Ancestral ${rarity} ${slot}`, itemPower: 900, affixes, aspect: null, ...extra }) as any;

describe("rings: both of your rings are considered", () => {
  it("a legendary ring is weighed against Ring 1 even when the game compares it with your unique Ring 2", () => {
    const pact = item("Pact of Bone", "ring", "unique", [A("+90 Intelligence", "Intelligence"), A("+30% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier")]);
    const ring1 = item("Old Ring of Hellbent Commander", "ring", "legendary", [A("+3% Critical Strike Chance", "Critical Strike Chance"), A("+500 Maximum Life", "Maximum Life")]);
    const loot = item("Shiny Band", "ring", "legendary", [
      A("+8% Critical Strike Chance", "Critical Strike Chance"), A("+20% Vulnerable Damage Multiplier", "Vulnerable Damage Multiplier"),
      A("+25% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+1,200 Maximum Life", "Maximum Life"),
    ], { compareKind: "unique" });
    const worn = (s: string) => (s === "ring-2" ? pact : s === "ring-1" ? ring1 : undefined);
    const r = decide(loot, ctx.variant, { prog: ctx.prog, worn }, pact);
    expect(r.verdict).toBe("WEAR");
    expect(r.slot).toBe("ring-1");
  });
});

describe("rings: a named comparison stays with its slot", () => {
  it("the EQUIPPED column showing Pact of Bone is only compared with Ring 2", () => {
    const pact = item("Pact of Bone", "ring", "unique", [A("+144 Intelligence", "Intelligence"), A("+26% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier")]);
    const ring1 = item("Hellbent Band", "ring", "legendary", [A("+136 Intelligence", "Intelligence"), A("+2,900 Maximum Life", "Maximum Life"), A("+28% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier")]);
    const loot = item("Ring of the Sacrilegious Soul", "ring", "unique", [A("+105 Intelligence", "Intelligence"), A("+12.6% Resource Generation")]);
    const worn = (s: string) => (s === "ring-2" ? pact : s === "ring-1" ? ring1 : undefined);
    const r = decide(loot, ctx.variant, { prog: ctx.prog, worn }, pact);
    expect(r.verdict).toBe("SCRAP");
    expect(r.reasons.join(" | ")).not.toMatch(/better than yours/);
  });
});

describe("keeping rare items for other builds", () => {
  const junk = (ga: number, rarity = "legendary") =>
    item("Odd Gloves", "gloves", rarity, [A("+5% Fire Damage", null, { greater: ga > 0 }), A("+4% Attack Speed", null, { greater: ga > 1 }), A("+200 Dexterity", null, { greater: ga > 2 }), A("+3 to Curse Skills", null, { greater: ga > 3 })]);
  it("saves a 3★+ item for later instead of scrapping it", () => {
    const r = decide(junk(4), ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Save it for later: 4★ greater affixes/);
  });
  it("saves a 2★ unique, and a 2★ legendary only when both ★ are on stats the class uses", () => {
    expect(decide(junk(2, "unique"), ctx.variant, { prog: ctx.prog }).verdict).toBe("STASH");
    expect(decide(junk(2), ctx.variant, { prog: ctx.prog }).verdict).toBe("SCRAP"); // ★ on Fire Damage: not a necro stat
    const good = item("Fine Gloves", "gloves", "legendary", [A("+120 Intelligence", "Intelligence", { greater: true }), A("+6% Attack Speed", null, { greater: true }), A("+5% Fire Damage")]);
    expect(decide(good, ctx.variant, { prog: ctx.prog }).action).toMatch(/2★ greater affixes on stats your class uses/);
  });
  it("still scraps an ordinary item", () => {
    expect(decide(junk(1), ctx.variant, { prog: ctx.prog }).verdict).toBe("SCRAP");
    expect(decide(junk(0, "unique"), ctx.variant, { prog: ctx.prog }).verdict).toBe("SCRAP");
  });
});

describe("comparing with gear you've already upgraded", () => {
  it("doesn't hold your masterwork and temper against an untouched drop", () => {
    // yours: masterworked +12, tempered Max Resolve Stacks; raw numbers ~45% higher than its base roll
    const yours = item("Old Chest", "chest", "legendary", [
      A("+145 Intelligence", "Intelligence"), A("+2,320 Maximum Life", "Maximum Life", { masterwork: true }), A("+650 Resistance to All Elements", "Resistance to All Elements"),
      A("+3 Maximum Resolve Stacks", "Maximum Resolve Stacks", { tempered: true }),
    ]);
    const loot = item("New Chest", "chest", "legendary", [A("+120 Intelligence", "Intelligence"), A("+1,700 Maximum Life", "Maximum Life"), A("+520 Resistance to All Elements", "Resistance to All Elements"), A("+1,800 Armor", "Armor")], { tempersUsed: 0 });
    const prog = (s: string): SlotProgress => (s === "chest-armor" ? { ...emptyProgress, masterwork: 12, tempered: true } : emptyProgress);
    const r = decide(loot, ctx.variant, { prog, worn: (s) => (s === "chest-armor" ? yours : undefined) }, null);
    expect(r.verdict).toBe("WEAR");
    expect(r.reasons.join(" | ")).toMatch(/masterworked \+12 and tempered/);
    expect(r.reasons.join(" | ")).not.toMatch(/Max Resolve Stacks/); // it can be tempered the same way
  });
});
