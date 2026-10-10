// Skill-bar check: match the 6 HUD skill icons against the build's official
// skill icons (same artwork) with normalised cross-correlation. Prototype on the
// user's screen: equipped skills scored 0.85–0.94, non-equipped ≤ 0.62.
import { create } from "zustand";
import { http } from "./http";
import { captureRegion } from "./native";
import { getActiveVariant } from "./store";
import type { SkillBarEntry } from "./types";

const ICON_FRAC = 0.044; // HUD skill icon size as a fraction of game height (1440p: ~64px)
const WORK_PX = 24; // match at ~24px icons
const MATCH_MIN = 0.75;
// HUD skill bar search area, as fractions of the game window (bottom centre)
const REGION = { x0: 0.42, x1: 0.58, y0: 0.88, y1: 0.99 };

export interface SkillBarResult {
  at: number;
  /** build skills found on the bar, in key order */
  onBar: { slug: string; name: string; score: number; x: number }[];
  /** build skills not on the bar */
  missing: SkillBarEntry[];
  ok: boolean;
  error?: string;
}

export const useSkillBar = create<{ last: SkillBarResult | null }>(() => ({ last: null }));

const refCache = new Map<string, Float32Array[]>(); // slug → templates per scale

async function loadImage(src: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = src;
  await img.decode();
  return img;
}

/** Fetch via the Tauri HTTP plugin so the canvas isn't tainted by cross-origin images. */
async function iconDataUrl(url: string): Promise<string> {
  const r = await http(url, { timeoutMs: 15000 });
  const buf = new Uint8Array(await r.arrayBuffer());
  let bin = "";
  for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
  return `data:${r.headers.get("content-type") ?? "image/webp"};base64,${btoa(bin)}`;
}

function grayOf(img: CanvasImageSource, sx: number, sy: number, sw: number, sh: number, w: number, h: number): Float32Array {
  const c = document.createElement("canvas");
  c.width = w;
  c.height = h;
  const ctx = c.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(img, sx, sy, sw, sh, 0, 0, w, h);
  const d = ctx.getImageData(0, 0, w, h).data;
  const g = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) g[i] = 0.299 * d[i * 4] + 0.587 * d[i * 4 + 1] + 0.114 * d[i * 4 + 2];
  return g;
}

async function templates(s: SkillBarEntry): Promise<Float32Array[]> {
  const hit = refCache.get(s.slug);
  if (hit) return hit;
  if (!s.icon) return [];
  const img = await loadImage(await iconDataUrl(s.icon));
  const c = Math.round(img.width * 0.1); // inner 80%: the HUD frame differs from the web icon border
  const out = [0.85, 1, 1.15].map((k) => {
    const n = Math.max(8, Math.round(WORK_PX * k * 0.8));
    return grayOf(img, c, c, img.width - 2 * c, img.height - 2 * c, n, n);
  });
  refCache.set(s.slug, out);
  return out;
}

function nccBest(R: Float32Array, rw: number, rh: number, T: Float32Array, n: number) {
  let mean = 0;
  for (const v of T) mean += v;
  mean /= T.length;
  let tn = 0;
  const Tz = new Float32Array(T.length);
  for (let i = 0; i < T.length; i++) {
    Tz[i] = T[i] - mean;
    tn += Tz[i] * Tz[i];
  }
  tn = Math.sqrt(tn) + 1e-6;
  let best = -1,
    bx = 0;
  for (let y = 0; y + n <= rh; y++) {
    for (let x = 0; x + n <= rw; x++) {
      let pm = 0;
      for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) pm += R[(y + j) * rw + x + i];
      pm /= n * n;
      let num = 0,
        pn = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const p = R[(y + j) * rw + x + i] - pm;
          num += p * Tz[j * n + i];
          pn += p * p;
        }
      const c = num / (Math.sqrt(pn) * tn + 1e-6);
      if (c > best) {
        best = c;
        bx = x;
      }
    }
  }
  return { score: best, x: bx };
}

export async function scanSkillBar(gameRect: [number, number, number, number]): Promise<SkillBarResult> {
  const { variant } = getActiveVariant();
  const bar = variant?.skillBar ?? [];
  const [gx, gy, gw, gh] = gameRect;
  try {
    const rect = {
      x: Math.round(gx + REGION.x0 * gw),
      y: Math.round(gy + REGION.y0 * gh),
      w: Math.round((REGION.x1 - REGION.x0) * gw),
      h: Math.round((REGION.y1 - REGION.y0) * gh),
    };
    const cap = await captureRegion(rect, { maxEdge: 0, quality: 92 });
    const img = await loadImage(`data:image/jpeg;base64,${cap.image}`);
    const s = WORK_PX / (ICON_FRAC * gh);
    const rw = Math.max(1, Math.round(img.width * s));
    const rh = Math.max(1, Math.round(img.height * s));
    const R = grayOf(img, 0, 0, img.width, img.height, rw, rh);
    const onBar: SkillBarResult["onBar"] = [];
    const missing: SkillBarEntry[] = [];
    for (const sk of bar) {
      const ts = await templates(sk);
      let best = { score: -1, x: 0 };
      for (const T of ts) {
        const n = Math.round(Math.sqrt(T.length));
        const r = nccBest(R, rw, rh, T, n);
        if (r.score > best.score) best = r;
      }
      if (best.score >= MATCH_MIN) onBar.push({ slug: sk.slug, name: sk.name, score: best.score, x: best.x });
      else missing.push(sk);
    }
    onBar.sort((a, b) => a.x - b.x);
    // HUD hidden (inventory/map/menus open)? then nothing matches — don't report that as "missing"
    if (onBar.length < 2 && bar.length >= 4) return { at: Date.now(), onBar, missing: [], ok: false, error: "hud-hidden" };
    const res: SkillBarResult = { at: Date.now(), onBar, missing, ok: missing.length === 0 };
    useSkillBar.setState({ last: res });
    return res;
  } catch (e) {
    const res: SkillBarResult = { at: Date.now(), onBar: [], missing: [], ok: false, error: String(e) };
    useSkillBar.setState({ last: res });
    return res;
  }
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
