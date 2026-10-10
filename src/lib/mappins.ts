// Pins on the in-game map, from screen capture only.
//
// When the map is open, the waypoint icons on screen are cyan glyphs at known world
// positions (src/generated/map-pois.json). Detecting them and fitting
//     frame px = s · (u, v) + t
// (u, v = the map-art projection from docs/research/map-data.md; orientation is fixed:
// screen-right is +u, screen-down is +v, never mirrored or rotated) tells us the map's
// pan and zoom. Every other POI is then projected through the same fit.
//
// Extra anchors: dungeon entrances are drawn as icons with a thick black
// outline. Near-black blobs near their predicted positions verify a fit, refine it,
// and stand in for waypoints when few are visible (zoomed in).
//
// Pure module: no DOM, no Tauri. The capture loop lives in mapPinsRunner.ts.
import poiData from "../generated/map-pois.json";
import type { MapPinGroup } from "./store";

// ---- data -----------------------------------------------------------------------------

export type PoiKind =
  | "waypoint"
  | "altar"
  | "tenet_of_akarat"
  | "chronicle_of_creation"
  | "journal"
  | "stronghold"
  | "dungeon"
  | "cellar"
  | "boss_dungeon"
  | "undercity"
  | "side_quest"
  | "helltide_chest";

export interface Poi {
  k: PoiKind;
  n?: string;
  r: string;
  x: number;
  y: number;
  id: string;
  /** journal part number */
  p?: number;
  /** approximate position (side quests) */
  a?: number;
  /** helltide chest tier */
  t?: string;
}

export const POIS = (poiData as { pois: Poi[] }).pois;

const S2 = 6144 * Math.SQRT2;
/** World x/y → map-art (u, v), 0..1 over the 4096 px map art. */
export const toUv = (p: { x: number; y: number }): [number, number] => [2560 / 4096 + (p.y - p.x) / S2, 2212 / 4096 + (p.x + p.y) / S2];

export const WAYPOINTS = POIS.filter((p) => p.k === "waypoint");
export const WAYPOINT_UV = WAYPOINTS.map(toUv);
/**
 * Dungeon entrances: black-outlined icons the map always shows (cellars and altars only
 * appear once found), used as secondary anchors.
 */
export const ICON_POIS = POIS.filter((p) => p.k === "dungeon" || p.k === "boss_dungeon");
export const ICON_UV = ICON_POIS.map(toUv);

// ---- frames and blobs -----------------------------------------------------------------

export interface Frame {
  /** RGBA, row-major */
  data: Uint8ClampedArray | Uint8Array;
  width: number;
  height: number;
}

export interface Blob {
  x: number;
  y: number;
  /** pixel count */
  n: number;
  w: number;
  h: number;
}

export interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Cyan waypoint glyph: hue about 175–205°, saturation > 0.3, value > 0.5. */
export function isCyan(r: number, g: number, b: number): boolean {
  const max = g > b ? g : b;
  if (max < 128 || r >= max) return false;
  const min = r < g ? (r < b ? r : b) : g < b ? g : b;
  const d = max - min;
  if (d < 0.3 * max) return false;
  // hue: max = g → 60·((b − r)/d + 2) ∈ [175, 180] ⇔ (b − r)/d ≥ 0.9167
  //      max = b → 60·((r − g)/d + 4) ∈ [180, 205] ⇔ (g − r)/d ≥ 0.5833
  return max === g ? b - r >= 0.9167 * d : g - r >= 0.5833 * d;
}

/** Icon outline: near black. */
export const isInk = (r: number, g: number, b: number) => r < 46 && g < 46 && b < 46;

interface BlobLimits {
  minBox: number;
  maxBox: number;
  minN: number;
  maxAspect: number;
  /** max fraction of the bounding box that is filled */
  maxFill: number;
}

/**
 * Connected components of a mask (8-neighbours plus 2-px orthogonal bridges, so a
 * glyph broken by a 1-px gap stays whole), filtered by size and shape.
 */
function components(mask: Uint8Array, W: number, H: number, lim: BlobLimits): Blob[] {
  const out: Blob[] = [];
  const stack = new Int32Array(W * H > 1 << 20 ? 1 << 20 : W * H);
  const NB = [1, -1, W, -W, W + 1, W - 1, -W + 1, -W - 1, 2, -2, 2 * W, -2 * W];
  const DX = [1, -1, 0, 0, 1, -1, 1, -1, 2, -2, 0, 0];
  for (let p0 = 0; p0 < W * H; p0++) {
    if (mask[p0] !== 1) continue;
    mask[p0] = 2;
    let sp = 0;
    stack[sp++] = p0;
    let n = 0, sx = 0, sy = 0, x0 = W, x1 = 0, y0 = H, y1 = 0;
    let big = false;
    while (sp) {
      const q = stack[--sp];
      const qx = q % W, qy = (q - qx) / W;
      n++;
      sx += qx;
      sy += qy;
      if (qx < x0) x0 = qx;
      if (qx > x1) x1 = qx;
      if (qy < y0) y0 = qy;
      if (qy > y1) y1 = qy;
      for (let k = 0; k < 12; k++) {
        const nx = qx + DX[k];
        if (nx < 0 || nx >= W) continue;
        const nq = q + NB[k];
        if (nq < 0 || nq >= W * H || mask[nq] !== 1) continue;
        mask[nq] = 2;
        if (sp < stack.length) stack[sp++] = nq;
        else big = true;
      }
    }
    const w = x1 - x0 + 1, h = y1 - y0 + 1;
    if (big || n < lim.minN || w < lim.minBox || h < lim.minBox || w > lim.maxBox || h > lim.maxBox) continue;
    if (w > h * lim.maxAspect || h > w * lim.maxAspect || n > lim.maxFill * w * h) continue;
    out.push({ x: sx / n, y: sy / n, n, w, h });
  }
  return out;
}

export interface Detection {
  /** cyan waypoint glyph candidates */
  waypoints: Blob[];
  /** black-outlined icon candidates (dungeons, cellars, everything else with an outline) */
  icons: Blob[];
}

/**
 * Find waypoint glyphs and outlined icons inside `roi` (frame px).
 * `k` = game image height / 1440: sizes are tuned on 1440p captures and scale with it.
 */
