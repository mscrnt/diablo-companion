import { beforeAll, describe, expect, it } from "vitest";
import { chestAdvice, findChests, findOffers, looksLikeHordes, offerPhase, parseAether, trackerAether, trackerWave } from "../src/lib/hordes";
import { findWhisperCaches, parseGrimFavors } from "../src/lib/whispers";
import { helltideAdvice, parseHelltideHud } from "../src/lib/helltide";
import { bossInfo, findBoss } from "../src/lib/boss";
import { needs, nodes, parseWarPlan, planTree, trees } from "../src/lib/warplans";
import { planFarm, bossRoute } from "../src/lib/farm";
import { exampleBuild, line } from "./helpers";

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

describe("Infernal Hordes", () => {
  // OCR-ish text with typos, three offers side by side
  const offers = [
    line("The Wrath of HeIl", 400, 300), line("Hellfire intensifies", 400, 330), line("At the end of each wave spawn 15-24 additional Aether", 400, 360),
    line("The Stalking DeviI", 1200, 300), line("A demon of great power has your scent", 1200, 330),
    line("The Aether Goblins", 2000, 300), line("Monsters now have greatly increased health", 2000, 330),
  ];

  it("recognises offers despite OCR typos and ranks them", () => {
    const r = findOffers(offers, { x: 0, y: 0 }, "balanced");
    expect(r.map((o) => o.title)).toEqual(["The Wrath of Hell", "The Stalking Devil", "The Aether Goblins"]);
    expect(r[0].rank).toBe(1);
  });

  it("safe playstyle ranks the dangerous offer lower", () => {
    const balanced = findOffers(offers, { x: 0, y: 0 }, "balanced").findIndex((o) => o.title === "The Stalking Devil");
    const safe = findOffers(offers, { x: 0, y: 0 }, "safe").findIndex((o) => o.title === "The Stalking Devil");
    expect(safe).toBeGreaterThan(balanced);
  });

  it("reads spoils chests and spends aether on what the build needs", () => {
    expect(findChests([line("Spoils of Greater Equipment"), line("Spoils of Talismans", 500), line("Spoils of Gold", 900)], { x: 0, y: 0 }).map((c) => c.name)).toEqual([
      "Spoils of Greater Equipment",
      "Spoils of Talismans",
      "Spoils of Gold",
    ]);
    const a = chestAdvice(ctx.variant, ctx.prog, 1250);
    expect(a.order[0]).toBe("Spoils of Talismans");
    expect(a.order.at(-1)).toBe("Spoils of Gold");
  });

  it("takes offers only from title lines, not description fragments or boss names", () => {
    // modelled on a real wave 6 offer screen (OCR slips kept)
    const r = findOffers(
      [line("Aether Goblins", 400, 300), line("The Enduring Lords", 1200, 300), line("The Exalted Fiends", 2000, 300), line("The Wrath 0fHell", 2800, 300), line("THE FELL COUNCIL", 100, 100)],
      { x: 0, y: 0 },
      "balanced",
    );
    expect(r.map((o) => o.title).sort()).toEqual(["The Enduring Lords", "The Exalted Fiends", "The Wrath of Hell"]);
    expect(r[0].title).toBe("The Wrath of Hell");
  });

  it("reads the offer phase, wave and Aether count from the tracker", () => {
    expect(offerPhase("Select an Infemal Offer •")).toBe("selecting");
    expect(offerPhase("YOU'VE CHOSEN THE WRATH OF HELL")).toBe("chosen");
    expect(offerPhase("BEGIN WAVE 7")).toBe("chosen");
    expect(offerPhase("Slay monsters to draw out Aether")).toBeNull();
    expect(trackerWave("MWAVE: 6/10")).toBe(6);
    expect(trackerAether([line("WAVE: 7/10"), line("Xo:53"), line("453")])).toBe(453);
    // "+2 Aether" in an offer description is not the count
    expect(parseAether("Aether Fiends grant +2 Aether")).toBeNull();
  });

  it("parses the tracker", () => {
    expect(looksLikeHordes("Infernal Hordes Wave 3/10 Burning Aether 245")).toBe(true);
    expect(looksLikeHordes("Helltide 12:00")).toBe(false);
    // OCR slips seen in a real run
    expect(looksLikeHordes("The Infemal Hordes in Buming Hells")).toBe(true);
    expect(looksLikeHordes("WAVE: 10/10")).toBe(true);
    expect(looksLikeHordes("lnfernal Hordes")).toBe(true);
    expect(parseAether("Burning Aether 245")).toBe(245);
    expect(parseAether("245 Aether")).toBe(245);
  });
});

