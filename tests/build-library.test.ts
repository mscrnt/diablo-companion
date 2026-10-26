// The build library: every build you imported, grouped by class. A build for the class you play goes to the
// character; one for another class waits in the library until you play that class, and then it's hers.
// (2026-10-25 test session: a Barbarian build imported while playing a Necromancer took the judge over.)
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useCharacter } from "../src/lib/charmap";
import { judgeEveryBuild } from "../src/lib/everyBuild";
import { decide } from "../src/lib/judge";
import {
  LIBRARY,
  assignBuild,
  attachLibrary,
  attachable,
  byClass,
  forgetBuild,
  importRoute,
  landBuild,
  libraryBuilds,
  libraryMessage,
  libraryRows,
  toLibrary,
} from "../src/lib/library";
import { attachLibraryHere, otherBuilds, switchProfile } from "../src/lib/profiles";
import { emptyGear, emptyTalisman, useBuilds, useLibrary, useProfiles, withFirstProfile, type GearData, type Profile } from "../src/lib/store";
import type { Build, BuildVariant, ParsedItem } from "../src/lib/types";
import { tablesForTests } from "./fixtures/tables";
import { exampleBuild } from "./helpers";

const variant = (id = "v1", name = "Endgame"): BuildVariant => ({
  id,
  name,
  description: "",
  gear: [],
  skillOrder: [],
  skillRanks: {},
  skillBar: [],
  summons: [],
  paragon: [],
  mercenary: { skills: [] },
  priority: [],
  sections: [],
});

/** A small build of our own: all the library needs to group it, route it and move it about. */
const mini = (id: string, name: string, className: string, variants = [variant()]): Build => ({
  id,
  source: "mobalytics",
  url: `https://mobalytics.gg/diablo-4/builds/${id}`,
  slug: id,
  name,
  author: "",
  className,
  season: "Season 15",
  tags: [],
  updatedAt: "2026-10-01",
  fetchedAt: "2026-10-01T00:00:00Z",
  variants,
  sections: [],
});

const profile = (id: string, name: string, gear: GearData | null): Profile => ({ id, name, className: "", createdAt: 0, seenAt: 0, gear, sheet: null });
const gearWith = (builds: Build[], activeBuildId: string | null = null): GearData => ({
  ...emptyGear(),
  builds: Object.fromEntries(builds.map((b) => [b.id, b])),
  activeBuildId,
  activeVariantId: activeBuildId ? "v1" : null,
});
/** The Necromancer gloves that tell the app what class a character is (profiles.ts shownClass). */
const deathgrip = { name: "Deathgrip", rarity: "unique", itemType: "Gloves", slot: "gloves", itemPower: 800, affixes: [], at: 0 } as unknown as ParsedItem;

let ex: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => {
  await tablesForTests();
  ex = await exampleBuild();
});

beforeEach(() => {
  useProfiles.setState(withFirstProfile(null), true);
  useBuilds.setState({ builds: {}, activeBuildId: null, activeVariantId: null, progress: {}, variantOf: {}, worn: {}, talisman: emptyTalisman });
  useLibrary.setState({ builds: {}, variantOf: {}, progress: {} });
  useCharacter.setState({ session: null, stats: {}, statsAt: 0, statsV: 1, skills: {}, glyphs: {} });
});

