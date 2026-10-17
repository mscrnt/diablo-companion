// Two ring slots, one comparison: the game compares a ring with ONE of yours. A ring you replaced
// stayed remembered in Ring 1 and produced a wrong "wear this" (2026-10 report): what the game shows
// goes into the right slot, and the game's piece wins over a memory that may be out of date.
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { recordEquipped, slotForItem } from "../src/lib/gearTrack";
import { comparedIsWorn, decide } from "../src/lib/judge";
import { emptyTalisman, useBuilds } from "../src/lib/store";
import type { ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

let ex: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ex = await exampleBuild()));

const A = (text: string, match: string | null = null) => ({ text, match, greater: false, tempered: false, masterwork: false, enchanted: false });
const ring = (name: string, affixes: ReturnType<typeof A>[], extra: Partial<ParsedItem> = {}): ParsedItem =>
  ({ name, slot: "ring", rarity: "legendary", itemType: "Ancestral Legendary Ring", itemPower: 900, affixes, aspect: null, ...extra }) as any;

const pact = () => ring("Pact of Bone", [A("+144 Intelligence", "Intelligence"), A("+26% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+7.5% Critical Strike Chance", "Critical Strike Chance")], { rarity: "unique" });
/** the ring you took off: weak */
const oldBand = () => ring("Old Band", [A("+2% Critical Strike Chance", "Critical Strike Chance"), A("+300 Maximum Life", "Maximum Life"), A("+40 Armor")]);
/** the ring you wear in Ring 1 now: strong */
const newBand = () =>
  ring("Ring of the Starry Night", [A("+9% Critical Strike Chance", "Critical Strike Chance"), A("+25% Vulnerable Damage Multiplier", "Vulnerable Damage Multiplier"), A("+30% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+1,500 Maximum Life", "Maximum Life")]);
/** loot: better than the old ring, worse than the new one; the game compares it with your unique */
const loot = () =>
  ring("Shiny Band", [A("+6% Critical Strike Chance", "Critical Strike Chance"), A("+15% Vulnerable Damage Multiplier", "Vulnerable Damage Multiplier"), A("+20% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+1,000 Maximum Life", "Maximum Life")], { compareKind: "unique" });

const days = (n: number) => Date.now() - n * 86_400_000;

describe("judging a ring against yours", () => {
  it("the ring the game doesn't show still counts while it's sure (seen this session)", () => {
    const worn = (s: string) => (s === "ring-1" ? { ...oldBand(), at: Date.now() } : s === "ring-2" ? { ...pact(), at: Date.now() } : undefined);
    const r = decide(loot(), ex.variant, { prog: ex.prog, worn }, pact());
    expect(r.verdict).toBe("WEAR");
    expect(r.slot).toBe("ring-1");
  });

  it("a Ring 1 memory from days ago doesn't beat the game's comparison: no wrong WEAR", () => {
    const worn = (s: string) => (s === "ring-1" ? { ...oldBand(), at: days(2) } : s === "ring-2" ? { ...pact(), at: Date.now() } : undefined);
    const r = decide(loot(), ex.variant, { prog: ex.prog, worn }, pact());
    expect(r.verdict).not.toBe("WEAR");
    expect(r.slot).toBe("ring-2");
  });

  it("a memory in doubt only counts when the game shows that piece", () => {
    const worn = (s: string) => (s === "ring-1" ? { ...oldBand(), at: Date.now(), doubt: true } : s === "ring-2" ? { ...pact(), at: Date.now() } : undefined);
    expect(decide(loot(), ex.variant, { prog: ex.prog, worn }, pact()).verdict).not.toBe("WEAR");
    const shown = decide({ ...loot(), compareKind: "legendary" }, ex.variant, { prog: ex.prog, worn }, oldBand());
    expect(shown.verdict).toBe("WEAR");
    expect(shown.slot).toBe("ring-1");
  });

  it("the game shows a ring you don't remember: it stands in for both slots", () => {
    const worn = (s: string) => (s === "ring-1" ? { ...oldBand(), at: Date.now() } : s === "ring-2" ? { ...pact(), at: Date.now() } : undefined);
    const r = decide({ ...loot(), compareKind: undefined }, ex.variant, { prog: ex.prog, worn }, newBand());
    expect(r.verdict).not.toBe("WEAR");
    expect(r.reasons.join(" | ")).toMatch(/than yours \(Ring of the Starry Night\)/);
  });

  it("which slot the game compares with, from its numbers (no EQUIPPED column)", () => {
    // what the comparison gives back for yours: the Pact of Bone's values
    const rows = [
      { label: "Intelligence", mine: 100, yours: 144, unit: "", wanted: true, match: "Intelligence" },
      { label: "Critical Strike Damage Multiplier", mine: 20, yours: 26, unit: "%", wanted: true, match: "Critical Strike Damage Multiplier" },
    ];
    expect(comparedIsWorn(null, rows, pact())).toBe(true);
    expect(comparedIsWorn(null, rows, newBand())).toBe(false);
    expect(comparedIsWorn(null, rows, undefined)).toBeNull();
    // named: the EQUIPPED column, even with a garbled title
    expect(comparedIsWorn(pact(), undefined, pact())).toBe(true);
    expect(comparedIsWorn({ ...newBand(), name: "Rlng of the Starrv Nlght" }, undefined, newBand())).toBe(true);
    expect(comparedIsWorn(newBand(), undefined, oldBand())).toBe(false);
  });
});

