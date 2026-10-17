import { describe, expect, it } from "vitest";
import { alertsAllowed } from "../src/lib/alerts";
import { judgingFor } from "../src/lib/buildlabel";
import { defaultSettings } from "../src/lib/store";

describe("world event alerts while the game is closed", () => {
  it("alert by default, game or no game", () => {
    expect(defaultSettings.alerts.onlyWhileGameRuns).toBe(false);
    expect(alertsAllowed(false, null)).toBe(true);
    expect(alertsAllowed(false, { running: false })).toBe(true);
  });

  it("with the option on, only while Diablo IV runs", () => {
    expect(alertsAllowed(true, { running: true })).toBe(true);
    expect(alertsAllowed(true, { running: false })).toBe(false);
    // no game status yet (or not the desktop app): quiet
    expect(alertsAllowed(true, null)).toBe(false);
    expect(alertsAllowed(true, undefined)).toBe(false);
  });
});

describe("judging for", () => {
  it("names the build and the variant", () => {
    expect(judgingFor("Minion Necro", "Endgame")).toBe("Minion Necro, Endgame");
    expect(judgingFor("Minion Necro Build Guide", "Leveling")).toBe("Minion Necro, Leveling");
    expect(judgingFor("Blessed Shield Paladin - Build", " End Game ")).toBe("Blessed Shield Paladin, End Game");
  });

  it("copes with missing or repeated names", () => {
    expect(judgingFor(null, "Endgame")).toBeNull();
    expect(judgingFor("  ", "Endgame")).toBeNull();
    expect(judgingFor("Minion Necro", null)).toBe("Minion Necro");
    expect(judgingFor("Guide", "Endgame")).toBe("Guide, Endgame");
    expect(judgingFor("Bone Spear", "bone spear")).toBe("Bone Spear");
  });
});
