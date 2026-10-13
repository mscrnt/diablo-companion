// Nightmare Dungeon objectives as the tracker OCR read them in two real runs (2026-10-11): every
// "Seaborn"/"Seabom" flip and stray damage number used to split the run (146 splits for two dungeons).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { isDungeonCleared, isNightmareCleansed, nightmareKind, readObjective, stepObjective, stripPickup, type ObjectiveState } from "../src/lib/dungeon";
import { loadStaticData } from "../src/lib/names";

const runs: { dungeon: string; reads: string[] }[] = JSON.parse(readFileSync(new URL("./fixtures/tracker/nmd-objectives-2026-10-11.json", import.meta.url), "utf8"));

/** Replay a run's reads (each one changed from the read before) up to the clear; the splits it makes. */
function splits(run: { dungeon: string; reads: string[] }) {
  const s: ObjectiveState = { objective: null, pending: null };
  const out: string[] = [];
  for (const text of run.reads) {
    if (isDungeonCleared(text)) {
      if (s.objective) out.push(s.objective.label);
      break;
    }
    const done = stepObjective(s, readObjective(text, run.dungeon));
    if (done) out.push(done.label);
  }
  return out;
}

beforeAll(() => loadStaticData());

describe("reading an objective", () => {
  it("drops the dungeon name, damage numbers and icon junk in front", () => {
    expect(readObjective("Submerged Ruins Destroy the Seaborn Shrine: 1", "Submerged Ruins")).toMatchObject({ words: "destroy the seaborn shrine", count: 1 });
    expect(readObjective("1,880M Submekged Ruins Travel to the Brine", "Submerged Ruins")).toMatchObject({ words: "travel to the brine", count: null });
    expect(readObjective("(227) (l 'ism A-' Destroy the SeabornShrine: 1", "Submerged Ruins")?.count).toBe(1);
    expect(readObjective("Destroy the Seaborn Shrine: 2")?.label).toBe("Destroy the Seaborn Shrine: 2");
  });

  it("too little text to mean anything is no read at all", () => {
    expect(readObjective("• Tl")).toBeNull();
    expect(readObjective("- -")).toBeNull();
  });

  it("Dungeon cleared, OCR slips included", () => {
    for (const t of ["Dungeon cleared", "Dungeon-cleared", "New Submerged Ruins Dungeon'Cleared", "- -Duhgeon cleared V", "The Pit Dungeon cleared Artificer's Pit (Tier 100)"]) expect(isDungeonCleared(t), t).toBe(true);
    for (const t of ["Destroy the Seaborn Shrine: 1", "Enter the Nightmare Dungeon and complete it", "Slay the Boss"]) expect(isDungeonCleared(t), t).toBe(false);
  });
});

describe("splits from today's runs", () => {
  it("Submerged Ruins: one split per real step", () => {
    const run = runs.find((r) => r.dungeon === "Submerged Ruins")!;
    const got = splits(run);
    // 3 shrines, travel to the Brine, slay Hooklatch
    expect(got.length, got.join(" | ")).toBeLessThanOrEqual(7);
    expect(got.length).toBeGreaterThanOrEqual(4);
    expect(got.join(" | ")).toMatch(/Shrine: 3.*Shrine: 2.*Shrine: 1/);
    expect(got.join(" | ")).toMatch(/Brine/);
  });

  it("Earthen Wound: one split per real step", () => {
    const run = runs.find((r) => r.dungeon === "Earthen Wound")!;
    const got = splits(run);
    expect(got.length, got.join(" | ")).toBeLessThanOrEqual(8);
    expect(got.length).toBeGreaterThanOrEqual(3);
  });
});

// The Chronicle's Minor Nightmares, as the tracker read them (2026-10-12): never timed before
describe("Minor Nightmares", () => {
  it("the tracker marker names the run", () => {
    expect(nightmareKind("Minor Nightmare")).toBe("Minor Nightmare");
    expect(nightmareKind("Nightmare Dungeon")).toBe("Nightmare Dungeon");
    expect(nightmareKind("Nightmare Escalation Tier 2")).toBe("Escalating Nightmare");
    expect(nightmareKind("Purge the Kurast Undercity")).toBeNull();
  });

  it("ends on Nightmare Cleansed", () => {
    expect(isNightmareCleansed("Nightmare Cleansed")).toBe(true);
    expect(isNightmareCleansed("Nightmare C1eansed •")).toBe(true);
    expect(isNightmareCleansed("Slay the Countess •")).toBe(false);
  });

  it("pickup notices aren't the dungeon name", () => {
    expect(stripPickup("20 Iron Chunks Diablo II - Forgotten Tower")).toBe("Diablo II - Forgotten Tower");
    expect(stripPickup("16 Veiled Crystals")).toBe("");
    expect(stripPickup("Diablo II - Den of Evil")).toBe("Diablo II - Den of Evil");
    expect(stripPickup("Refugees saved: 0")).toBe("Refugees saved: 0");
    expect(stripPickup("3 shrines remaining")).toBe("3 shrines remaining");
  });

  it("reads the objective under an old dungeon's name", () => {
    expect(readObjective("Kill all monsters in the Den", "Diablo II - Den of Evil")?.words).toBe("kill all monsters in the den");
    expect(readObjective("Collect the Lost Pages: 0/5", "Diablo Immortal - Horadric Library")?.words).toMatch(/collect the lost pages/);
  });
});