export function detect(f: Frame, k: number, roi: Box = { x0: 0, y0: 0, x1: f.width, y1: f.height }): Detection {
  const W = f.width, H = f.height, d = f.data;
  const cyan = new Uint8Array(W * H);
  const ink = new Uint8Array(W * H);
  const x0 = Math.max(0, Math.floor(roi.x0)), x1 = Math.min(W, Math.ceil(roi.x1));
  const y0 = Math.max(0, Math.floor(roi.y0)), y1 = Math.min(H, Math.ceil(roi.y1));
  for (let y = y0; y < y1; y++) {
    let i = (y * W + x0) * 4;
    for (let x = x0; x < x1; x++, i += 4) {
      const r = d[i], g = d[i + 1], b = d[i + 2];
      if (r < 46 && g < 46 && b < 46) ink[y * W + x] = 1;
      else if (b > 127 || g > 127) {
        if (isCyan(r, g, b)) cyan[y * W + x] = 1;
      }
    }
  }
  const waypoints = components(cyan, W, H, {
    minBox: Math.max(4, 12 * k),
    maxBox: 95 * k,
    minN: Math.max(6, 35 * k * k),
    maxAspect: 1.7,
    maxFill: 0.95,
  });
  const icons = components(ink, W, H, {
    minBox: Math.max(5, 16 * k),
    maxBox: 80 * k,
    minN: Math.max(8, 40 * k * k),
    maxAspect: 1.9,
    maxFill: 0.75,
  });
  return { waypoints, icons };
}

// ---- map chrome -------------------------------------------------------------------------

/** Fraction of near-black pixels in a row, sampled beside the centre (the centre has HUD boxes). */
function rowDark(f: Frame, y: number, gx0: number, gx1: number): number {
  const W = f.width, d = f.data, gw = gx1 - gx0;
  const step = Math.max(1, Math.floor(gw / 400));
  let n = 0, m = 0;
  for (const [a, b] of [[0.12, 0.3], [0.7, 0.88]]) {
    for (let x = Math.floor(gx0 + gw * a); x < gx0 + gw * b; x += step) {
      const i = (y * W + x) * 4;
      if (d[i] + d[i + 1] + d[i + 2] < 150) n++;
      m++;
    }
  }
  return m ? n / m : 0;
}

export interface MapArea extends Box {
  /** the dark nav bar was found across the top (the map, or another full-screen menu, is open) */
  chrome: boolean;
  /** HUD boxes drawn over the map (season header, Whispers bar, event panel): no pins, no anchors */
  hud: Box[];
}

/**
 * HUD boxes over the map at 1440p, as [centre-relative or left-edge x0, y0, x1, y1] in units of
 * the image height, with the inner part used to test that the box is there (mostly dark).
 */
const HUD: { anchor: "centre" | "left"; box: [number, number, number, number]; test: [number, number, number, number] }[] = [
  // season header and its "View Season Rank" tab
  { anchor: "centre", box: [-0.47, 0.055, 0.47, 0.14], test: [-0.42, 0.07, 0.42, 0.125] },
  { anchor: "centre", box: [-0.11, 0.13, 0.11, 0.175], test: [-0.42, 0.07, 0.42, 0.125] },
  // seasonal progress bar above the hint bar (Whispers of the Dead)
  { anchor: "centre", box: [-0.4, 0.89, 0.4, 0.95], test: [-0.35, 0.905, 0.35, 0.94] },
  // event panel on the left (Infernal Hordes and the like)
  { anchor: "left", box: [0.02, 0.65, 0.47, 0.9], test: [0.06, 0.67, 0.42, 0.885] },
];

function hudBoxes(f: Frame, gx0: number, gx1: number): Box[] {
  const H = f.height, cx = (gx0 + gx1) / 2;
  const toBox = (anchor: "centre" | "left", [a, b, c, d]: number[]): Box => {
    const ox = anchor === "centre" ? cx : gx0;
    return { x0: ox + a * H, y0: b * H, x1: ox + c * H, y1: d * H };
  };
  const out: Box[] = [];
  for (const h of HUD) {
    const t = toBox(h.anchor, h.test);
    let dark = 0, m = 0;
    const step = Math.max(1, Math.round(H / 360));
    for (let y = Math.floor(t.y0); y < t.y1; y += step)
      for (let x = Math.max(0, Math.floor(t.x0)); x < Math.min(f.width, t.x1); x += step) {
        const i = (y * f.width + x) * 4;
        if (f.data[i] + f.data[i + 1] + f.data[i + 2] < 150) dark++;
        m++;
      }
    if (m && dark / m > 0.7) out.push(toBox(h.anchor, h.box));
  }
  return out;
}

/**
 * The map's own UI: the dark nav bar across the top and the hint bar across the bottom.
 * Measured on the frame (a contiguous run of mostly dark rows from the edge), within sane
 * limits; falls back to the bands seen at 1440p (top 6.25 %, bottom 5.6 % of the height).
 */
/** A run of mostly dark rows from `from` toward `to`: the last dark row, or -1. */
function darkBand(f: Frame, from: number, to: number, dir: 1 | -1, gx0: number, gx1: number): number {
  let last = -1;
  for (let y = from; dir > 0 ? y < to : y > to; y += dir) {
    const v = rowDark(f, y, gx0, gx1);
    if (v > 0.85) last = y;
    else if (v < 0.6) break;
  }
  return last;
}

/**
 * Is the dark nav bar of the full-screen menus (map, collections…) across the top?
 * `H` is the image height in frame px; the frame may be just the top band of it.
 */
export function navBar(f: Frame, H = f.height, gx0 = 0, gx1 = f.width): number {
  return darkBand(f, Math.floor(H * 0.02), Math.min(f.height, Math.floor(H * 0.1)), 1, gx0, gx1);
}

