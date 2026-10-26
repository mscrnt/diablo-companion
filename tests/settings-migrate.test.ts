import { describe, expect, it } from "vitest";
import { addNewActivities, defaultSettings, migrateStatusWidget } from "../src/lib/store";

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

describe("the status corner's own switch", () => {
  const settings = () => structuredClone(defaultSettings);

  it("stays off for a layout that had the loot verdict off", () => {
    const m = migrateStatusWidget(settings(), { overlay: { widgets: { verdict: { on: false }, timers: { on: true } } } });
    expect(m.overlay.widgets.status.on).toBe(false);
    expect(m.overlay.widgets.verdict.on).toBe(true);
  });

  it("is on for a layout that showed the loot verdict, and for a fresh install", () => {
    expect(migrateStatusWidget(settings(), { overlay: { widgets: { verdict: { on: true } } } }).overlay.widgets.status.on).toBe(true);
    expect(migrateStatusWidget(settings(), undefined).overlay.widgets.status.on).toBe(true);
  });

  it("leaves a saved switch of its own alone", () => {
    const m = migrateStatusWidget(settings(), { overlay: { widgets: { verdict: { on: false }, status: { on: true } } } });
    expect(m.overlay.widgets.status.on).toBe(true);
  });
});
