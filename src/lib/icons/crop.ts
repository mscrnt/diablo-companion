// Where the item's picture is in a tooltip: the top-right corner, inside the frame just right of
// the text column. The same square the test-mode icon log has taken since 2026-10-12, so the
// pictures that measured this feature are the pictures it sees in play.
//
// Stop at that frame: with the comparison open, the equipped item's tooltip (and its art) starts
// right after it, and a wider square caught both items' art.
import type { Rect } from "./types";

/**
 * How much of that square to throw away before the picture is embedded. The square is generous on
 * purpose, so it catches the whole picture at any resolution, which means it also catches the
 * tooltip's frame and a strip of the panel behind it, while the library's art is the bare sprite.
 * Trimming 5% off each side lines the two framings up: measured on 187 real tooltip crops, top-1 by
 * the picture alone went from 52% to 54% (at 10% and more it starts cutting the picture).
 */
export const INSET = 0.05;

/**
 * An item you wear shows "EQUIPPED" in a bar above its art, which pushes the picture down by about a fifth of
 * the tooltip's width (measured on the 2026-10-25 crops of The Undercrown, Deathgrip and Bloodless Scream, where
 * the square caught the bar and only the top of the art). `artBox` moves the box to match.
 */
export const EQUIPPED_DROP = 0.21;
export const artBox = (box: Rect, equipped?: boolean): Rect => (equipped ? { ...box, y: box.y + Math.round(box.w * EQUIPPED_DROP) } : box);

/**
 * The art square in screen pixels, from the tooltip's box in screen pixels. The untrimmed one: the
 * test-mode icon log keeps taking this, so its pictures stay comparable between versions.
 */
export function artSquare(box: Rect): Rect {
  const side = Math.round(box.w * 0.5);
  const right = box.x + box.w + Math.round(box.w * 0.05);
  return { x: right - side, y: Math.round(box.y - box.w * 0.12), w: side, h: side };
}

/**
 * The trimmed art square in the pixels of a crop image: `region` is the crop's screen rectangle and
 * `imgW`/`imgH` the decoded image's size (the capture is downscaled to maxEdge). Null when the
 * square isn't fully inside the crop, so a half picture never becomes a vector.
 */
export function artInCrop(box: Rect, region: Rect, imgW: number, imgH: number): Rect | null {
  if (!region.w || !region.h) return null;
  const s = artSquare(box);
  const sx = imgW / region.w;
  const sy = imgH / region.h;
  const x = Math.round((s.x - region.x + s.w * INSET) * sx);
  const y = Math.round((s.y - region.y + s.h * INSET) * sy);
  const w = Math.round(s.w * (1 - 2 * INSET) * sx);
  const h = Math.round(s.h * (1 - 2 * INSET) * sy);
  if (w < 24 || h < 24) return null; // too small to tell anything from
  if (x < 0 || y < 0 || x + w > imgW || y + h > imgH) return null;
  return { x, y, w, h };
}
