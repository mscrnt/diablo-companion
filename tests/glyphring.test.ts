// The red ring that marks an active glyph in the Paragon screen's list (measured on a player's 1080p
// screenshot, 2026-10-12): drawn here on a grey background at the same size.
import { describe, expect, it } from "vitest";
import { glyphActiveAt, ringScore } from "../src/lib/glyphring";

const H = 1080;
/** A 160x160 crop: grey cells, a glyph icon at (80, 80), with or without the ring at radius 22. */
function cell(ring: boolean) {
  const w = 160;
  const px = new Uint8ClampedArray(w * w * 4);
  for (let y = 0; y < w; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x - 80, y - 80);
      const [r, g, b] = d < 18 ? [100, 40, 5] : ring && d >= 20 && d <= 25 ? [100, 17, 18] : [17, 17, 17];
      px.set([r, g, b, 255], i);
    }
  return { px, w };
}

describe("active glyph ring", () => {
  it("scores the ring, not the icon or the grey cell", () => {
    expect(ringScore(cell(true).px, 160, 160, 80, 80, H)).toBeGreaterThan(60);
    expect(ringScore(cell(false).px, 160, 160, 80, 80, H)).toBeLessThan(5);
  });

  it("finds it wherever the cursor sits on the icon", () => {
    for (const [dx, dy] of [[0, 0], [12, -9], [-15, 14]]) {
      expect(glyphActiveAt(cell(true).px, 160, 160, 80 + dx, 80 + dy, H)).toBe(true);
      expect(glyphActiveAt(cell(false).px, 160, 160, 80 + dx, 80 + dy, H)).toBe(false);
    }
  });
});

describe("next to an active glyph", () => {
  it("an inactive cell doesn't borrow its neighbour's ring", () => {
    // two cells 75 px apart (1080p spacing): active on the left at (60, 80), inactive on the right at (135, 80)
    const w = 200;
    const px = new Uint8ClampedArray(w * 160 * 4);
    for (let y = 0; y < 160; y++)
      for (let x = 0; x < w; x++) {
        const dl = Math.hypot(x - 60, y - 80);
        const dr = Math.hypot(x - 135, y - 80);
        const [r, g, b] = dl < 18 || dr < 18 ? [100, 40, 5] : dl >= 20 && dl <= 25 ? [100, 17, 18] : [17, 17, 17];
        px.set([r, g, b, 255], (y * w + x) * 4);
      }
    // the cursor on the inactive icon, leaning toward the active one
    expect(glyphActiveAt(px, w, 160, 135 - 15, 80, H)).toBe(false);
    expect(glyphActiveAt(px, w, 160, 60 + 15, 80, H)).toBe(true);
  });
});
