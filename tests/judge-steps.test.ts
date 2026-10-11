import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import type { ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

const A = (text: string, match: string | null = null, o: { greater?: boolean; tempered?: boolean; enchanted?: boolean } = {}) => ({
  text, match, greater: !!o.greater, tempered: !!o.tempered, masterwork: false, enchanted: !!o.enchanted,
});
const worn = (name: string, slot: string, affixes: ReturnType<typeof A>[], aspect: string | null = null): ParsedItem =>
  ({ name, slot, rarity: "legendary", itemType: `Legendary ${slot}`, itemPower: 900, affixes, aspect: aspect ? { name: aspect, text: "" } : null, equipped: true }) as any;

describe("Occultist steps say exactly what to change", () => {
  it("an imprint names the aspect it replaces", () => {
    const r = decide(worn("Ring of Rot", "ring", [A("+100 Intelligence", "Intelligence")], "Aspect of Disobedience"), ctx.variant, { prog: ctx.prog });
    expect(r.steps?.join(" | ")).toMatch(/Imprint "Hellbent Commander Aspect" onto it \(it replaces Aspect of Disobedience\)/);
  });

  it("enchants away the stat worth least to the build, never the base stat or a ★", () => {
    const r = decide(
      worn("Ring of Rot", "ring", [
        A("216 All Resist"), A("+136 Intelligence", "Intelligence"), A("+2,900 Maximum Life", "Maximum Life"),
        A("x28% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+4,200 Physical Resistance"), A("+2,625 Fire Resistance", null, { greater: true }),
      ], "Hellbent Commander Aspect"),
      ctx.variant, { prog: ctx.prog },
    );
    expect(r.steps?.join(" | ")).toMatch(/change "\+4,200 Physical Resistance" into Crit Chance/);
  });

  it("never re-rolls a misread line into the stat it already is", () => {
    const r = decide(
      worn("Ring of Rot", "ring", [A("x26% Critical St e Ramäge Multiplier", null, { enchanted: true }), A("+8% Critical Strike Chance", "Critical Strike Chance")], "Hellbent Commander Aspect"),
      ctx.variant, { prog: ctx.prog },
    );
    expect(r.steps?.join(" | ")).not.toMatch(/re-roll the enchanted "x26% Critical St e Ramäge Multiplier" into Crit Damage/);
  });
});
