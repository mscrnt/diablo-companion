// The Mobalytics importer and the example build's stat targets.
// The document below is hand-written in the shape Mobalytics' own endpoint returns; no response from
// that site (or any other) is kept in the repo.
import { beforeAll, describe, expect, it } from "vitest";
import { normaliseMobalytics, parseBuildUrl } from "../src/lib/mobalytics";
import { matchTarget, buildTargetNames } from "../src/lib/parse";
import { exampleBuild } from "./helpers";
import { tablesForTests } from "./fixtures/tables";

describe("parseBuildUrl", () => {
  it("featured guide with a variant", () => {
    expect(parseBuildUrl("https://mobalytics.gg/diablo-4/builds/minion-necromancer-guide?ws-ngf5-1=activeVariantId%2C1")).toEqual({
      slug: "minion-necromancer-guide",
      variant: "1",
      kind: "builds",
    });
  });
  it("profile build", () => {
    expect(parseBuildUrl("https://mobalytics.gg/diablo-4/profile/someone/builds/my-build")).toEqual({ slug: "my-build", kind: "profile", author: "someone" });
  });
  it("bare slug", () => {
    expect(parseBuildUrl("minion-necromancer-guide")).toEqual({ slug: "minion-necromancer-guide", kind: "builds" });
  });
});

/** One stat as the builder lists it, by the app's own slug (which is what Mobalytics' ids are). */
const st = (id: string, isGreater = false, isMasterwork = false) => ({ id, isGreater, isMasterwork });
const slot = (gameSlotSlug: string, slug: string, title: string, type: string, modifiers: Record<string, unknown>) => ({
  gameSlotSlug,
  gameEntity: { slug, title, type, iconUrl: null, modifiers },
});

/** A two-slot build document with one variant, as the site hands it over. */
const doc = {
  id: "doc-1",
  slugifiedName: "minion-necromancer-guide",
  updatedAt: "2026-10-18T10:00:00.000Z",
  author: { name: "Someone" },
  tags: { data: [{ groupSlug: "class", name: "Necromancer", slug: "necromancer" }, { groupSlug: "season", name: "Season 15", slug: "s15" }] },
  data: {
    name: "Test Minions",
    buildVariants: {
      values: [
        {
          id: "1",
          genericBuilder: {
            slots: [
              slot("helm", "the-undercrown", "The Undercrown", "uniqueItems", {
                gearStats: [st("intelligence"), st("ranks-to-minion-skills", true, true)],
                implicitStats: [{ id: "total-armor" }],
                temperingStats: [st("worldly-endurance-maximum-life")],
                socketStats: [{ slug: "topaz", type: "gems" }],
                isMythic: true, // the builder's "mythic quality" slot: the game's tables say what the item really is
              }),
              slot("charm-1", "mlor-of-the-black-shroud", "Mlor of the Black Shroud", "charms", {
                charmStats: [{ id: "summon-damage" }],
                socketStats: [{ slug: "nagu", type: "runes" }],
              }),
            ],
          },
          assignedSkills: {
            skills: [
              { position: 2, skill: { slug: "skeleton-mage", name: "Skeleton Mage", description: "Raise a mage.", iconUrl: null } },
              { position: 1, skill: { slug: "skeleton-warrior", name: "Skeleton Warrior", description: "Raise a warrior.", iconUrl: null } },
            ],
            summons: [{ type: "SKELETAL_WARRIORS", upgrade: "reapers", spec: { slug: "skeletal-warriors-reapers", name: "Skeletal Warriors: Reapers", description: "" } }],
          },
          skillTree: {
            skills: [
              { actionType: "ACTIVATE", skill: { slug: "skeleton-warrior", type: { id: "basic" } } },
              { actionType: "ACTIVATE", skill: { slug: "skeleton-warrior", type: { id: "basic" } } },
              { actionType: "DEACTIVATE", skill: { slug: "blight", type: { id: "basic" } } },
            ],
          },
          paragon: {
            nodes: [{ slug: "necromancer-start-x11-y14" }, { slug: "necromancer-cult-leader-x9-y10" }],
            boards: [{ x: 0, y: 0, rotation: 0, board: { slug: "necromancer-start" }, glyph: { slug: "necromancer-warrior" }, glyphLevel: 100 }],
          },
          mercenary: { primaryMercenary: { slug: "raheir-the-shieldbearer" }, skill: { slug: "bastion" }, skillTree: [{ actionType: "ACTIVATE", skill: { slug: "bastion" } }] },
          equipmentPriorityList: [{ slug: "the-undercrown", type: "uniqueItems" }],
        },
      ],
    },
  },
  content: [
    { id: "v-widget", data: { childrenVariants: [{ id: "1", title: "Endgame", description: "", childrenIds: ["sec-1"] }] } },
    { id: "sec-1", __typename: "Diablo4DocumentUgWidgetBuilder", data: { title: "Gear", simplifiedContent: { root: { children: [{ type: "paragraph", children: [{ type: "text", text: "Minion ranks first." }] }] } } } },
    { id: "sec-2", __typename: "Diablo4DocumentCmSectionRichTextSimplified", data: { title: "Overview", simplifiedContent: { root: { children: [{ type: "paragraph", children: [{ type: "text", text: "Send the warriors in." }] }] } } } },
  ],
};

