// Nightmare Dungeon objectives as the tracker OCR read them in two real runs (2026-10-11): every
// "Seaborn"/"Seabom" flip and stray damage number used to split the run (146 splits for two dungeons).
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { isDungeonCleared, readObjective, stepObjective, type ObjectiveState } from "../src/lib/dungeon";
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