describe("where an imported build lands", () => {
  it("the character's class decides: another class goes to the library only", () => {
    expect(importRoute("Necromancer", "Barbarian")).toBe("library");
    expect(importRoute("Necromancer", "Necromancer")).toBe("character");
    expect(importRoute("necromancer", "Necromancer")).toBe("character");
    // nothing known yet (first run), or a site that never said the class: the character gets it
    expect(importRoute("", "Barbarian")).toBe("character");
    expect(importRoute("Necromancer", "")).toBe("character");
  });

  it("says so plainly, and names the character and both classes", () => {
    const text = libraryMessage(mini("barb", "Whirlwind Barbarian", "Barbarian"), "Necromancer", "Bazaq");
    expect(text).toBe("Saved to your library under Barbarian. Bazaq is a Necromancer, so it isn't the build the loot judge follows.");
    expect(text).not.toMatch(/[—–]/);
  });

  it("the build you play stays the one you play, and the other class's is in the library", () => {
    // first run: no class known, so this one is the character's
    expect(landBuild(mini("necro", "Skeleton Army", "Necromancer"), { className: "", label: "Your character" })).toEqual({ to: "character" });
    expect(useBuilds.getState().activeBuildId).toBe("necro");
    const landed = landBuild(mini("barb", "Whirlwind Barbarian", "Barbarian"), { className: "Necromancer", label: "Bazaq" });
    expect(landed.to).toBe("library");
    expect(useBuilds.getState().activeBuildId).toBe("necro");
    expect(Object.keys(useBuilds.getState().builds)).toEqual(["necro"]);
    expect(Object.keys(useLibrary.getState().builds)).toEqual(["barb"]);
  });

  it("re-imported while you play that class: the character takes it out of the library", () => {
    const barb = mini("barb", "Whirlwind Barbarian", "Barbarian");
    landBuild(barb, { className: "Necromancer", label: "Bazaq" });
    expect(Object.keys(useLibrary.getState().builds)).toEqual(["barb"]);
    landBuild(barb, { className: "Barbarian", label: "Xyz" });
    expect(useLibrary.getState().builds).toEqual({});
    expect(useBuilds.getState().activeBuildId).toBe("barb");
  });
});

describe("the library, by class", () => {
  const rows = () => {
    const { profiles, activeId } = useProfiles.getState();
    const lib = useLibrary.getState();
    return libraryRows({ profiles: Object.values(profiles), activeId, live: useBuilds.getState(), library: lib.builds, variantOf: lib.variantOf });
  };

  it("every character's builds and the ones no character has, each once, with who uses it", () => {
    const necro = mini("necro", "Skeleton Army", "Necromancer");
    const blood = mini("blood", "Blood Surge", "Necromancer");
    const barb = mini("barb", "Whirlwind Barbarian", "Barbarian");
    useProfiles.setState({ activeId: "a", profiles: { a: profile("a", "Bazaq", null), b: profile("b", "Zorvak", gearWith([blood], "blood")) } });
    useBuilds.setState(gearWith([necro], "necro"));
    toLibrary(barb);
    const all = rows();
    expect(all.map((r) => [r.build.id, r.owner?.name ?? null, r.active])).toEqual([
      ["necro", "Bazaq", true],
      ["blood", "Zorvak", true],
      ["barb", null, false],
    ]);
    expect(byClass(all).map((g) => [g.className, g.rows.map((r) => r.build.name)])).toEqual([
      ["Barbarian", ["Whirlwind Barbarian"]],
      ["Necromancer", ["Blood Surge", "Skeleton Army"]],
    ]);
  });

  it("a build is in one place only: a character's copy wins, and a build a character has never joins the library", () => {
    const necro = mini("necro", "Skeleton Army", "Necromancer");
    useBuilds.setState(gearWith([necro], "necro"));
    // a stale library row for a build the character plays (an older save) shows once, as the character's
    useLibrary.setState({ builds: { necro }, variantOf: {}, progress: {} });
    expect(rows()).toHaveLength(1);
    expect(rows()[0].owner).not.toBeNull();
    expect(toLibrary(necro)).toBe(false);
  });

  it("a build whose site never said the class is grouped last", () => {
    useLibrary.setState({ builds: { x: mini("x", "Unnamed Class", ""), s: mini("s", "Ball Lightning", "Sorcerer") }, variantOf: {}, progress: {} });
    expect(byClass(rows()).map((g) => g.className)).toEqual(["Sorcerer", "Class not known"]);
  });
});

