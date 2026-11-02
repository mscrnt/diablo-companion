// The Soul Splinter ambush's banners (the player's install: Messages S15_PrimeEvilAmbush_*), as OCR reads them.
import { beforeEach, describe, expect, it, vi } from "vitest";

const toasts: { title: string; body: string }[] = [];
vi.mock("../src/lib/alerts", () => ({ overlayToast: (title: string, body: string) => void toasts.push({ title, body }) }));
const { noteEchoText, noteSplinterTracker, splintersActive } = await import("../src/lib/echo");

describe("the Echo of a Prime Evil", () => {
  let now = 1_000_000;
  beforeEach(() => {
    toasts.length = 0;
    now += 10 * 60_000;
  });

  it("warns when the Splinter's banner names the Echo", () => {
    noteEchoText("Evil rises within your Splinter! The Echo of Mephisto will soon emerge!", "banner", now);
    expect(toasts).toEqual([{ title: "Echo of Mephisto coming", body: "It spawns in a few seconds: get ready." }]);
  });

  it("reads the banner through OCR's line breaks, once per ambush", () => {
    noteEchoText("Evil rises within your\nSplinter! The Echo of\nBaal will soon emerge!", "banner", now);
    noteEchoText("The Echo of Baal is breaking free!", "banner", now + 3000);
    expect(toasts.map((t) => t.title)).toEqual(["Echo of Baal coming"]);
  });

  it("says when the Splinter calms down instead", () => {
    noteEchoText("The evil within your Splinter has settled. You are safe for now...", "banner", now);
    expect(toasts.map((t) => t.title)).toEqual(["Splinter settled"]);
  });

  it("never fires on the season tracker or the Echo's own name alone", () => {
    noteEchoText("Torment XII Splinters of Evil Earn 5,586 / 50,000", "tracker", now);
    noteEchoText("ECHO OF MEPHISTO", "frame", now);
    expect(toasts).toEqual([]);
  });

  it("reads the banner strip more often while the season's Splinters are about", () => {
    noteSplinterTracker("Torment XII Splinters of Evi1", now);
    expect(splintersActive(now + 60_000)).toBe(true);
    expect(splintersActive(now + 20 * 60_000)).toBe(false);
  });
});
