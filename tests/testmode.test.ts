// Test mode's display snapshot: which monitor the game is on and its window mode.
import { describe, expect, it } from "vitest";
import { monitorOf, testModeOn, windowMode, type DisplayInfo } from "../src/lib/testmode";
import { defaultSettings } from "../src/lib/store";

const monitors: DisplayInfo["monitors"] = [
  { name: "\\\\.\\DISPLAY1", rect: [0, 0, 2560, 1440], scale: 1.25, primary: true },
  { name: "\\\\.\\DISPLAY2", rect: [2560, 0, 3840, 2160], scale: 1.5, primary: false },
];

describe("test mode display context", () => {
  it("is off by default", () => {
    expect(defaultSettings.testMode.enabled).toBe(false);
    expect(testModeOn()).toBe(false);
  });

  it("finds the game's monitor by the window centre", () => {
    expect(monitorOf([2560, 0, 3840, 2160], monitors)?.scale).toBe(1.5);
    expect(monitorOf([100, 100, 1600, 900], monitors)?.primary).toBe(true);
  });

  it("tells windowed, borderless window and windowed fullscreen apart", () => {
    const m = monitors[1];
    expect(windowMode({ rect: [2560, 0, 3840, 2160], client: [3840, 2160], caption: false, maximized: false }, m)).toBe("fullscreen (borderless)");
    expect(windowMode({ rect: [2600, 40, 1920, 1080], client: [1904, 1041], caption: true, maximized: false }, m)).toBe("windowed");
    expect(windowMode({ rect: [2600, 40, 1920, 1080], client: [1920, 1080], caption: false, maximized: false }, m)).toBe("borderless window");
  });
});