describe("Tree of Whispers", () => {
  it("ranks caches for missing slots above chaos", () => {
    const W = (t: string, y: number) => line(t, 100, y, 400);
    const r = findWhisperCaches([W("COLLECTION OF HELMS", 0), W("COLLECTION OF CHAOS", 60), W("COLLECTION OF RINGS", 120), W("COLLECTION OF CHESTPLATES", 180)], { x: 0, y: 0 }, ctx.variant, ctx.prog);
    expect(r).toHaveLength(4);
    expect(r[0].name).toBe("Collection of Helms");
    expect(r.at(-1)!.name).toBe("Collection of Chaos");
  });

  it("knows a two-handed unique from its type, not its name", () => {
    // Bloodless Scream is a 2h Scythe: a one-handed weapon cache is no use to this build
    const W = (t: string, y: number) => line(t, 100, y, 400);
    const r = findWhisperCaches([W("COLLECTION OF ONE-HANDED WEAPONS", 0), W("COLLECTION OF RINGS", 60), W("COLLECTION OF CHAOS", 120)], { x: 0, y: 0 }, ctx.variant, ctx.prog);
    expect(r[0].name).toBe("Collection of Rings");
    expect(r.find((c) => /one-handed/i.test(c.name))?.why).toMatch(/two-handed/);
  });

  it("parses Grim Favors", () => {
    expect(parseGrimFavors("Grim Favors 7/10")).toEqual({ have: 7, max: 10 });
    expect(parseGrimFavors("nothing here")).toBeNull();
  });
});

describe("Helltide", () => {
  it("reads cinders and the timer from the HUD", () => {
    expect(parseHelltideHud([line("Helltide", 100, 100), line("12:34", 100, 130), line("216", 100, 208)])).toEqual({ cinders: 216, secondsLeft: 754 });
    expect(parseHelltideHud([line("Helltide: 51:37", 100, 100)])?.secondsLeft).toBe(3097);
  });

  it("reads the label the way OCR really sees it in a Helltide", () => {
    // from a real Helltide (Spider Forest): Windows OCR gives "Helitide: 01:16" and "e//tide."
    expect(parseHelltideHud([line("Helitide: 01:16", 1057, 36), line("24", 1051, 160), line("97", 1161, 178)])).toMatchObject({ cinders: 24 });
    expect(parseHelltideHud([line("e//tide.", 1057, 36)])).not.toBeNull();
    expect(parseHelltideHud([line("Helitide:", 1070, 40)])).not.toBeNull();
  });

  it("isn't fooled by other text with the word in it", () => {
    // seen in the Undercity: a ground label "Helltide Harv…" started a Helltide
    expect(parseHelltideHud([line("FLOOR", 100, 20), line("4/3", 100, 50), line("Helltide Harv", 500, 347)])).toBeNull();
    expect(parseHelltideHud([line("Helltide Kehjistan ends 24m", 100, 100)])).toBeNull();
  });

  it("spends cinders on the slot the build is missing", () => {
    const a = helltideAdvice(ctx.variant, ctx.prog, 400);
    expect(a.best?.name).toBe("Tortured Gift of Helms");
    expect(a.plan[0]).toMatch(/Helms ×5/);
  });
});

describe("boss helper", () => {
  it("finds bosses from health-bar text", () => {
    expect(findBoss([line("GRIGOIRE, THE GALVANIC SAINT")])).toBe("Grigoire, the Galvanic Saint");
    expect(findBoss([line("Duriel, King of Maggots")])).toBe("Duriel, King of Maggots");
    expect(findBoss([line("BOSS TRAINING DUMMY")])).toBeNull();
  });

  it("lists the build items the boss drops", () => {
    const info = bossInfo("Grigoire, the Galvanic Saint", ctx.variant, ctx.prog);
    expect(info.wanted.map((w) => w.item)).toContain("Deathgrip");
    expect(info.summon).toEqual(["Lair Key x1"]);
  });
});