export function mapArea(f: Frame, gx0 = 0, gx1 = f.width): MapArea {
  const H = f.height;
  const t = navBar(f, H, gx0, gx1);
  const b = darkBand(f, Math.ceil(H * 0.98), Math.floor(H * 0.9), -1, gx0, gx1);
  const top = t >= 0 ? t + 1 : Math.round(H * 0.0625);
  const bottom = b >= 0 ? b : Math.round(H * 0.944);
  // a little margin so pins don't touch the bars; the map's side panel strip sits at the right edge
  const m = H * 0.008;
  return { x0: gx0 + m, y0: top + m, x1: gx1 - (gx1 - gx0) * 0.022, y1: bottom - m, chrome: t >= Math.floor(H * 0.04), hud: hudBoxes(f, gx0, gx1) };
}

/** The nav bar test on a capture of just the top band (`frac` of the image height): cheap "is a menu open?". */
export const navBarInBand = (f: Frame, frac: number) => navBar(f, f.height / frac) >= Math.floor((f.height / frac) * 0.04);

// ---- registration -------------------------------------------------------------------------

export interface Xf {
  /** frame px per map-art unit */
  s: number;
  tx: number;
  ty: number;
}

export const project = (xf: Xf, uv: [number, number]): [number, number] => [xf.s * uv[0] + xf.tx, xf.s * uv[1] + xf.ty];

/** Uniform grid over blobs for nearest-neighbour lookups. */
class Grid {
  private bins: (number[] | undefined)[];
  private cols: number;
  private rows: number;
  constructor(
    readonly pts: Blob[],
    private cell: number,
  ) {
    let mx = 1, my = 1;
    for (const p of pts) {
      if (p.x > mx) mx = p.x;
      if (p.y > my) my = p.y;
    }
    this.cols = Math.floor(mx / cell) + 1;
    this.rows = Math.floor(my / cell) + 1;
    this.bins = new Array(this.cols * this.rows);
    pts.forEach((p, i) => {
      const k = Math.floor(p.y / cell) * this.cols + Math.floor(p.x / cell);
      (this.bins[k] ??= []).push(i);
    });
  }
  /** index of the nearest point within `r` (r ≤ cell size), or -1; its distance in `dist` */
  dist = 0;
  find(x: number, y: number, r: number): number {
    const cx = Math.floor(x / this.cell), cy = Math.floor(y / this.cell);
    let best = -1, bd = r * r;
    for (let yy = Math.max(0, cy - 1); yy <= Math.min(this.rows - 1, cy + 1); yy++)
      for (let xx = Math.max(0, cx - 1); xx <= Math.min(this.cols - 1, cx + 1); xx++) {
        const c = this.bins[yy * this.cols + xx];
        if (!c) continue;
        for (const i of c) {
          const p = this.pts[i];
          const dd = (p.x - x) * (p.x - x) + (p.y - y) * (p.y - y);
          if (dd <= bd) {
            bd = dd;
            best = i;
          }
        }
      }
    this.dist = Math.sqrt(bd);
    return best;
  }
  nearest(x: number, y: number, r: number): [number, number] {
    const i = this.find(x, y, r);
    return [i, this.dist];
  }
}

export interface Score {
  xf: Xf;
  /** waypoints whose predicted position is inside the map area */
  wpExpected: number;
  wpInliers: number;
  /** mean waypoint residual, frame px */
  wpErr: number;
  iconExpected: number;
  iconInliers: number;
  iconErr: number;
  /** matched pairs, for refinement: [uv, blob] */
  pairs: { uv: [number, number]; b: Blob; w: number }[];
}

const inside = (b: Box, x: number, y: number) => x >= b.x0 && x < b.x1 && y >= b.y0 && y < b.y1;
/** Inside the map area and not under a HUD box. */
export const visible = (a: Box & { hud?: Box[] }, x: number, y: number) => inside(a, x, y) && !a.hud?.some((h) => inside(h, x, y));

export interface Ctx {
  det: Detection;
  /** visible map area (frame px) */
  area: Box & { hud?: Box[] };
  /** game image height / 1440 */
  k: number;
  wpGrid: Grid;
  iconGrid: Grid;
  tolW: number;
  tolI: number;
}

export function makeCtx(det: Detection, area: Box & { hud?: Box[] }, k: number): Ctx {
  const tolW = 16 * k, tolI = 13 * k;
  const wps = det.waypoints.filter((b) => visible(area, b.x, b.y));
  const icons = det.icons.filter((b) => visible(area, b.x, b.y));
  // cells wide enough for the snap radius (2.5 × tolerance)
  return { det: { waypoints: wps, icons }, area, k, wpGrid: new Grid(wps, tolW * 2.5), iconGrid: new Grid(icons, tolI * 2.5), tolW, tolI };
}

/** How well a transform explains what's on screen: waypoints (strong) and outlined icons (weak). */
export function score(c: Ctx, xf: Xf, withIcons = true): Score {
  const sc: Score = { xf, wpExpected: 0, wpInliers: 0, wpErr: 0, iconExpected: 0, iconInliers: 0, iconErr: 0, pairs: [] };
  const usedW = new Set<number>();
  for (const uv of WAYPOINT_UV) {
    const [x, y] = project(xf, uv);
    if (!visible(c.area, x, y)) continue;
    sc.wpExpected++;
    const [i, dist] = c.wpGrid.nearest(x, y, c.tolW);
    if (i < 0 || usedW.has(i)) continue;
    usedW.add(i);
    sc.wpInliers++;
    sc.wpErr += dist;
    sc.pairs.push({ uv, b: c.det.waypoints[i], w: 1 });
  }
  if (sc.wpInliers) sc.wpErr /= sc.wpInliers;
  if (!withIcons) return sc;
  const usedI = new Set<number>();
  for (const uv of ICON_UV) {
    const [x, y] = project(xf, uv);
    if (!visible(c.area, x, y)) continue;
    sc.iconExpected++;
    const [i, dist] = c.iconGrid.nearest(x, y, c.tolI);
    if (i < 0 || usedI.has(i)) continue;
    usedI.add(i);
    sc.iconInliers++;
    sc.iconErr += dist;
    sc.pairs.push({ uv, b: c.det.icons[i], w: 0.35 });
  }
  if (sc.iconInliers) sc.iconErr /= sc.iconInliers;
  return sc;
}

