// Cheap local image utilities: perceptual hashes for "scene" watchers and
// pillarbox (black bar) detection so overlay widgets can dock outside the game image.

async function decode(b64: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
  await img.decode();
  return img;
}

function gray(img: HTMLImageElement, w: number, h: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const out = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) out[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return out;
}

/** 128-bit difference hash (17x8 gradient → 16x8 bits) as hex. */
export async function dHash(b64: string): Promise<string> {
  const img = await decode(b64);
  const W = 17,
    H = 8;
  const g = gray(img, W, H);
  let bits = "";
  for (let y = 0; y < H; y++) for (let x = 0; x < W - 1; x++) bits += g[y * W + x] < g[y * W + x + 1] ? "1" : "0";
  let hex = "";
  for (let i = 0; i < bits.length; i += 4) hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  return hex;
}

/** Also capture overall brightness — dHash alone can't tell "all black" from "all white". */
export async function sceneSignature(b64: string): Promise<{ hash: string; luma: number }> {
  const img = await decode(b64);
  const g = gray(img, 16, 9);
  const luma = g.reduce((a, b) => a + b, 0) / g.length;
  return { hash: await dHash(b64), luma };
}

export function hamming(a: string, b: string): number {
  if (!a || !b || a.length !== b.length) return 999;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    let x = parseInt(a[i], 16) ^ parseInt(b[i], 16);
    while (x) {
      d += x & 1;
      x >>= 1;
    }
  }
  return d;
}

/**
 * Find the game image inside a capture of the game window by measuring the
 * pillarbox/letterbox bars. Bars are PURE black (max luminance in the column ≈ 0),
 * while even dark dungeon edges have a few brighter pixels. Bars are symmetric,
 * so we take the wider side (an overlay or stray UI on one side can't shrink it).
 * Returns null when the frame is unusable (e.g. an all-black loading screen).
 */
export async function detectPillarbox(b64: string): Promise<{ left: number; right: number; top: number; bottom: number } | null> {
  const img = await decode(b64);
  const W = 640;
  const H = Math.max(1, Math.round((img.height / img.width) * W));
  const g = gray(img, W, H);
  const BLACK = 10;
  const colBlack = (x: number) => {
    for (let y = 0; y < H; y += 2) if (g[y * W + x] > BLACK) return false;
    return true;
  };
  const rowBlack = (y: number) => {
    for (let x = 0; x < W; x += 2) if (g[y * W + x] > BLACK) return false;
    return true;
  };
  let l = 0;
  while (l < W / 2 && colBlack(l)) l++;
  let r = 0;
  while (r < W / 2 && colBlack(W - 1 - r)) r++;
  let t = 0;
  while (t < H / 2 && rowBlack(t)) t++;
  let b = 0;
  while (b < H / 2 && rowBlack(H - 1 - b)) b++;
  const bar = Math.max(l, r) / W;
  const lbar = Math.max(t, b) / H;
  if (bar > 0.3 || lbar > 0.3) return null; // mostly black frame — try again later
  return { left: bar, right: 1 - bar, top: lbar, bottom: 1 - lbar };
}

export type Bullet = "greater" | "tempered" | "enchanted" | "masterwork" | "normal" | "none";

/**
 * Classify the little icon left of each tooltip stat line by colour (measured on real
 * tooltips): greater = large orange/peach star, tempered = large pale-white glyph,
 * enchanted = blue ring, normal = small grey diamond.
 * `lines` are in the crop image's pixel space.
 */
export async function classifyBullets(cropB64: string, lines: { x: number; y: number; w: number; h: number }[]): Promise<Bullet[]> {
  const img = await decode(cropB64);
  const c = document.createElement("canvas");
  c.width = img.width;
  c.height = img.height;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, 0, 0);
  return lines.map((l) => {
    const h = Math.max(8, l.h);
    const x0 = Math.max(0, Math.round(l.x - 1.7 * h));
    const x1 = Math.max(0, Math.round(l.x - 0.15 * h));
    const y0 = Math.max(0, Math.round(l.y - 0.1 * h));
    const y1 = Math.min(img.height, Math.round(l.y + 1.1 * h));
    if (x1 - x0 < 4 || y1 - y0 < 4) return "none";
    const d = ctx.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    let bright = 0,
      orange = 0,
      blue = 0,
      white = 0;
    for (let i = 0; i < d.length; i += 4) {
      const r = d[i] / 255,
        g = d[i + 1] / 255,
        b = d[i + 2] / 255;
      const max = Math.max(r, g, b),
        min = Math.min(r, g, b);
      if (max <= 0.45) continue;
      bright++;
      const s = max === 0 ? 0 : (max - min) / max;
      let hue = 0;
      if (max !== min) {
        if (max === r) hue = 60 * (((g - b) / (max - min)) % 6);
        else if (max === g) hue = 60 * ((b - r) / (max - min) + 2);
        else hue = 60 * ((r - g) / (max - min) + 4);
      }
      if (hue < 0) hue += 360;
      if (hue > 10 && hue < 50 && s > 0.3) orange++;
      if (hue > 180 && hue < 290 && s > 0.3) blue++;
      if (s < 0.22 && max > 0.7) white++;
    }
    const area = (x1 - x0) * (y1 - y0);
    if (!bright) return "none";
    const fb = bright / area;
    // blue family: small ring = enchanted (Occultist); big purple-blue square = masterwork crit landed here
    if (blue / bright > 0.5) return fb > 0.18 ? "masterwork" : "enchanted";
    if (fb > 0.2 && orange / bright > 0.12) return "greater";
    if (fb > 0.2 && orange / bright < 0.05 && white / bright > 0.5) return "tempered";
    if (fb > 0.04) return "normal";
    return "none";
  });
}
