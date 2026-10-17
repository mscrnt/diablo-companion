import { describe, expect, it } from "vitest";
import { DEFAULT_BARS, clampDiscordRoom, movePanel, normalizeBars, splitBar } from "../src/lib/barlayout";
import { defaultSettings } from "../src/lib/store";

describe("bar layout", () => {
  it("the default settings match the default bars", () => {
    const { left, right } = defaultSettings.overlay.bars;
    expect(normalizeBars({ left, right })).toEqual(DEFAULT_BARS);
    expect(defaultSettings.overlay.bars.discord).toBe(false);
  });

  it("cleans saved layouts: unknown names, repeats, extra gaps, missing panels", () => {
    const b = normalizeBars({ left: ["timers", "nope", "timers", "gap", "run", "gap"], right: ["verdict"] });
    expect(b.left).toEqual(["timers", "activity", "farm", "build", "gap", "run"]);
    expect(b.right).toEqual(["verdict", "watchers", "toasts", "gap"]);
    expect(normalizeBars(undefined)).toEqual(DEFAULT_BARS);
  });

  it("a panel moved to the other bar stays there", () => {
    const b = normalizeBars({ left: ["activity", "run", "farm", "build", "gap"], right: ["timers", "verdict", "watchers", "toasts", "gap"] });
    expect(b.right[0]).toBe("timers");
    expect(b.left).not.toContain("timers");
  });

  it("splits a bar into top and bottom groups", () => {
    expect(splitBar(["timers", "gap", "run", "farm"])).toEqual({ top: ["timers"], bottom: ["run", "farm"] });
    expect(splitBar(["timers", "run", "gap"])).toEqual({ top: ["timers", "run"], bottom: [] });
  });

  it("moves panels up and down, across the gap to the bottom group", () => {
    let b = movePanel(DEFAULT_BARS, "timers", "up");
    expect(b.left.slice(0, 2)).toEqual(["timers", "activity"]);
    b = movePanel(b, "timers", "up"); // already first: unchanged
    expect(b.left[0]).toBe("timers");
    b = movePanel(DEFAULT_BARS, "build", "down");
    expect(splitBar(b.left)).toEqual({ top: ["activity", "timers", "run", "farm"], bottom: ["build"] });
    b = movePanel(b, "build", "up");
    expect(b.left).toEqual(DEFAULT_BARS.left);
  });

  it("keeps the World events panel out of Discord's corner by moving it to the right bar", () => {
    const b = movePanel(DEFAULT_BARS, "timers", "swap");
    expect(b.left).toEqual(["activity", "run", "farm", "build", "gap"]);
    expect(b.right).toEqual(["verdict", "watchers", "toasts", "timers", "gap"]);
    // a bottom panel lands at the top of the other bar's bottom group
    const c = movePanel({ left: ["activity", "gap", "run"], right: ["verdict", "gap", "toasts"] }, "run", "swap");
    expect(splitBar(c.right)).toEqual({ top: ["verdict", "watchers"], bottom: ["run", "toasts"] });
    // and back again
    expect(movePanel(b, "timers", "swap").left).toContain("timers");
  });

  it("doesn't change the saved layout it was given", () => {
    const saved = { left: [...DEFAULT_BARS.left], right: [...DEFAULT_BARS.right] };
    movePanel(saved, "timers", "swap");
    expect(saved).toEqual(DEFAULT_BARS);
  });

  it("keeps the Discord room sensible", () => {
    expect(clampDiscordRoom(0.3)).toBe(0.3);
    expect(clampDiscordRoom(0)).toBe(0.05);
    expect(clampDiscordRoom(2)).toBe(0.6);
    expect(clampDiscordRoom(NaN)).toBe(0.22);
  });
});