describe("normaliseMobalytics", () => {
  beforeAll(() => tablesForTests());

  it("reads the header, the tags and the variant's name", () => {
    const b = normaliseMobalytics(doc, "https://mobalytics.gg/diablo-4/builds/minion-necromancer-guide");
    expect(b.source).toBe("mobalytics");
    expect(b.name).toBe("Test Minions");
    expect(b.className).toBe("Necromancer");
    expect(b.season).toBe("Season 15");
    expect(b.author).toBe("Someone");
    expect(b.variants.map((v) => v.name)).toEqual(["Endgame"]);
  });

  it("maps a slot with its affixes, greater and masterwork targets, temper and socket", () => {
    const v = normaliseMobalytics(doc).variants[0];
    const gear = Object.fromEntries(v.gear.map((g) => [g.slotLabel, g]));
    expect(gear["Helm"].itemName).toBe("The Undercrown");
    // the builder flagged the slot as mythic quality; the game's tables say it is a plain unique
    expect(gear["Helm"].kind).toBe("unique");
    const ranks = gear["Helm"].affixes.find((a) => a.name === "Ranks to Minion Skills")!;
    expect([ranks.greater, ranks.masterwork]).toEqual([true, true]);
    expect(gear["Helm"].implicits.map((i) => i.name)).toEqual(["Total Armor"]);
    expect(gear["Helm"].tempers[0].name).toBe("Maximum Life (Worldly Endurance)");
    expect(gear["Helm"].sockets).toEqual([{ slug: "topaz", name: "Topaz", kind: "gem" }]);
  });

  it("reads the talisman, the skill bar in position order, the tree ranks and the paragon", () => {
    const v = normaliseMobalytics(doc).variants[0];
    const charm = v.gear.find((g) => g.slotLabel === "Charm 1")!;
    expect([charm.itemName, charm.kind, charm.group]).toEqual(["Mlor of the Black Shroud", "charm", "talisman"]);
    expect(charm.extras).toEqual([{ label: "Charm stats", stats: [{ slug: "summon-damage", name: "Summon Damage", greater: false, masterwork: false }] }]);
    expect(charm.sockets[0]).toEqual({ slug: "nagu", name: "Nagu", kind: "rune" });
    expect(v.skillBar.map((s) => s.name)).toEqual(["Skeleton Warrior", "Skeleton Mage"]);
    // only the points the tree activates count, so the deactivated skill isn't ranked
    expect(v.skillRanks).toEqual({ "skeleton-warrior": 2 });
    expect(v.paragon.map((p) => [p.name, p.glyphName, p.glyphLevel, p.nodes])).toEqual([["Start", "Warrior", 100, ["necromancer-start-x11-y14"]]]);
    expect(v.mercenary.primary).toMatch(/Raheir/);
    expect(v.summons.map((s) => s.name)).toEqual(["Skeletal Warriors: Reapers"]);
    expect(v.priority).toEqual(["the-undercrown"]);
  });

  it("keeps the author's notes: the variant's own, and the ones the whole guide shares", () => {
    const b = normaliseMobalytics(doc);
    expect(b.variants[0].sections.map((s) => [s.title, s.text])).toEqual([["Gear", "Minion ranks first."]]);
    expect(b.sections.map((s) => s.title)).toEqual(["Overview"]);
  });
});

describe("the example build's stat targets", () => {
  let ctx: Awaited<ReturnType<typeof exampleBuild>>;
  beforeAll(async () => void (ctx = await exampleBuild()));

  it("matches OCR'd affix lines to build stats", () => {
    const targets = buildTargetNames(ctx.variant);
    expect(matchTarget("+143 Intelligence", targets)).toBe("Intelligence");
    expect(matchTarget("+9.0% Critical Strike Chance", targets)).toBe("Critical Strike Chance");
    expect(matchTarget("+20% Resistance to All Elements", targets)).toBe("Resistance to All Elements");
    // a single resistance is not "all elements"
    expect(matchTarget("+5% Fire Resistance", targets)).toBeNull();
  });
});
