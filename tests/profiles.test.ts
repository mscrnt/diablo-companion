// Character profiles: one per character, found from the name on the Character panel. Everything saved
// before 0.3.0 becomes the first profile, and switching characters never loses a build, gear or stats.
import { readFileSync } from "node:fs";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { useCharacter } from "../src/lib/charmap";
import { readCharacterName, sameName } from "../src/lib/charname";
import { isPersonalLine } from "../src/lib/privacy";
import { characterSeen, moveBuild, noteCharacterFrame, otherBuilds, profileClass, switchProfile } from "../src/lib/profiles";
import { FIRST_PROFILE, emptyTalisman, useBuilds, useProfiles, useRuns, withFirstProfile } from "../src/lib/store";
import type { Build, ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/${name}.json`, import.meta.url), "utf8"));
const L = (text: string) => ({ text });

let ex: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ex = await exampleBuild()));

/** A second build of the same class (another Mobalytics guide). */
const otherBuild = (): Build => ({ ...ex.build, id: "blood-surge", name: "Blood Surge", variants: ex.build.variants });
const ring = { name: "Old Band", slot: "ring", rarity: "legendary", itemType: "Legendary Ring", itemPower: 800, affixes: [] } as unknown as ParsedItem;

beforeEach(() => {
  useProfiles.setState(withFirstProfile(null), true);
  useBuilds.setState({ builds: {}, activeBuildId: null, activeVariantId: null, progress: {}, variantOf: {}, worn: {}, talisman: emptyTalisman });
  useCharacter.setState({ session: null, stats: {}, statsAt: 0, statsV: 1, skills: {}, glyphs: {} });
});

/** What a player had before 0.3.0: a build with tracked progress, a worn ring and mapped stats. */
function savedBefore() {
  useBuilds.getState().addBuild(ex.build, ex.variant.id);
  useBuilds.getState().setProgress("helm", { state: "have" });
  useBuilds.getState().setWorn("ring-1", ring);
  useCharacter.getState().setStats({ Strength: "177" });
}

describe("reading the name off the Character panel", () => {
  it("the name in capitals above the title and Stats & Materials (2026-10 log)", () => {
    expect(readCharacterName([L("232 BAZAQ Aged Boots Stats & Materials Weapon Damage 4,574 Toughness")])).toBe("Bazaq");
    expect(readCharacterName(["232", "BAZAQ", "Aged Boots", "Stats & Materials", "Weapon Damage", "4,574"].map(L))).toBe("Bazaq");
  });

  it("the stats sheet, the name read in mixed case under the CHARACTER header", () => {
    expect(readCharacterName(fixture("character/stats-panel").lines.map(L))).toBe("Zorvak");
    expect(readCharacterName(fixture("character/stats-panel-under-skill").lines.map(L))).toBe("Zorvak");
  });

  it("never a title read without its name, a tooltip over the panel, or a frame without the panel", () => {
    expect(readCharacterName(["CHARACTER", "AgedBoots", "Life Regeneration 220", "Stats & Materials"].map(L))).toBeNull();
    expect(readCharacterName(fixture("tooltips/ocelots-eye-character-panel").ocr.map(L))).toBeNull();
    expect(readCharacterName(["BAZAQ", "Aged Boots", "Weapon Damage"].map(L))).toBeNull();
  });

  it("OCR look-alikes are the same name, other names aren't", () => {
    expect(sameName("Bazaq", "Bazag")).toBe(true);
    expect(sameName("Zorvak", "Zorvax")).toBe(true);
    expect(sameName("Bazaq", "Zorvak")).toBe(false);
    expect(sameName("Ana", "Ena")).toBe(false);
  });
});

describe("the first profile: everything saved before 0.3.0", () => {
  it("is made once, unnamed and active, and saved profiles are kept as they are", () => {
    const first = withFirstProfile(undefined);
    expect(Object.keys(first.profiles)).toEqual([FIRST_PROFILE]);
    expect(first.activeId).toBe(FIRST_PROFILE);
    expect(first.profiles[FIRST_PROFILE]).toMatchObject({ name: "", gear: null, sheet: null });
    const saved = { profiles: { a: { ...first.profiles.first, id: "a", name: "Bazaq" }, b: { ...first.profiles.first, id: "b", name: "Zorvak" } }, activeId: "b" };
    expect(withFirstProfile(saved)).toEqual(saved);
    expect(withFirstProfile({ ...saved, activeId: "gone" }).activeId).toBe("a");
  });

  it("keeps the saved builds, gear and stats where they are, and takes the first name read", () => {
    savedBefore();
    expect(characterSeen("Bazaq")).toBe("named");
    expect(useProfiles.getState().profiles[FIRST_PROFILE].name).toBe("Bazaq");
    expect(Object.keys(useBuilds.getState().builds)).toEqual([ex.build.id]);
    expect(useBuilds.getState().worn["ring-1"].name).toBe("Old Band");
    expect(useCharacter.getState().stats).toEqual({ Strength: "177" });
    expect(profileClass(useProfiles.getState().profiles[FIRST_PROFILE])).toBe("Necromancer");
  });

  it("a name read is never shared: lines with it drop out of shared judgements", () => {
    expect(isPersonalLine("232 BAZAQ Aged Boots")).toBe(false);
    characterSeen("Bazaq");
    expect(isPersonalLine("232 BAZAQ Aged Boots")).toBe(true);
  });
});

describe("switching characters", () => {
  it("a new name gets an empty profile; the first one's data comes back when it's seen again", () => {
    savedBefore();
    characterSeen("Bazaq");
    expect(characterSeen("Zorvak")).toBe("new");
    expect(useBuilds.getState().builds).toEqual({});
    expect(useBuilds.getState().worn).toEqual({});
    expect(useCharacter.getState().stats).toEqual({});
    // the new character's own data
    useCharacter.getState().setStats({ Strength: "900" });
    expect(characterSeen("BAZAQ")).toBe("switched");
    expect(useBuilds.getState().activeBuildId).toBe(ex.build.id);
    expect(useBuilds.getState().progress[`${ex.build.id}:${ex.variant.id}:helm`].state).toBe("have");
    expect(useBuilds.getState().worn["ring-1"].name).toBe("Old Band");
    expect(useCharacter.getState().stats).toEqual({ Strength: "177" });
    expect(characterSeen("Zorvak")).toBe("switched");
    expect(useCharacter.getState().stats).toEqual({ Strength: "900" });
  });

  it("one misread frame never switches: two agreeing reads for a known character, three for a new one", () => {
    savedBefore();
    characterSeen("Bazaq");
    const frame = (name: string) => ["CHARACTER", name, "Aged Boots", "Stats & Materials"].map(L);
    const t = 1_000_000;
    noteCharacterFrame(frame("ZORVAK"), t);
    noteCharacterFrame(frame("ZORVAK"), t + 500);
    expect(Object.keys(useProfiles.getState().profiles)).toHaveLength(1);
    noteCharacterFrame(frame("ZORVAK"), t + 1000);
    expect(useProfiles.getState().profiles[useProfiles.getState().activeId].name).toBe("Zorvak");
    noteCharacterFrame(frame("BAZAQ"), t + 2000);
    expect(useProfiles.getState().profiles[useProfiles.getState().activeId].name).toBe("Zorvak");
    noteCharacterFrame(frame("BAZAG"), t + 2500);
    expect(useProfiles.getState().profiles[useProfiles.getState().activeId].name).toBe("Bazaq");
  });

  it("the switch buttons work the same way", () => {
    savedBefore();
    characterSeen("Bazaq");
    characterSeen("Zorvak");
    const bazaq = Object.values(useProfiles.getState().profiles).find((p) => p.name === "Bazaq")!;
    expect(switchProfile(bazaq.id)).toBe(true);
    expect(useBuilds.getState().activeBuildId).toBe(ex.build.id);
    expect(switchProfile(bazaq.id)).toBe(false);
  });

  it("runs carry the character that ran them", () => {
    useRuns.getState().start();
    expect(useRuns.getState().active?.character).toBe(FIRST_PROFILE);
    useRuns.getState().stop();
  });
});

describe("builds per character", () => {
  it("several builds on one character, one active; a build moves to another character with its progress", () => {
    savedBefore();
    useBuilds.getState().addBuild(otherBuild());
    useBuilds.getState().setActive(ex.build.id, ex.variant.id);
    characterSeen("Bazaq");
    characterSeen("Zorvak");
    const zorvak = useProfiles.getState().activeId;
    characterSeen("Bazaq");
    useBuilds.getState().setProgress("boots", { state: "perfect" });
    moveBuild(ex.build.id, zorvak);
    expect(Object.keys(useBuilds.getState().builds)).toEqual(["blood-surge"]);
    const moved = useProfiles.getState().profiles[zorvak].gear!;
    expect(moved.activeBuildId).toBe(ex.build.id);
    expect(moved.progress[`${ex.build.id}:${ex.variant.id}:boots`].state).toBe("perfect");
    expect(profileClass(useProfiles.getState().profiles[zorvak])).toBe("Necromancer");
  });

  it("the judge sees every other build: this character's first, then other characters' with what they wear", () => {
    savedBefore();
    useBuilds.getState().addBuild(otherBuild());
    useBuilds.getState().setActive(ex.build.id, ex.variant.id);
    characterSeen("Bazaq");
    characterSeen("Zorvak");
    useBuilds.getState().addBuild({ ...ex.build, id: "zorvak-build", name: "Zorvak's Minions" }, ex.variant.id);
    characterSeen("Bazaq");
    const others = otherBuilds();
    expect(others.map((o) => [o.build.id, o.sameCharacter, o.character.name])).toEqual([
      ["blood-surge", true, "Bazaq"],
      ["zorvak-build", false, "Zorvak"],
    ]);
    // gear memory is for the build a character plays
    expect(others[0].worn).toBeUndefined();
    expect(others[1].worn).toBeDefined();
  });
});