/** Weighted least squares for s and t with the orientation fixed. */
export function refine(pairs: Score["pairs"]): Xf | null {
  let W = 0, mu = 0, mv = 0, mx = 0, my = 0;
  for (const p of pairs) {
    W += p.w;
    mu += p.w * p.uv[0];
    mv += p.w * p.uv[1];
    mx += p.w * p.b.x;
    my += p.w * p.b.y;
  }
  if (pairs.length < 2 || !W) return null;
  mu /= W;
  mv /= W;
  mx /= W;
  my /= W;
  let num = 0, den = 0;
  for (const p of pairs) {
    const du = p.uv[0] - mu, dv = p.uv[1] - mv;
    num += p.w * (du * (p.b.x - mx) + dv * (p.b.y - my));
    den += p.w * (du * du + dv * dv);
  }
  if (den <= 0) return null;
  const s = num / den;
  return { s, tx: mx - s * mu, ty: my - s * mv };
}

// zoom = s / game image height. The game's zoom levels are discrete; measured at 1440p
// (s ≈ 2793, 4530, 8490, 13450, 20300): 1.94, 3.15, 5.90, 9.34, 14.1.
export const ZOOM_LADDER = [1.9396, 3.1458, 5.8958, 9.34, 14.1];
export const ZOOM_MIN = 1.2;
export const ZOOM_MAX = 17;

/** Known pairs of waypoints, sorted by direction, for pair hypotheses. */
const WP_PAIRS = (() => {
  const out: { a: number; b: number; ang: number; len: number }[] = [];
  for (let a = 0; a < WAYPOINT_UV.length; a++)
    for (let b = 0; b < WAYPOINT_UV.length; b++) {
      if (a === b) continue;
      const du = WAYPOINT_UV[b][0] - WAYPOINT_UV[a][0], dv = WAYPOINT_UV[b][1] - WAYPOINT_UV[a][1];
      out.push({ a, b, ang: Math.atan2(dv, du), len: Math.hypot(du, dv) });
    }
  return out.sort((x, y) => x.ang - y.ang);
})();
const PAIR_ANG = Float64Array.from(WP_PAIRS.map((p) => p.ang));

function lowerBound(arr: Float64Array, v: number) {
  let lo = 0, hi = arr.length;
  while (lo < hi) {
    const m = (lo + hi) >> 1;
    if (arr[m] < v) lo = m + 1;
    else hi = m;
  }
  return lo;
}

/** Score a hypothesis by waypoints only (cheap), keeping the best few distinct ones. */
class TopK {
  items: { xf: Xf; inl: number; err: number }[] = [];
  constructor(private k: number) {}
  push(xf: Xf, inl: number, err: number) {
    const it = this.items;
    for (const o of it) {
      // same transform (within a couple of px over the frame)? keep the better
      if (Math.abs(o.xf.s - xf.s) / xf.s < 0.01 && Math.abs(o.xf.tx - xf.tx) < 6 && Math.abs(o.xf.ty - xf.ty) < 6) {
        if (inl > o.inl || (inl === o.inl && err < o.err)) Object.assign(o, { xf, inl, err });
        return;
      }
    }
    if (it.length < this.k) it.push({ xf, inl, err });
    else {
      let worst = 0;
      for (let i = 1; i < it.length; i++) if (it[i].inl < it[worst].inl || (it[i].inl === it[worst].inl && it[i].err > it[worst].err)) worst = i;
      const w = it[worst];
      if (inl > w.inl || (inl === w.inl && err < w.err)) it[worst] = { xf, inl, err };
    }
  }
}

function quickWp(c: Ctx, xf: Xf): [number, number] {
  let inl = 0, err = 0;
  for (const uv of WAYPOINT_UV) {
    const x = xf.s * uv[0] + xf.tx, y = xf.s * uv[1] + xf.ty;
    if (x < c.area.x0 || x >= c.area.x1 || y < c.area.y0 || y >= c.area.y1) continue;
    if (c.wpGrid.find(x, y, c.tolW) >= 0) {
      inl++;
      err += c.wpGrid.dist;
    }
  }
  return [inl, inl ? err / inl : 0];
}

/**
 * Hypotheses from pairs of waypoint blobs matched to pairs of known waypoints whose
 * direction agrees (orientation is fixed), within the sane zoom range.
 */
export function pairHypotheses(c: Ctx, H: number, top = 6): { xf: Xf; inl: number; err: number }[] {
  const B = c.det.waypoints;
  const best = new TopK(top);
  const sMin = ZOOM_MIN * H, sMax = ZOOM_MAX * H;
  for (let i = 0; i < B.length; i++)
    for (let j = i + 1; j < B.length; j++) {
      const dx = B[j].x - B[i].x, dy = B[j].y - B[i].y;
      const dist = Math.hypot(dx, dy);
      if (dist < 25 * c.k) continue;
      const phi = Math.atan2(dy, dx);
      // centroid noise of ~2 px at each end
      const tol = Math.min(0.12, Math.max(0.015, (3 * c.k) / dist));
      const ranges: [number, number][] = [[phi - tol, phi + tol]];
      if (phi - tol < -Math.PI) ranges.push([phi - tol + 2 * Math.PI, Math.PI]);
      if (phi + tol > Math.PI) ranges.push([-Math.PI, phi + tol - 2 * Math.PI]);
      for (const [lo, hi] of ranges) {
        for (let q = lowerBound(PAIR_ANG, lo); q < WP_PAIRS.length && WP_PAIRS[q].ang <= hi; q++) {
          const kp = WP_PAIRS[q];
          const s = dist / kp.len;
          if (s < sMin || s > sMax) continue;
          const A = WAYPOINT_UV[kp.a];
          const xf = { s, tx: B[i].x - s * A[0], ty: B[i].y - s * A[1] };
          const [inl, err] = quickWp(c, xf);
          if (inl >= 2) best.push(xf, inl, err);
        }
      }
    }
  return best.items;
}

/** Hypotheses from one waypoint blob + a known zoom level: the zoom fixes the scale, the blob the pan. */
export function zoomHypotheses(c: Ctx, H: number, zooms: number[], top = 6): { xf: Xf; inl: number; err: number }[] {
  const best = new TopK(top);
  for (const z of zooms) {
    const s = z * H;
    for (const b of c.det.waypoints)
      for (const uv of WAYPOINT_UV) {
        const xf = { s, tx: b.x - s * uv[0], ty: b.y - s * uv[1] };
        const [inl, err] = quickWp(c, xf);
        best.push(xf, inl, err);
      }
  }
  return best.items;
}

