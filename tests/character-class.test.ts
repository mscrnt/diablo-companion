import { beforeEach, describe, expect, it } from "vitest";
import { judgeTarget, shownClass, activeProfile } from "../src/lib/profiles";
import { useBuilds } from "../src/lib/store";
import { hasGameData } from "./setup";
import { exampleBuild } from "./helpers";

// A Barbarian build imported onto a Necromancer made it the build the judge followed, and every Necromancer item
// was scrapped as "not your Barbarian" (2026-10-25 test session). The character's own class wins now.
describe.skipIf(!hasGameData)("the character's class", () => {
  beforeEach(async () => {
    const { build } = await exampleBuild();
    const barb = { ...structuredClone(build), id: "barb", name: "Whirlwind Barbarian", className: "Barbarian" };
    useBuilds.setState({ builds: { [build.id]: build, barb }, activeBuildId: "barb", activeVariantId: barb.variants[0].id, worn: {}, progress: {}, variantOf: {} });
  });

  it("comes from what the character wears, not the active build", () => {
    expect(shownClass(activeProfile())).toBe("");
    useBuilds.getState().setWorn("gloves", { name: "Deathgrip", rarity: "unique", itemType: "Gloves", slot: "gloves", itemPower: 800, affixes: [] });
    expect(shownClass(activeProfile())).toBe("Necromancer");
  });

  it("makes the judge follow one of the character's own builds", () => {
    useBuilds.getState().setWorn("gloves", { name: "Deathgrip", rarity: "unique", itemType: "Gloves", slot: "gloves", itemPower: 800, affixes: [] });
    const t = judgeTarget();
    expect(t.className).toBe("Necromancer");
    expect(t.build?.className).toBe("Necromancer");
    expect(t.mismatch).toBe(true);
  });
});