describe("the character takes her builds from the library", () => {
  it("only the builds of her class, and only once her class is known", () => {
    const lib = { barb: mini("barb", "Whirlwind Barbarian", "Barbarian"), necro: mini("necro", "Skeleton Army", "Necromancer") };
    expect(attachable("", lib)).toEqual([]);
    expect(attachable("barbarian", lib).map((b) => b.id)).toEqual(["barb"]);
    expect(attachable("Druid", lib)).toEqual([]);
  });

  it("the first one plays for a character with no build, and the others just join", () => {
    useLibrary.setState({
      builds: { barb: mini("barb", "Whirlwind Barbarian", "Barbarian"), rend: mini("rend", "Rend Barbarian", "Barbarian"), necro: mini("necro", "Skeleton Army", "Necromancer") },
      variantOf: { barb: "v1" },
      progress: { "barb:v1:helm": { state: "have", greater: [], have: [], tempered: false, masterwork: 0 } },
    });
    const took = attachLibrary("Barbarian", "Xyz");
    expect(took.map((b) => b.id).sort()).toEqual(["barb", "rend"]);
    const s = useBuilds.getState();
    expect(Object.keys(s.builds).sort()).toEqual(["barb", "rend"]);
    expect(s.activeBuildId).toBe("barb");
    expect(s.activeVariantId).toBe("v1");
    // the progress tracked for it comes along
    expect(s.progress["barb:v1:helm"].state).toBe("have");
    // the Necromancer build stays in the library
    expect(Object.keys(useLibrary.getState().builds)).toEqual(["necro"]);
  });

  it("never takes over from the build a character already plays", () => {
    useBuilds.setState(gearWith([mini("necro", "Skeleton Army", "Necromancer")], "necro"));
    useLibrary.setState({ builds: { necro2: mini("necro2", "Blood Surge", "Necromancer") }, variantOf: {}, progress: {} });
    attachLibrary("Necromancer", "Bazaq");
    expect(useBuilds.getState().activeBuildId).toBe("necro");
    expect(Object.keys(useBuilds.getState().builds).sort()).toEqual(["necro", "necro2"]);
  });

  it("switching to the character does it by itself, from the class she has shown", () => {
    const barb = mini("barb", "Whirlwind Barbarian", "Barbarian");
    const necro = mini("necro", "Skeleton Army", "Necromancer");
    useProfiles.setState({ activeId: "a", profiles: { a: profile("a", "Xyz", null), b: profile("b", "Bazaq", { ...emptyGear(), worn: { gloves: deathgrip as any } }) } });
    useLibrary.setState({ builds: { barb, necro }, variantOf: {}, progress: {} });
    // Xyz has shown nothing yet, so nothing is hers
    expect(attachLibraryHere()).toEqual([]);
    expect(switchProfile("b")).toBe(true);
    // Bazaq wears Necromancer gloves: the Necromancer build is hers and she plays it
    expect(Object.keys(useBuilds.getState().builds)).toEqual(["necro"]);
    expect(useBuilds.getState().activeBuildId).toBe("necro");
    expect(Object.keys(useLibrary.getState().builds)).toEqual(["barb"]);
  });
});