export type Verdict = "strong" | "ok" | "weak" | "none";

/** Is a zoom (s / image height) one of the known levels? */
export const onLadder = (z: number, zooms: number[], tol = 0.012) => zooms.some((q) => Math.abs(q - z) / q < tol);

/**
 * Confidence of a scored fit. Positive evidence (waypoints and dungeon icons where
 * predicted), negative evidence (predicted waypoints that aren't there) and the zoom
 * (the game's zoom levels are discrete) all count, so a chance alignment of a few cyan
 * blobs doesn't pass.
 *   strong: show it now · ok: show it once a second frame agrees (or it continues a
 *   track) · weak: only good enough to continue a track · none
 */
export function judge(sc: Score, k: number, zooms: number[]): Verdict {
  if (!(sc.xf.s > 0)) return "none";
  const z = sc.xf.s / (1440 * k);
  const ladder = onLadder(z, zooms);
  const wpRatio = sc.wpExpected ? sc.wpInliers / sc.wpExpected : 0;
  const iconRatio = sc.iconExpected ? sc.iconInliers / sc.iconExpected : 0;
  const errOk = sc.wpInliers > 0 && sc.wpErr <= 4.5 * k;
  const iconsGood = sc.iconInliers >= 6 && iconRatio >= 0.45;
  // many waypoints: unmistakable (zoomed out, many waypoints are too small to detect, so the ratio can be low).
  // Off the known zoom levels it's a frame mid zoom animation, or a resolution whose levels we haven't learned
  // yet: "ok" then, so it shows only once a second frame agrees (an animation never does).
  if (sc.wpInliers >= 6 && errOk && wpRatio >= 0.35) return ladder ? "strong" : "ok";
  // otherwise the zoom has to be a known level (this also drops frames mid zoom animation)
  if (!ladder) {
    // a zoom level not seen yet (zoomed far in, few waypoints): only with many dungeon icons, and "ok" at best
    if (sc.wpInliers >= 2 && sc.wpErr <= 3 * k && wpRatio >= 0.5 && sc.iconInliers >= 6 && iconRatio >= 0.75 && sc.iconErr <= 5 * k) return "ok";
    return "none";
  }
  if (sc.wpInliers >= 4 && errOk && wpRatio >= 0.5) return "strong";
  if (sc.wpInliers >= 3 && sc.wpErr <= 3 * k && wpRatio >= 0.5) return iconsGood ? "strong" : "ok";
  // zoomed far in: two waypoints plus the dungeon icons
  // (icon centroids are a little off: the outline includes the small chest badge on dungeon icons)
  const iconsOk = sc.iconInliers >= 3 && iconRatio >= 0.5 && sc.iconErr <= 6 * k;
  if (sc.wpInliers === 2 && sc.wpErr <= 3 * k && wpRatio >= 0.5 && iconsOk) return sc.iconInliers >= 4 ? "ok" : "weak";
  // no waypoints in view: dungeon icons alone, never enough to start pins on their own frame
  if (sc.wpInliers <= 1 && (sc.wpExpected === 0 || wpRatio >= 0.5) && sc.iconInliers >= 4 && iconRatio >= 0.6 && sc.iconErr <= 5 * k)
    return sc.iconInliers >= 6 ? "ok" : "weak";
  return "none";
}

const RANK: Record<Verdict, number> = { strong: 3, ok: 2, weak: 1, none: 0 };
export const rankOf = (v: Verdict) => RANK[v];

export interface FitResult {
  score: Score;
  verdict: Verdict;
  /** where the winning hypothesis came from */
  source: "pairs" | "zoom" | "icons" | "track";
}

function quickIcons(c: Ctx, xf: Xf, near: number[]): number {
  let inl = 0;
  for (const j of near) {
    const uv = ICON_UV[j];
    const x = xf.s * uv[0] + xf.tx, y = xf.s * uv[1] + xf.ty;
    if (x < c.area.x0 || x >= c.area.x1 || y < c.area.y0 || y >= c.area.y1) continue;
    if (c.iconGrid.find(x, y, c.tolI) >= 0) inl++;
  }
  return inl;
}

const nearCache = new Map<number, number[][]>();
/** For each anchor icon, the icons within `reach` (map-art units) of it: the ones that can share the screen. */
function iconNeighbours(reach: number): number[][] {
  const key = Math.round(reach * 2000);
  let near = nearCache.get(key);
  if (!near) {
    near = ICON_UV.map((a) => {
      const out: number[] = [];
      for (let i = 0; i < ICON_UV.length; i++) if (Math.abs(a[0] - ICON_UV[i][0]) < reach && Math.abs(a[1] - ICON_UV[i][1]) < reach) out.push(i);
      const d = (i: number) => (a[0] - ICON_UV[i][0]) ** 2 + (a[1] - ICON_UV[i][1]) ** 2;
      return out.sort((x, y) => d(x) - d(y));
    });
    if (nearCache.size > 32) nearCache.clear();
    nearCache.set(key, near);
  }
  return near;
}

/** Zoomed in with few waypoints: one dungeon icon + a known zoom level fixes the fit. */
export function iconHypotheses(c: Ctx, H: number, zooms: number[], top = 4): { xf: Xf; inl: number; err: number }[] {
  const best = new TopK(top);
  for (const z of zooms) {
    if (z < 4.5) continue; // zoomed out, the icons are too small and too many
    const s = z * H;
    const near = iconNeighbours(Math.hypot(c.area.x1 - c.area.x0, c.area.y1 - c.area.y0) / s);
    for (const b of c.det.icons)
      for (let j = 0; j < ICON_UV.length; j++) {
        if (near[j].length < 3) continue;
        const uv = ICON_UV[j];
        const xf = { s, tx: b.x - s * uv[0], ty: b.y - s * uv[1] };
        // cheap pre-check: one of the closest neighbours (near[j][0] is j itself) has to be there too
        let hit = false;
        for (let q = 1, seen = 0; q < near[j].length && seen < 4 && !hit; q++) {
          const v = ICON_UV[near[j][q]];
          const x = s * v[0] + xf.tx, y = s * v[1] + xf.ty;
          if (x < c.area.x0 || x >= c.area.x1 || y < c.area.y0 || y >= c.area.y1) continue;
          seen++;
          hit = c.iconGrid.find(x, y, c.tolI) >= 0;
        }
        if (!hit) continue;
        const inl = quickIcons(c, xf, near[j]);
        if (inl >= 3) best.push(xf, inl, 0);
      }
  }
  return best.items;
}

