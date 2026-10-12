// Is a glyph in the Paragon screen's glyph list active (socketed on a board)? The game draws a dark red
// ring around active glyphs: about (100, 17, 18) at 2% of the screen height from the icon's centre,
// where an inactive cell is grey (17, 17, 17). Measured on a player's 1920x1080 screenshot (2026-10-12):
// ringed cells score 70-81, every other cell 0-1.

/** How red the ring around (cx, cy) is: mean of R - max(G, B) on three circles near the ring's radius. */
export function ringScore(px: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, gameH: number): number {
  let sum = 0;
  let n = 0;
  for (const f of [0.0195, 0.0205, 0.0215]) {
    const r = f * gameH;
    for (let a = 0; a < 360; a += 6) {
      const x = Math.round(cx + r * Math.cos((a * Math.PI) / 180));
      const y = Math.round(cy + r * Math.sin((a * Math.PI) / 180));
      if (x < 0 || y < 0 || x >= w || y >= h) continue;
      const i = (y * w + x) * 4;
      sum += px[i] - Math.max(px[i + 1], px[i + 2]);
      n++;
    }
  }
  return n ? sum / n : 0;
}

export const RING_ACTIVE = 30;

/**
 * Whether the glyph under the cursor is active. The cursor sits anywhere on the icon, so the best ring
 * centre is searched within 2.2% of the screen height around it (a neighbouring cell is 7% away).
 * `px` is an RGBA crop, (cx, cy) the cursor inside it, `gameH` the game image's height in those pixels.
 */
export function glyphActiveAt(px: Uint8ClampedArray, w: number, h: number, cx: number, cy: number, gameH: number): boolean {
  const reach = Math.round(0.022 * gameH);
  const step = Math.max(1, Math.round(gameH / 360));
  let best = 0;
  for (let y = cy - reach; y <= cy + reach; y += step)
    for (let x = cx - reach; x <= cx + reach; x += step) best = Math.max(best, ringScore(px, w, h, x, y, gameH));
  return best >= RING_ACTIVE;
}