describe("moving a build about", () => {
  it("from the library to the character you play, to another character, and back to the library", () => {
    const barb = mini("barb", "Whirlwind Barbarian", "Barbarian");
    useProfiles.setState({ activeId: "a", profiles: { a: profile("a", "Bazaq", null), b: profile("b", "Xyz", emptyGear()) } });
    toLibrary(barb, "v1", { "barb:v1:helm": { state: "upgrade", greater: [], have: [], tempered: false, masterwork: 0 } });
    expect(assignBuild("barb", "a")).toBe(true);
    expect(useBuilds.getState().activeBuildId).toBe("barb");
    expect(useBuilds.getState().progress["barb:v1:helm"].state).toBe("upgrade");
    // moving it on takes its progress with it and leaves the character with no build
    expect(assignBuild("barb", "b")).toBe(true);
    expect(useBuilds.getState().builds).toEqual({});
    expect(useBuilds.getState().activeBuildId).toBeNull();
    const xyz = useProfiles.getState().profiles.b.gear!;
    expect(xyz.activeBuildId).toBe("barb");
    expect(xyz.progress["barb:v1:helm"].state).toBe("upgrade");
    // and back to the library, still with its progress and variant
    expect(assignBuild("barb", LIBRARY)).toBe(true);
    expect(useProfiles.getState().profiles.b.gear!.builds).toEqual({});
    expect(useLibrary.getState().variantOf.barb).toBe("v1");
    expect(useLibrary.getState().progress["barb:v1:helm"].state).toBe("upgrade");
  });

  it("a build it can't find, or one already there, moves nothing", () => {
    useBuilds.setState(gearWith([mini("necro", "Skeleton Army", "Necromancer")], "necro"));
    expect(assignBuild("necro", useProfiles.getState().activeId)).toBe(false);
    expect(assignBuild("gone", LIBRARY)).toBe(false);
    expect(assignBuild("necro", "nobody")).toBe(false);
    expect(Object.keys(useBuilds.getState().builds)).toEqual(["necro"]);
  });

  it("forgetting one takes it out of wherever it lives", () => {
    useBuilds.setState(gearWith([mini("necro", "Skeleton Army", "Necromancer")], "necro"));
    useLibrary.setState({ builds: { barb: mini("barb", "Whirlwind Barbarian", "Barbarian") }, variantOf: {}, progress: {} });
    forgetBuild("barb");
    forgetBuild("necro");
    expect(useLibrary.getState().builds).toEqual({});
    expect(useBuilds.getState().builds).toEqual({});
    expect(useBuilds.getState().activeBuildId).toBeNull();
  });
});

describe("what the loot judge says about a library build", () => {
  /** The example build's unique scythe (a Necromancer unique), not owned yet. */
  const scream = () =>
    ({
      name: "Bloodless Scream",
      slot: "weapon",
      rarity: "unique",
      itemType: "Ancestral Unique Scythe",
      itemPower: 900,
      affixes: [{ text: "+20% Weapon Damage", match: null, greater: false, tempered: false, masterwork: false, enchanted: false }],
      aspect: null,
    }) as unknown as ParsedItem;
  /** An active build with no weapon of its own, so the scythe is no use to it. */
  const bare = () => ({ ...ex.variant, gear: ex.variant.gear.filter((g) => g.slot !== "weapon" && g.group !== "talisman") });

  it("stash it: it fits a build waiting in your library", () => {
    useLibrary.setState({ builds: { [ex.build.id]: ex.build }, variantOf: { [ex.build.id]: ex.variant.id }, progress: {} });
    const libs = libraryBuilds();
    expect(libs.map((o) => [o.build.id, o.library, o.sameCharacter])).toEqual([[ex.build.id, true, false]]);
    const scored = decide(scream(), bare(), { prog: ex.prog });
    expect(scored.verdict).toBe("SCRAP");
    const r = judgeEveryBuild(scream(), scored, libs);
    expect(r.verdict).toBe("STASH");
    expect(r.action).toBe("Stash it: fits the Skeleton Warrior Army build in your library.");
  });

  it("a library build never makes an item scrap for the character you play", () => {
    // a library build of another class has no use for it, so the active build's verdict stands as it was
    useLibrary.setState({ builds: { barb: mini("barb", "Whirlwind Barbarian", "Barbarian") }, variantOf: {}, progress: {} });
    const scored = decide(scream(), bare(), { prog: ex.prog });
    expect(judgeEveryBuild(scream(), scored, libraryBuilds())).toEqual(scored);
    // and a build the active one wears the item for is never talked down
    const wear = decide(scream(), ex.variant, { prog: ex.prog });
    expect(wear.verdict).toBe("WEAR");
    expect(judgeEveryBuild(scream(), wear, libraryBuilds()).verdict).toBe("WEAR");
  });

  it("the judge sees the character's builds first and the library's last", () => {
    useBuilds.setState(gearWith([mini("necro", "Skeleton Army", "Necromancer"), mini("blood", "Blood Surge", "Necromancer")], "necro"));
    useLibrary.setState({ builds: { [ex.build.id]: ex.build }, variantOf: {}, progress: {} });
    expect(otherBuilds().map((o) => [o.build.id, !!o.library])).toEqual([
      ["blood", false],
      [ex.build.id, true],
    ]);
  });
});