/**
 * Best fit for one frame. `zooms` are known zoom levels (s / H); `prior` is a predicted
 * transform (previous fit plus the estimated pan), if any.
 */
export function registerFrame(c: Ctx, H: number, zooms: number[], prior?: Xf | null): FitResult | null {
  const cands: { xf: Xf; source: FitResult["source"] }[] = [];
  for (const h of pairHypotheses(c, H)) cands.push({ xf: h.xf, source: "pairs" });
  if (zooms.length && c.det.waypoints.length) for (const h of zoomHypotheses(c, H, zooms, 4)) cands.push({ xf: h.xf, source: "zoom" });
  if (zooms.length && c.det.waypoints.length < 2) for (const h of iconHypotheses(c, H, zooms)) cands.push({ xf: h.xf, source: "icons" });
  if (prior) cands.push({ xf: snap(c, prior), source: "track" });
  let best: FitResult | null = null;
  for (const cand of cands) {
    let sc = score(c, cand.xf);
    // refine on inliers (a free scale only when enough waypoints pin it; otherwise keep the zoom level)
    for (let it = 0; it < 2; it++) {
      const free = sc.wpInliers >= 3 || (cand.source === "pairs" && sc.wpInliers >= 2 && sc.iconInliers < 3);
      const pairs = cand.source === "pairs" && sc.wpInliers >= 2 && sc.wpInliers < 3 ? sc.pairs.filter((p) => p.w === 1) : sc.pairs;
      const r = free ? refine(pairs) : refineShift(pairs, cand.xf.s);
      if (!r || r.s < ZOOM_MIN * H || r.s > ZOOM_MAX * H) break;
      const next = score(c, r);
      if (better(next, sc, c.k, zooms)) sc = next;
      else break;
    }
    // few waypoints pin the scale poorly: snap it to the known zoom level it's on
    if (sc.wpInliers < 5) {
      const z = sc.xf.s / H;
      const q = zooms.find((l) => Math.abs(l - z) / l < 0.012);
      if (q && Math.abs(q - z) / q > 0.0005) {
        const r = refineShift(sc.pairs, q * H);
        if (r) {
          const next = score(c, r);
          if (RANK[judge(next, c.k, zooms)] >= RANK[judge(sc, c.k, zooms)] && next.wpInliers >= sc.wpInliers) sc = next;
        }
      }
    }
    const res: FitResult = { score: sc, verdict: judge(sc, c.k, zooms), source: cand.source };
    if (!best || better(res.score, best.score, c.k, zooms, res.verdict, best.verdict)) best = res;
  }
  return best;
}

/** Pull a predicted transform onto nearby anchors (the pan estimate can be a few px off after a big move). */
function snap(c: Ctx, xf: Xf): Xf {
  const pairs: Score["pairs"] = [];
  for (const uv of WAYPOINT_UV) {
    const [x, y] = project(xf, uv);
    if (!visible(c.area, x, y)) continue;
    const [i] = c.wpGrid.nearest(x, y, c.tolW * 2.5);
    if (i >= 0) pairs.push({ uv, b: c.det.waypoints[i], w: 1 });
  }
  for (const uv of ICON_UV) {
    const [x, y] = project(xf, uv);
    if (!visible(c.area, x, y)) continue;
    const [i] = c.iconGrid.nearest(x, y, c.tolI * 2.5);
    if (i >= 0) pairs.push({ uv, b: c.det.icons[i], w: 0.35 });
  }
  return (pairs.length && refineShift(pairs, xf.s)) || xf;
}

/** Least-squares translation only, scale fixed. */
function refineShift(pairs: Score["pairs"], s: number): Xf | null {
  let W = 0, tx = 0, ty = 0;
  for (const p of pairs) {
    W += p.w;
    tx += p.w * (p.b.x - s * p.uv[0]);
    ty += p.w * (p.b.y - s * p.uv[1]);
  }
  return W ? { s, tx: tx / W, ty: ty / W } : null;
}

function better(a: Score, b: Score, k: number, zooms: number[], va = judge(a, k, zooms), vb = judge(b, k, zooms)): boolean {
  if (RANK[va] !== RANK[vb]) return RANK[va] > RANK[vb];
  const pa = a.wpInliers * 3 + a.iconInliers, pb = b.wpInliers * 3 + b.iconInliers;
  if (pa !== pb) return pa > pb;
  return a.wpErr + a.iconErr * 0.3 < b.wpErr + b.iconErr * 0.3;
}

// ---- pan between frames (phase correlation) -----------------------------------------------

function fft1(re: Float64Array, im: Float64Array, n: number, off: number, stride: number, inv: boolean) {
  // iterative radix-2 on a strided view
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      const a = off + i * stride, b = off + j * stride;
      let t = re[a];
      re[a] = re[b];
      re[b] = t;
      t = im[a];
      im[a] = im[b];
      im[b] = t;
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang), wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1, ci = 0;
      for (let j = 0; j < len / 2; j++) {
        const a = off + (i + j) * stride, b = off + (i + j + len / 2) * stride;
        const xr = re[b] * cr - im[b] * ci, xi = re[b] * ci + im[b] * cr;
        re[b] = re[a] - xr;
        im[b] = im[a] - xi;
        re[a] += xr;
        im[a] += xi;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}

function fft2(re: Float64Array, im: Float64Array, W: number, H: number, inv: boolean) {
  for (let y = 0; y < H; y++) fft1(re, im, W, y * W, 1, inv);
  for (let x = 0; x < W; x++) fft1(re, im, H, x, W, inv);
}

export interface Thumb {
  /** grey levels, PW × PH (powers of two) */
  g: Float64Array;
  PW: number;
  PH: number;
  /** frame px per thumb px */
  f: number;
  /** frame px of the thumb's origin */
  ox: number;
  oy: number;
}

