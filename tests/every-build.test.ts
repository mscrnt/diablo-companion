// The loot judge checks every build of every character before anything is scrapped: the stash is
// shared by the whole account. Another build of this character: keep it in your bag; another
// character: stash it. Another class's own items only count for builds of that class.
import { beforeAll, describe, expect, it } from "vitest";
import { judgeEveryBuild, type OtherBuild } from "../src/lib/everyBuild";
import { decide, itemClasses } from "../src/lib/judge";
import { emptyProgress } from "../src/lib/store";
import type { BuildVariant, ParsedItem } from "../src/lib/types";
import { tablesForTests } from "./fixtures/tables";
import { exampleBuild } from "./helpers";

let ex: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => {
  await tablesForTests();
  ex = await exampleBuild();
});

const A = (text: string, match: string | null = null) => ({ text, match, greater: false, tempered: false, masterwork: false, enchanted: false });
/** The example build's unique scythe (a Necromancer unique), not owned yet */
const scream = (): ParsedItem =>
  ({ name: "Bloodless Scream", slot: "weapon", rarity: "unique", itemType: "Ancestral Unique Scythe", itemPower: 900, affixes: [A("+20% Weapon Damage"), A("+2 to Darkness Skills")], aspect: null }) as any;
const charm = (): ParsedItem =>
  ({ name: "Mlor of the Black Shroud", slot: "charm", rarity: "legendary", itemType: "Ancestral Set Charm", itemPower: 900, affixes: [A("+4 to Minion Skills")] }) as any;

/** The active build: one with no weapon or talisman of its own */
const bare = (): BuildVariant => ({ ...ex.variant, gear: ex.variant.gear.filter((g) => g.slot !== "weapon" && g.group !== "talisman") });
const other = (o: Partial<OtherBuild> & { className?: string }): OtherBuild => ({
  build: { ...ex.build, className: o.className ?? "Necromancer" },
  variant: ex.variant,
  prog: () => emptyProgress,
  sameCharacter: false,
  character: { name: "Bazaq", className: o.className ?? "Necromancer" },
  ...o,
});

describe("another build has a use for it", () => {
  it("another build of this character: keep it in your bag", () => {
    const scored = decide(scream(), bare(), { prog: ex.prog });
    expect(scored.verdict).toBe("SCRAP");
    const r = judgeEveryBuild(scream(), scored, [other({ sameCharacter: true })]);
    expect(r.verdict).toBe("KEEP");
    expect(r.action).toBe("Keep it: an upgrade for your Skeleton Warrior Army build.");
    expect(r.reasons[0]).toMatch(/^Skeleton Warrior Army, Weapon: Wear this!/);
  });

  it("another character: stash it, with their class and name", () => {
    const r = judgeEveryBuild(scream(), decide(scream(), bare(), { prog: ex.prog }), [other({})]);
    expect(r.verdict).toBe("STASH");
    expect(r.action).toBe("Stash it: great for your Necromancer (Bazaq).");
    // a name not read yet
    expect(judgeEveryBuild(scream(), decide(scream(), bare(), { prog: ex.prog }), [other({ character: { name: "", className: "Necromancer" } })]).action).toBe("Stash it: great for your Necromancer.");
  });

  it("charms too: another character's talisman uses it", () => {
    const scored = decide(charm(), bare(), { prog: ex.prog });
    expect(scored.action).toMatch(/^Stash it: it isn't part of your build's talisman/);
    expect(judgeEveryBuild(charm(), scored, [other({})]).action).toBe("Stash it: great for your Necromancer (Bazaq).");
  });

  it("the game's comparison is with this character's gear: another character's build judges it on its own", () => {
    const row = (label: string, mine: number, yours: number) => ({ label, mine, yours, unit: "%", wanted: true, match: label });
    const band = {
      ...scream(),
      name: "Shiny Band",
      slot: "ring",
      rarity: "legendary",
      itemType: "Ancestral Legendary Ring",
      affixes: [A("+6% Critical Strike Chance", "Critical Strike Chance"), A("+15% Vulnerable Damage Multiplier", "Vulnerable Damage Multiplier"), A("+20% Critical Strike Damage Multiplier", "Critical Strike Damage Multiplier"), A("+1,000 Maximum Life", "Maximum Life")],
      compareRows: [row("Critical Strike Chance", 6, 12), row("Vulnerable Damage Multiplier", 15, 40), row("Critical Strike Damage Multiplier", 20, 45), { ...row("Maximum Life", 1000, 3000), unit: "" }],
    } as ParsedItem;
    const scored = decide(band, ex.variant, { prog: ex.prog });
    expect(scored.verdict).toBe("SCRAP");
    // another build of this character wears the same rings
    expect(judgeEveryBuild(band, scored, [other({ sameCharacter: true })]).verdict).toBe("SCRAP");
    expect(judgeEveryBuild(band, scored, [other({})]).action).toBe("Stash it: great for your Necromancer (Bazaq).");
  });

  it("this character's builds come first when two builds want it", () => {
    const r = judgeEveryBuild(scream(), decide(scream(), bare(), { prog: ex.prog }), [other({}), other({ sameCharacter: true })]);
    expect(r.verdict).toBe("KEEP");
  });
});

describe("only scrapped when no build of any character can use it", () => {
  it("no other build wants it: the active verdict stands", () => {
    const scored = decide(scream(), bare(), { prog: ex.prog });
    expect(judgeEveryBuild(scream(), scored, [other({ variant: bare() })])).toEqual(scored);
    expect(judgeEveryBuild(scream(), scored, [])).toEqual(scored);
  });

  it("what the active build wears or uses is never handed to another build", () => {
    const wear = decide(scream(), ex.variant, { prog: ex.prog });
    expect(wear.verdict).toBe("WEAR");
    expect(judgeEveryBuild(scream(), wear, [other({ sameCharacter: true })])).toEqual(wear);
    const worn = { ...scream(), equipped: true };
    const scrap = decide(worn, bare(), { prog: ex.prog });
    expect(judgeEveryBuild(worn, scrap, [other({})])).toEqual(scrap);
  });
});

describe("class-restricted items", () => {
  it("knows whose items are whose: a class's unique, an aspect several classes share, a unique for everyone", () => {
    expect(itemClasses(scream())).toEqual(["necromancer"]);
    expect(itemClasses({ ...scream(), name: "Tal Rasha's Iridescent Loop", slot: "ring" })).toEqual(["sorcerer"]);
    expect(itemClasses({ ...scream(), name: "Harlequin Crest", slot: "helm" })).toBeNull();
    const ring = { ...scream(), name: "Band of Hellbent Commander", rarity: "legendary", aspect: { name: "Hellbent Commander Aspect", text: "" } } as ParsedItem;
    expect(itemClasses(ring)).toEqual(expect.arrayContaining(["necromancer", "sorcerer"]));
    expect(itemClasses({ ...ring, rawText: "Sorcerer Only" })).toEqual(["sorcerer"]);
  });

  it("a Necromancer unique is no use to a Sorcerer build, here or on another character", () => {
    const sorc = decide(scream(), ex.variant, { prog: ex.prog, className: "Sorcerer" });
    expect(sorc.verdict).toBe("SCRAP");
    expect(sorc.reasons).toContain("It's for a Necromancer, not your Sorcerer.");
    const scored = decide(scream(), bare(), { prog: ex.prog });
    expect(judgeEveryBuild(scream(), scored, [other({ className: "Sorcerer" })]).verdict).toBe("SCRAP");
    expect(decide(scream(), ex.variant, { prog: ex.prog, className: "Necromancer" }).verdict).toBe("WEAR");
  });
});