describe("farm planner", () => {
  it("routes missing uniques to the bosses that drop them", () => {
    const route = bossRoute(planFarm(ctx.variant, ctx.prog));
    const byBoss = Object.fromEntries(route.map((r) => [r.boss, r.items.map((i) => i.item)]));
    expect(byBoss["Belial"]).toEqual(expect.arrayContaining(["Deathgrip", "Pact of Bone", "The Undercrown"]));
    expect(byBoss["Astaroth"]).toEqual(expect.arrayContaining(["Blood Moon Breeches", "Bloodless Scream"]));
  });
});

describe("War Plans", () => {
  it("has seven trees of seven points", () => {
    expect(trees()).toHaveLength(7);
    expect(trees().every((t) => t.max === 7)).toBe(true);
  });

  it("plans a legal path in every tree", () => {
    const need = needs(ctx.variant, ctx.prog, 150);
    for (const t of trees()) {
      const plan = planTree(t.slug, need, new Set(), 7);
      expect(plan.length).toBeLessThanOrEqual(7);
      const taken = new Set<string>([t.slug]);
      const all = nodes(t.slug);
      for (const step of plan) {
        const deps = all.find((n) => n.slug === step.node.slug)!.depends;
        // every pick is unlocked by the root or an earlier pick
        expect(deps.length === 0 || deps.some((d) => taken.has(d)), `${t.slug}: ${step.node.slug}`).toBe(true);
        taken.add(step.node.slug);
      }
    }
  });

  it("reads progress from the quest tracker", () => {
    expect(parseWarPlan([{ text: "War Plan: 3/5", y: 0 }])).toMatchObject({ step: 3, of: 5 });
    expect(parseWarPlan([{ text: "Slay the Boss", y: 0 }])).toBeNull();
  });
});

describe("world bosses", () => {
  it("are found from their health bar and get material notes", async () => {
    const { findBoss, bossInfo, isWorldBoss } = await import("../src/lib/boss");
    expect(findBoss([line("AVARICE, THE GOLD CURSED")])).toBe("Avarice, the Gold Cursed");
    expect(findBoss([line("WANDERING DEATH, DEATH GIVEN LIFE")])).toBe("Wandering Death, Death Given Life");
    expect(isWorldBoss("Ashava")).toBe(true);
    // a real health bar (2026-10-11): the title without its comma
    expect(findBoss([line("AZMODAN LORD OF SIN")])).toBe("Azmodan, Lord of Sin");
    expect(findBoss([line("Azmodan")])).toBe("Azmodan, Lord of Sin");
    const info = bossInfo("Avarice, the Gold Cursed", ctx.variant, ctx.prog);
    expect(info.notes.join(" ")).toMatch(/Lair boss summoning materials/);
  });
});

describe("Hordes compass", () => {
  it("hovering the compass in the bag doesn't start a Hordes run", () => {
    expect(looksLikeHordes("Pass through the Gates of Hell to face the Infernal Hordes.")).toBe(false);
    expect(looksLikeHordes("Infernal Hordes | WAVE: 3/10 | Burning Aether 120")).toBe(true);
  });
});

describe("Helltide cinders", () => {
  it("never takes the right-hand counter for cinders", () => {
    // HUD as OCR'd in a real Helltide: label, then 24 (cinders, left) and 97 (another currency, right)
    expect(parseHelltideHud([line("Helitide: 01:16", 1057, 36, 190), line("24", 1051, 160, 30), line("97", 1161, 178, 30)])!.cinders).toBe(24);
    // the left number missed this frame: no cinders rather than the wrong ones
    expect(parseHelltideHud([line("Helitide: 01:16", 1057, 36, 190), line("97", 1161, 178, 30)])!.cinders).toBeNull();
  });
});