/** Downsampled grey copy of the map area, windowed, for phase correlation. */
export function thumb(fr: Frame, area: Box, PW = 256, PH = 128): Thumb {
  const aw = area.x1 - area.x0, ah = area.y1 - area.y0;
  const f = Math.max(aw / PW, ah / PH);
  const ox = area.x0 + (aw - PW * f) / 2, oy = area.y0 + (ah - PH * f) / 2;
  const g = new Float64Array(PW * PH);
  const step = Math.max(1, Math.floor(f / 2));
  let mean = 0, cnt = 0;
  for (let y = 0; y < PH; y++)
    for (let x = 0; x < PW; x++) {
      let s = 0, n = 0;
      const fx0 = Math.floor(ox + x * f), fy0 = Math.floor(oy + y * f);
      for (let yy = fy0; yy < fy0 + f; yy += step)
        for (let xx = fx0; xx < fx0 + f; xx += step) {
          if (xx < area.x0 || yy < area.y0 || xx >= area.x1 || yy >= area.y1) continue;
          const i = (yy * fr.width + xx) * 4;
          s += fr.data[i] * 0.3 + fr.data[i + 1] * 0.59 + fr.data[i + 2] * 0.11;
          n++;
        }
      // outside the map area: NaN for now, then the mean (so it adds nothing to the correlation)
      const v = n ? s / n : NaN;
      g[y * PW + x] = v;
      if (n) {
        mean += v;
        cnt++;
      }
    }
  mean /= cnt || 1;
  for (let i = 0; i < g.length; i++) if (Number.isNaN(g[i])) g[i] = mean;
  for (let y = 0; y < PH; y++) {
    const wy = 0.5 - 0.5 * Math.cos((2 * Math.PI * (y + 0.5)) / PH);
    for (let x = 0; x < PW; x++) {
      const wx = 0.5 - 0.5 * Math.cos((2 * Math.PI * (x + 0.5)) / PW);
      g[y * PW + x] = (g[y * PW + x] - mean) * wx * wy;
    }
  }
  return { g, PW, PH, f, ox, oy };
}

/**
 * Shift of `b` relative to `a` in frame px (content moved by dx, dy), with a peak
 * sharpness measure (peak over the mean of the correlation surface; > ~8 is reliable).
 */
export function phaseShift(a: Thumb, b: Thumb): { dx: number; dy: number; peak: number } | null {
  if (a.PW !== b.PW || a.PH !== b.PH || Math.abs(a.f - b.f) > 1e-6) return null;
  const { PW, PH } = a, N = PW * PH;
  const ar = Float64Array.from(a.g), ai = new Float64Array(N);
  const br = Float64Array.from(b.g), bi = new Float64Array(N);
  fft2(ar, ai, PW, PH, false);
  fft2(br, bi, PW, PH, false);
  // normalised cross-power spectrum
  for (let i = 0; i < N; i++) {
    const r = br[i] * ar[i] + bi[i] * ai[i];
    const im = bi[i] * ar[i] - br[i] * ai[i];
    const m = Math.hypot(r, im) || 1;
    ar[i] = r / m;
    ai[i] = im / m;
  }
  fft2(ar, ai, PW, PH, true);
  let bi0 = 0, bv = -Infinity, sum = 0;
  for (let i = 0; i < N; i++) {
    const v = ar[i];
    sum += Math.abs(v);
    if (v > bv) {
      bv = v;
      bi0 = i;
    }
  }
  const px = bi0 % PW, py = (bi0 - px) / PW;
  const at = (x: number, y: number) => ar[((y + PH) % PH) * PW + ((x + PW) % PW)];
  // sub-pixel peak (parabola through the neighbours)
  const sub = (l: number, c: number, r: number) => {
    const d = l - 2 * c + r;
    return d < 0 ? (0.5 * (l - r)) / d : 0;
  };
  let sx = px + sub(at(px - 1, py), bv, at(px + 1, py));
  let sy = py + sub(at(px, py - 1), bv, at(px, py + 1));
  if (sx > PW / 2) sx -= PW;
  if (sy > PH / 2) sy -= PH;
  return { dx: sx * a.f, dy: sy * a.f, peak: bv / (sum / N) };
}

// ---- tracker (hysteresis, zoom memory, pan tracking) --------------------------------------

export interface TrackOut {
  /** transform to draw pins with, or null (nothing confident) */
  xf: Xf | null;
  fit: FitResult | null;
  /** how this frame was resolved */
  how: "fit" | "pan" | "none" | "closed";
  pan?: { dx: number; dy: number; peak: number } | null;
}

/** A sharp phase-correlation peak; zoom changes and big scene changes give flat surfaces. */
const PAN_PEAK = 14;

/**
 * Per-frame state. Shows pins only from confident fits; an "ok" fit needs a second
 * agreeing frame (or a running track); across frames with too few anchors the fit is
 * carried by the estimated pan while the anchors on screen support it; anything else
 * clears the pins at once; zoom levels seen on two frames in a row are remembered.
 */
export class MapTracker {
  /** zoom levels (s / image height); seeded from 1440p captures, refined and extended at runtime */
  zooms: number[] = [...ZOOM_LADDER];
  private cur: Xf | null = null;
  private curH = 0;
  private lastThumb: Thumb | null = null;
  private pending: Xf | null = null;
  /** frames carried by the pan alone since the last anchored fit */
  private panOnly = 0;
  private lastStrongZoom = 0;

  reset() {
    this.cur = null;
    this.lastThumb = null;
    this.pending = null;
    this.panOnly = 0;
  }

  get tracking() {
    return !!this.cur;
  }

