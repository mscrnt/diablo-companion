import { beforeAll, describe, expect, it } from "vitest";
import { parseBuildUrl } from "../src/lib/mobalytics";
import { matchTarget, buildTargetNames } from "../src/lib/parse";
import { exampleBuild } from "./helpers";

describe("parseBuildUrl", () => {
  it("featured guide with a variant", () => {
    expect(parseBuildUrl("https://mobalytics.gg/diablo-4/builds/necromancer-mages-necro-guide?ws-ngf5-1=activeVariantId%2C1")).toEqual({
      slug: "necromancer-mages-necro-guide",
      variant: "1",
      kind: "builds",
    });
  });
  it("profile build", () => {
    expect(parseBuildUrl("https://mobalytics.gg/diablo-4/profile/fervorgaming/builds/my-build")).toEqual({ slug: "my-build", kind: "profile", author: "fervorgaming" });
  });
  it("bare slug", () => {
    expect(parseBuildUrl("necromancer-mages-necro-guide")).toEqual({ slug: "necromancer-mages-necro-guide", kind: "builds" });
  });
});

describe("normaliseMobalytics (bundled example build)", () => {
  let ctx: Awaited<ReturnType<typeof exampleBuild>>;
  beforeAll(async () => void (ctx = await exampleBuild()));

  it("reads the build header and both variants", () => {
    expect(ctx.build.name).toBe("Skeletal Warrior Minions");
    expect(ctx.build.className).toBe("Necromancer");
    expect(ctx.build.variants.map((v) => v.name)).toEqual(["Early Game Army", "End Game Warriors"]);
  });

  it("maps every gear slot with affixes, greater and masterwork targets", () => {
    const gear = Object.fromEntries(ctx.variant.gear.map((g) => [g.slotLabel, g]));
    expect(gear["Helm"].itemName).toBe("The Undercrown");
    expect(gear["Helm"].kind).toBe("unique");
    const ranks = gear["Helm"].affixes.find((a) => a.name === "Ranks to Minion Skills")!;
    expect(ranks.greater).toBe(true);
    expect(ranks.masterwork).toBe(true);
    expect(gear["Boots"].itemName).toBe("Aspect of Hewed Flesh");
    expect(gear["Ring 2"].itemName).toBe("Pact of Bone");
    expect(gear["Weapon"].itemName).toBe("Bloodless Scream");
    expect(ctx.variant.gear.filter((g) => g.kind === "charm")).toHaveLength(6);
  });

  it("reads the skill bar and paragon", () => {
    expect(ctx.variant.skillBar.map((s) => s.name)).toEqual(["Army of the Dead", "Skeleton Warrior", "Skeleton Mage", "Blight", "Sever", "Golem"]);
    expect(ctx.variant.skillRanks["skeleton-warrior"]).toBe(15);
    expect(ctx.variant.paragon.length).toBeGreaterThanOrEqual(5);
  });

  it("matches OCR'd affix lines to build stats", () => {
    const targets = buildTargetNames(ctx.variant);
    expect(matchTarget("+143 Intelligence", targets)).toBe("Intelligence");
    expect(matchTarget("+9.0% Critical Strike Chance", targets)).toBe("Critical Strike Chance");
    expect(matchTarget("+20% Resistance to All Elements", targets)).toBe("Resistance to All Elements");
    // a single resistance is not "all elements"
    expect(matchTarget("+5% Fire Resistance", targets)).toBeNull();
  });
});