describe("remembering which ring is where", () => {
  const result = (it: ParsedItem) => ({ ...decide(it, ex.variant, { prog: ex.prog }), id: "", at: 0, ms: 0 });
  beforeEach(() => {
    useBuilds.setState({ builds: { [ex.build.id]: ex.build }, activeBuildId: ex.build.id, activeVariantId: ex.variant.id, progress: {}, variantOf: {}, worn: {}, talisman: emptyTalisman });
  });

  it("a ring you were seen wearing stays in its slot (it used to always go to Ring 1)", () => {
    const plain = ring("Plain Band", [A("+5% Critical Strike Chance", "Critical Strike Chance"), A("+800 Maximum Life", "Maximum Life"), A("+50 Armor")]);
    useBuilds.getState().setWorn("ring-1", newBand());
    useBuilds.getState().setWorn("ring-2", plain);
    recordEquipped(result(plain), plain);
    expect(useBuilds.getState().worn["ring-1"].name).toBe("Ring of the Starry Night");
    expect(useBuilds.getState().worn["ring-2"].name).toBe("Plain Band");
  });

  it("a new ring takes a free slot first, else replaces the oldest memory and puts the other in doubt", () => {
    useBuilds.getState().setWorn("ring-2", pact());
    const gear = ex.variant.gear.filter((g) => g.group === "gear");
    expect(slotForItem(oldBand(), gear, undefined, useBuilds.getState().worn)?.slot).toBe("ring-1");
    useBuilds.setState((s) => ({ worn: { ...s.worn, "ring-1": { ...oldBand(), at: days(3) } } }));
    recordEquipped(result(newBand()), newBand());
    const w = useBuilds.getState().worn;
    expect(w["ring-1"].name).toBe("Ring of the Starry Night");
    expect(w["ring-2"].doubt).toBe(true);
    // the game shows your Pact of Bone again: it's sure again
    recordEquipped(result(pact()), pact());
    expect(useBuilds.getState().worn["ring-2"].doubt).toBeUndefined();
    expect(useBuilds.getState().worn["ring-1"].name).toBe("Ring of the Starry Night");
  });

  it("a seal or charm you wear goes to the talisman memory, never a gear slot", () => {
    const seal = { name: "Seal of the Diamond Mind", slot: "seal", rarity: "mythic", itemType: "Mythic Horadric Seal", itemPower: 900, affixes: [A("Unlocks 6 Charm Slots")], equipped: true } as any;
    expect(recordEquipped(result(seal), seal)).toBeNull();
    expect(useBuilds.getState().talisman.seal?.name).toBe("Seal of the Diamond Mind");
    expect(useBuilds.getState().worn).toEqual({});
  });

  it("a ring put where the memory was in doubt doesn't put the other one in doubt", () => {
    useBuilds.getState().setWorn("ring-2", pact());
    useBuilds.setState((s) => ({ worn: { ...s.worn, "ring-1": { ...oldBand(), at: Date.now(), doubt: true } } }));
    recordEquipped(result(newBand()), newBand());
    expect(useBuilds.getState().worn["ring-1"].name).toBe("Ring of the Starry Night");
    expect(useBuilds.getState().worn["ring-2"].doubt).toBeUndefined();
  });
});