  step(fr: Frame, H: number, area: MapArea, k: number): TrackOut {
    // no nav bar across the top: the map isn't open
    if (!area.chrome) {
      this.reset();
      return { xf: null, fit: null, how: "closed" };
    }
    const det = detect(fr, k, area);
    const c = makeCtx(det, area, k);
    const th = thumb(fr, area);
    let pan: TrackOut["pan"] = null;
    let prior: Xf | null = null;
    if (this.cur && this.lastThumb && this.curH === H) {
      pan = phaseShift(this.lastThumb, th);
      if (pan && pan.peak > PAN_PEAK) prior = { s: this.cur.s, tx: this.cur.tx + pan.dx, ty: this.cur.ty + pan.dy };
    }
    this.lastThumb = th;
    this.curH = H;
    const fit = registerFrame(c, H, this.zooms, prior);
    const v = fit?.verdict ?? "none";
    const out: TrackOut = { xf: null, fit, how: "none", pan };
    const agrees = (a: Xf, b: Xf | null) => !!b && Math.abs(a.s - b.s) / b.s < 0.015 && Math.hypot(a.tx - b.tx, a.ty - b.ty) < 10 * k;
    const xf = fit?.score.xf;

    const tracked = !!prior && (fit?.source === "track" || (!!xf && agrees(xf, prior)));
    if (fit && xf && (v === "strong" || (v === "ok" && (tracked || agrees(xf, this.pending))) || (v === "weak" && tracked))) {
      const sc = fit.score;
      this.cur = xf;
      this.pending = null;
      this.panOnly = sc.wpInliers >= 2 || sc.iconInliers >= 4 ? 0 : this.panOnly + 1;
      if ((sc.wpInliers >= 6 && sc.wpErr < 3 * k) || (sc.wpInliers >= 2 && sc.iconInliers >= 6)) this.learnZoom(xf.s / H);
      else this.lastStrongZoom = 0;
      out.xf = xf;
      out.how = v === "weak" ? "pan" : "fit";
      return out;
    }
    if (prior && pan) {
      // too few anchors to fit: follow the pan while what is on screen supports it. The pan alone can be
      // fooled (a waypoint tooltip that follows the cursor is the sharpest thing on screen), so it needs
      // an anchor where predicted, or, with nothing predicted in view at all, a very sharp peak for a few frames.
      const snapped = snap(c, prior);
      const ps = score(c, snapped);
      const support = ps.wpInliers >= 1 || ps.iconInliers >= 2;
      const empty = ps.wpExpected + ps.iconExpected === 0;
      if (!this.contradicts(ps, c) && ((support && this.panOnly < 15) || (empty && pan.peak > 30 && this.panOnly < 4))) {
        this.cur = snapped;
        this.panOnly++;
        out.xf = snapped;
        out.how = "pan";
        return out;
      }
    }
    // nothing confident: no pins (a stale fit after a pan or zoom would put them in the wrong place)
    this.pending = fit && v === "ok" && xf ? xf : null;
    this.cur = null;
    this.panOnly = 0;
    return out;
  }

  /** Predicted waypoints or dungeons visible on screen but nothing detected there. */
  private contradicts(sc: Score, c: Ctx): boolean {
    if (sc.wpExpected >= 2 && sc.wpInliers === 0) return true;
    if (sc.wpExpected >= 1 && sc.wpInliers === 0 && c.det.waypoints.length >= 2) return true;
    if (sc.wpExpected >= 3 && sc.wpInliers / sc.wpExpected < 0.34) return true;
    if (sc.iconExpected >= 4 && sc.iconInliers / sc.iconExpected < 0.2) return true;
    return false;
  }

  /** Remember a zoom level measured on two consecutive frames (a zoom animation never repeats). */
  private learnZoom(z: number) {
    const prev = this.lastStrongZoom;
    this.lastStrongZoom = z;
    if (!prev || Math.abs(prev - z) / z > 0.005) return;
    const i = this.zooms.findIndex((q) => Math.abs(q - z) / q < 0.015);
    if (i < 0) this.zooms = [...this.zooms, z].sort((a, b) => a - b);
    else this.zooms[i] = this.zooms[i] * 0.8 + z * 0.2;
  }
}

// ---- pins ------------------------------------------------------------------------------------

export type PinGroup = MapPinGroup;

export const GROUP_OF: Partial<Record<PoiKind, PinGroup>> = {
  journal: "journal",
  altar: "collectible",
  tenet_of_akarat: "collectible",
  chronicle_of_creation: "collectible",
  dungeon: "dungeon",
  cellar: "cellar",
  stronghold: "stronghold",
  side_quest: "side_quest",
  helltide_chest: "helltide_chest",
  undercity: "undercity",
  boss_dungeon: "boss_dungeon",
};

export interface Pin {
  id: string;
  k: PoiKind;
  /** absolute screen px (physical) */
  x: number;
  y: number;
  label?: string;
  /** approximate position */
  approx?: boolean;
}

export interface PinFilter {
  groups: Partial<Record<PinGroup, boolean>>;
  /** region key (e.g. "Dry_Steppes") with an active Helltide, or null */
  helltideRegion: string | null;
}

/** Short label for the kinds that get one. */
export function pinLabel(p: Poi, zoom: number): string | undefined {
  if (p.k === "journal") return p.p ? `Journal ${p.p}` : "Journal";
  if (zoom < 2.5) return undefined;
  if (p.k === "altar") return "Altar";
  if (p.k === "tenet_of_akarat") return "Tenet";
  if (p.k === "chronicle_of_creation") return "Chronicle";
  if (p.k === "stronghold") return p.n;
  return undefined;
}

/**
 * Project POIs through a fit into absolute screen px, keeping those inside the map area.
 * `toScreen` maps frame px to absolute screen px.
 */
export function pinsFor(xf: Xf, area: Box & { hud?: Box[] }, H: number, filter: PinFilter, toScreen: (x: number, y: number) => [number, number], pois: Poi[] = POIS): Pin[] {
  const out: Pin[] = [];
  const zoom = xf.s / H;
  for (const p of pois) {
    const g = GROUP_OF[p.k];
    if (!g || !filter.groups[g]) continue;
    if (p.k === "helltide_chest" && (!filter.helltideRegion || p.r !== filter.helltideRegion)) continue;
    const [fx, fy] = project(xf, toUv(p));
    if (!visible(area, fx, fy)) continue;
    const [x, y] = toScreen(fx, fy);
    out.push({ id: p.id, k: p.k, x: Math.round(x), y: Math.round(y), label: pinLabel(p, zoom), approx: !!p.a || undefined });
  }
  return out;
}

/** "Dry Steppes" → "Dry_Steppes" (the POI region key). */
export const regionKey = (zone: string) => zone.trim().replace(/\s+/g, "_");
