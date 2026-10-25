import { describe, expect, it } from "vitest";
import { addNewActivities, defaultSettings } from "../src/lib/store";

describe("activities added by an update", () => {
  const saved = ["The Pit", "Nightmare Dungeon", "Escalating Nightmare", "Minor Nightmare", "Helltide", "My own thing"];
  const settings = (activities: string[], activitiesAdded?: string[]) => ({ ...structuredClone(defaultSettings), activities, activitiesAdded });

  it("go into a saved list once, after the one before them", () => {
    const m = addNewActivities(settings([...saved]), { activities: saved });
    expect(m.activities).toEqual(["The Pit", "Nightmare Dungeon", "Escalating Nightmare", "Minor Nightmare", "Horadric Strongroom", "Helltide", "My own thing"]);
    expect(m.activitiesAdded).toEqual(["Horadric Strongroom"]);
  });

  it("stay out once removed", () => {
    const m = addNewActivities(settings([...saved], ["Horadric Strongroom"]), { activities: saved, activitiesAdded: ["Horadric Strongroom"] });
    expect(m.activities).toEqual(saved);
  });

  it("aren't doubled on a fresh install", () => {
    const m = addNewActivities(settings([...defaultSettings.activities]), undefined);
    expect(m.activities.filter((a) => a === "Horadric Strongroom")).toHaveLength(1);
  });
});
