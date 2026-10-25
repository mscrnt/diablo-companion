// Every picture the model sees goes through here, so a library vector and a tooltip vector are
// comparable: fit the art inside a 224x224 square, keep its aspect ratio, composite it on the dark
// tooltip colour and fill the rest with the same colour (what the offline builder does with
// sharp's `resize({ fit: "contain", background: BG }).flatten({ background: BG })`).
//
// The resampling is ours rather than the canvas's, so the squares don't change with the webview:
// an area average going down (icons are bigger than 224 only rarely), bilinear going up.
import { BG, SIZE } from "./types";

/** Composite RGBA over the letterbox colour: the art's own transparent edges become BG. */
function flatten(rgba: Uint8Array, n: number): Uint8Array {
  const out = new Uint8Array(n * 3);
  for (let i = 0; i < n; i++) {
    const a = rgba[i * 4 + 3] / 255;
    out[i * 3] = Math.round(rgba[i * 4] * a + BG.r * (1 - a));
    out[i * 3 + 1] = Math.round(rgba[i * 4 + 1] * a + BG.g * (1 - a));
    out[i * 3 + 2] = Math.round(rgba[i * 4 + 2] * a + BG.b * (1 - a));
  }
  return out;
}

/** Bilinear sample of an RGB image at (fx, fy) in source pixels. */
function bilinear(src: Uint8Array, w: number, h: number, fx: number, fy: number, out: Uint8Array, at: number) {
  const x0 = Math.min(w - 1, Math.max(0, Math.floor(fx)));
  const y0 = Math.min(h - 1, Math.max(0, Math.floor(fy)));
  const x1 = Math.min(w - 1, x0 + 1);
  const y1 = Math.min(h - 1, y0 + 1);
  const tx = Math.min(1, Math.max(0, fx - x0));
  const ty = Math.min(1, Math.max(0, fy - y0));
  for (let c = 0; c < 3; c++) {
    const a = src[(y0 * w + x0) * 3 + c] * (1 - tx) + src[(y0 * w + x1) * 3 + c] * tx;
    const b = src[(y1 * w + x0) * 3 + c] * (1 - tx) + src[(y1 * w + x1) * 3 + c] * tx;
    out[at + c] = Math.round(a * (1 - ty) + b * ty);
  }
}

/** Average every source pixel that falls in the destination pixel's box. */
function boxAverage(src: Uint8Array, w: number, h: number, dw: number, dh: number): Uint8Array {
  const out = new Uint8Array(dw * dh * 3);
  for (let y = 0; y < dh; y++) {
    const y0 = Math.floor((y * h) / dh);
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * h) / dh));
    for (let x = 0; x < dw; x++) {
      const x0 = Math.floor((x * w) / dw);
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * w) / dw));
      let r = 0,
        g = 0,
        b = 0;
      for (let sy = y0; sy < y1; sy++)
        for (let sx = x0; sx < x1; sx++) {
          const s = (sy * w + sx) * 3;
          r += src[s];
          g += src[s + 1];
          b += src[s + 2];
        }
      const n = (y1 - y0) * (x1 - x0);
      const d = (y * dw + x) * 3;
      out[d] = Math.round(r / n);
      out[d + 1] = Math.round(g / n);
      out[d + 2] = Math.round(b / n);
    }
  }
  return out;
}

/**
 * An RGBA picture as the 224x224x3 RGB square the model takes. `w`/`h` are the picture's size;
 * the result is always SIZE x SIZE with the art centred and the rest the letterbox colour.
 */
export function letterbox(rgba: Uint8Array, w: number, h: number): Uint8Array {
  const flat = flatten(rgba, w * h);
  const scale = Math.min(SIZE / w, SIZE / h);
  const dw = Math.max(1, Math.round(w * scale));
  const dh = Math.max(1, Math.round(h * scale));
  const small = scale < 1 ? boxAverage(flat, w, h, dw, dh) : null;
  const out = new Uint8Array(SIZE * SIZE * 3);
  for (let i = 0; i < SIZE * SIZE; i++) {
    out[i * 3] = BG.r;
    out[i * 3 + 1] = BG.g;
    out[i * 3 + 2] = BG.b;
  }
  const ox = (SIZE - dw) >> 1;
  const oy = (SIZE - dh) >> 1;
  for (let y = 0; y < dh; y++)
    for (let x = 0; x < dw; x++) {
      const at = ((y + oy) * SIZE + x + ox) * 3;
      if (small) {
        const s = (y * dw + x) * 3;
        out[at] = small[s];
        out[at + 1] = small[s + 1];
        out[at + 2] = small[s + 2];
      } else {
        // sample centres, so the edges don't stretch to the corners
        bilinear(flat, w, h, (x + 0.5) / scale - 0.5, (y + 0.5) / scale - 0.5, out, at);
      }
    }
  return out;
}

/** The square as the model's input tensor: NCHW float32, (v / 255 - 0.5) / 0.5 (SigLIP's mean/std). */
export function pixelValues(square: Uint8Array): Float32Array {
  const n = SIZE * SIZE;
  const out = new Float32Array(3 * n);
  for (let i = 0; i < n; i++)
    for (let c = 0; c < 3; c++) out[c * n + i] = (square[i * 3 + c] / 255 - 0.5) / 0.5;
  return out;
}

/** L2-normalise in place and return it, so every vector is a unit vector and a dot product is a cosine. */
export function l2(v: Float32Array): Float32Array {
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}
