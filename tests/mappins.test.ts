// Map pins: detection and registration on synthetic data built from the real waypoint and
// dungeon positions (no game images in the repo).
import { describe, expect, it } from "vitest";
import {
  ICON_UV,
  MapTracker,
  POIS,
  WAYPOINT_UV,
  ZOOM_LADDER,
  detect,
  judge,
  makeCtx,
  mapArea,
  phaseShift,
  pinsFor,
  project,
  registerFrame,
  regionKey,
  thumb,
  toUv,
  type Blob,
  type Box,
  type Detection,
  type Frame,
  type Xf,
} from "../src/lib/mappins";

const W = 2160, H = 720, K = H / 1440;
const AREA: Box & { hud: Box[] } = { x0: 6, y0: 50, x1: 2112, y1: 674, hud: [] };

/** Deterministic PRNG so failures reproduce. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() + 1e-12)) * Math.cos(2 * Math.PI * r());

/** A transform that puts map-art point `uv` at the centre of the area at zoom `z`. */
function viewAt(uv: [number, number], z: number): Xf {
  const s = z * H;
  return { s, tx: (AREA.x0 + AREA.x1) / 2 - s * uv[0], ty: (AREA.y0 + AREA.y1) / 2 - s * uv[1] };
}

const inArea = (x: number, y: number) => x >= AREA.x0 && x < AREA.x1 && y >= AREA.y0 && y < AREA.y1;
const blob = (x: number, y: number): Blob => ({ x, y, n: 60, w: 16, h: 16 });

/** What the detector would find for a transform: some waypoints missed, centroid noise, junk blobs. */
function synth(xf: Xf, seed: number, opt: { drop?: number; noise?: number; junk?: number; iconDrop?: number; icons?: boolean } = {}): Detection {
  const r = rng(seed);
  const { drop = 0.25, noise = 0.6, junk = 8, iconDrop = 0.35, icons = true } = opt;
  const waypoints: Blob[] = [];
  for (const uv of WAYPOINT_UV) {
    const [x, y] = project(xf, uv);
    if (inArea(x, y) && r() > drop) waypoints.push(blob(x + gauss(r) * noise, y + gauss(r) * noise));
  }
  for (let i = 0; i < junk; i++) waypoints.push(blob(AREA.x0 + r() * (AREA.x1 - AREA.x0), AREA.y0 + r() * (AREA.y1 - AREA.y0)));
  const iconBlobs: Blob[] = [];
  if (icons) {
    for (const uv of ICON_UV) {
      const [x, y] = project(xf, uv);
      if (inArea(x, y) && r() > iconDrop) iconBlobs.push(blob(x + gauss(r) * 1.5, y + gauss(r) * 1.5));
    }
    for (let i = 0; i < 40; i++) iconBlobs.push(blob(AREA.x0 + r() * (AREA.x1 - AREA.x0), AREA.y0 + r() * (AREA.y1 - AREA.y0)));
  }
  return { waypoints, icons: iconBlobs };
}

/** Largest distance between where two transforms put the waypoints in view. */
function maxDev(a: Xf, b: Xf) {
  let worst = 0;
  for (const uv of [...WAYPOINT_UV, ...ICON_UV]) {
    const p = project(a, uv), q = project(b, uv);
    if (inArea(q[0], q[1])) worst = Math.max(worst, Math.hypot(p[0] - q[0], p[1] - q[1]));
  }
  return worst;
}

const regionCentre = (r: string): [number, number] => {
  const uvs = POIS.filter((p) => p.k === "waypoint" && p.r === r).map(toUv);
  return [uvs.reduce((a, u) => a + u[0], 0) / uvs.length, uvs.reduce((a, u) => a + u[1], 0) / uvs.length];
};

describe("map data", () => {
  it("has all 50 waypoints and the dungeon anchors", () => {
    expect(WAYPOINT_UV).toHaveLength(50);
    expect(ICON_UV.length).toBeGreaterThan(150);
    for (const [u, v] of WAYPOINT_UV) {
      expect(u).toBeGreaterThan(0);
      expect(u).toBeLessThan(1);
      expect(v).toBeGreaterThan(0);
      expect(v).toBeLessThan(1);
    }
  });
  it("maps helltide zone names to POI region keys", () => {
    expect(regionKey("Dry Steppes")).toBe("Dry_Steppes");
    expect(POIS.some((p) => p.k === "helltide_chest" && p.r === regionKey("Fractured Peaks"))).toBe(true);
  });
});

describe("registration", () => {
  const regions = ["Scosglen", "Fractured_Peaks", "Dry_Steppes", "Kehjistan", "Hawezar", "Nahantu", "Skovos"];

  it("finds the fit at the default and zoomed-out levels over every region, with noise, misses and junk", () => {
    let seed = 1;
    for (const r of regions)
      for (const z of [ZOOM_LADDER[0], ZOOM_LADDER[1]]) {
        const truth = viewAt(regionCentre(r), z);
        const c = makeCtx(synth(truth, seed++), AREA, K);
        const fit = registerFrame(c, H, ZOOM_LADDER)!;
        expect(fit.verdict, `${r} z${z}`).toBe("strong");
        expect(maxDev(fit.score.xf, truth), `${r} z${z}`).toBeLessThan(2.5);
      }
  });

  it("zoomed in: a few waypoints plus dungeon icons are enough", () => {
    let seed = 100, shown = 0, total = 0;
    for (const p of POIS.filter((q) => q.k === "waypoint")) {
      const truth = viewAt(toUv(p), ZOOM_LADDER[2]);
      const c = makeCtx(synth(truth, seed++, { drop: 0.1 }), AREA, K);
      const fit = registerFrame(c, H, ZOOM_LADDER);
      total++;
      if (fit && (fit.verdict === "strong" || fit.verdict === "ok")) {
        shown++;
        expect(maxDev(fit.score.xf, truth), p.n).toBeLessThan(4);
      }
    }
    expect(shown / total).toBeGreaterThan(0.8);
  });

  it("never accepts random blobs (no map open, cyan things in the world)", () => {
    const r = rng(7);
    for (let t = 0; t < 150; t++) {
      const n = 3 + Math.floor(r() * 30);
      const det: Detection = {
        waypoints: Array.from({ length: n }, () => blob(AREA.x0 + r() * (AREA.x1 - AREA.x0), AREA.y0 + r() * (AREA.y1 - AREA.y0))),
        icons: Array.from({ length: 60 }, () => blob(AREA.x0 + r() * (AREA.x1 - AREA.x0), AREA.y0 + r() * (AREA.y1 - AREA.y0))),
      };
      const fit = registerFrame(makeCtx(det, AREA, K), H, ZOOM_LADDER);
      expect(["none", "weak", undefined]).toContain(fit?.verdict);
    }
  });

  it("rejects a mirrored or rotated arrangement (orientation is fixed)", () => {
    const truth = viewAt(regionCentre("Kehjistan"), ZOOM_LADDER[1]);
    const cx = (AREA.x0 + AREA.x1) / 2, cy = (AREA.y0 + AREA.y1) / 2;
    const base = synth(truth, 5, { drop: 0, junk: 0, icons: false });
    for (const tf of [(b: Blob) => blob(2 * cx - b.x, b.y), (b: Blob) => blob(cx + (b.y - cy), cy - (b.x - cx)), (b: Blob) => blob(2 * cx - b.x, 2 * cy - b.y)]) {
      const det = { waypoints: base.waypoints.map(tf).filter((b) => inArea(b.x, b.y)), icons: [] };
      const fit = registerFrame(makeCtx(det, AREA, K), H, ZOOM_LADDER);
      expect(fit?.verdict === "strong" || fit?.verdict === "ok").toBe(false);
    }
  });

  it("two waypoints alone are never enough; with dungeon icons on a known zoom they are", () => {
    // find a view at the closest zoom with exactly two waypoints in the area
    const z = ZOOM_LADDER[4];
    let found = false;
    for (const p of POIS.filter((q) => q.k === "dungeon")) {
      const truth = viewAt(toUv(p), z);
      const wps = WAYPOINT_UV.map((uv) => project(truth, uv)).filter(([x, y]) => inArea(x, y));
      if (wps.length !== 2) continue;
      const icons = ICON_UV.map((uv) => project(truth, uv)).filter(([x, y]) => inArea(x, y));
      if (icons.length < 4) continue;
      found = true;
      const bare = registerFrame(makeCtx(synth(truth, 3, { drop: 0, junk: 0, icons: false }), AREA, K), H, ZOOM_LADDER);
      expect(bare?.verdict === "strong" || bare?.verdict === "ok").toBe(false);
      const full = registerFrame(makeCtx(synth(truth, 3, { drop: 0, junk: 0, iconDrop: 0 }), AREA, K), H, ZOOM_LADDER)!;
      expect(["ok", "strong"]).toContain(full.verdict);
      expect(maxDev(full.score.xf, truth)).toBeLessThan(3);
      break;
    }
    expect(found).toBe(true);
  });

  it("an unknown zoom needs many waypoints, and then only counts as 'ok' (a second frame must agree)", () => {
    const truth = viewAt(regionCentre("Scosglen"), 2.5);
    const fit = registerFrame(makeCtx(synth(truth, 9), AREA, K), H, ZOOM_LADDER)!;
    expect(fit.verdict).toBe("ok");
    const few = registerFrame(makeCtx(synth(viewAt(regionCentre("Scosglen"), 12), 9, { icons: false }), AREA, K), H, ZOOM_LADDER);
    expect(few?.verdict === "strong" || few?.verdict === "ok").toBe(false);
  });

  it("judge counts predicted waypoints that aren't there against the fit", () => {
    const truth = viewAt(regionCentre("Hawezar"), ZOOM_LADDER[1]);
    const c = makeCtx(synth(truth, 11, { drop: 0, junk: 0, icons: false }), AREA, K);
    const sc = registerFrame(c, H, ZOOM_LADDER)!.score;
    expect(judge(sc, K, ZOOM_LADDER)).toBe("strong");
    expect(judge({ ...sc, wpInliers: 3, wpExpected: 12 }, K, ZOOM_LADDER)).toBe("none");
  });
});

// ---- frames ---------------------------------------------------------------------------------

/** Paint a map-like frame: textured parchment, dark nav and hint bars, cyan waypoint rings, outlined dungeon icons. */
function paint(xf: Xf, seed = 1, w = W, h = H): Frame {
  const r = rng(seed);
  const data = new Uint8ClampedArray(w * h * 4);
  // low-frequency texture tied to map coordinates, so a pan moves it with the map
  const tex = (mx: number, my: number) => 0.5 + 0.25 * Math.sin(mx * 0.021 + Math.sin(my * 0.013) * 2) + 0.25 * Math.sin(my * 0.017 + Math.cos(mx * 0.011) * 2);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const t = tex(x - xf.tx, y - xf.ty);
      data[i] = 120 + 60 * t;
      data[i + 1] = 105 + 50 * t;
      data[i + 2] = 80 + 40 * t;
      data[i + 3] = 255;
    }
  const set = (fx: number, fy: number, c: number[]) => {
    const x = Math.round(fx), y = Math.round(fy);
    if (x < 0 || y < 0 || x >= w || y >= h) return;
    data.set(c, (y * w + x) * 4);
  };
  for (const uv of WAYPOINT_UV) {
    const [cx, cy] = project(xf, uv);
    for (let a = 0; a < 360; a += 2) for (const rr of [7, 8, 9]) set(cx + rr * Math.cos((a * Math.PI) / 180), cy + rr * Math.sin((a * Math.PI) / 180), [70, 225, 245]);
  }
  for (const uv of ICON_UV) {
    const [cx, cy] = project(xf, uv);
    for (let dy = -8; dy <= 8; dy++) for (let dx = -8; dx <= 8; dx++) if (Math.max(Math.abs(dx), Math.abs(dy)) >= 7) set(cx + dx, cy + dy, [15, 12, 10]);
  }
  // chrome: nav bar on top, hint bar at the bottom (with a little noise)
  for (let y = 0; y < 45; y++) for (let x = 0; x < w; x++) set(x, y, [18 + r() * 10, 16, 14]);
  for (let y = 680; y < h; y++) for (let x = 0; x < w; x++) set(x, y, [18 + r() * 10, 16, 14]);
  return { data, width: w, height: h };
}

describe("frames", () => {
  const truth = viewAt(regionCentre("Fractured_Peaks"), ZOOM_LADDER[1]);

  it("finds the chrome bands and the waypoint and icon blobs", () => {
    const fr = paint(truth);
    const area = mapArea(fr);
    expect(area.chrome).toBe(true);
    expect(area.y0).toBeGreaterThan(44);
    expect(area.y0).toBeLessThan(55);
    expect(area.y1).toBeGreaterThan(670);
    expect(area.y1).toBeLessThan(681);
    const det = detect(fr, K, area);
    const expected = WAYPOINT_UV.map((uv) => project(truth, uv)).filter(([x, y]) => x > area.x0 + 10 && x < area.x1 - 10 && y > area.y0 + 10 && y < area.y1 - 10);
    expect(det.waypoints.length).toBeGreaterThanOrEqual(expected.length - 1);
    expect(det.icons.length).toBeGreaterThan(5);
  });

  it("no nav bar: the tracker says the map is closed", () => {
    const fr = paint(truth);
    const plain = { ...fr, data: new Uint8ClampedArray(fr.data) };
    for (let i = 0; i < W * 45 * 4; i += 4) plain.data.set([140, 120, 90], i);
    const area = mapArea(plain);
    expect(area.chrome).toBe(false);
    expect(new MapTracker().step(plain, H, area, K).how).toBe("closed");
  });

  it("phase correlation measures a pan", () => {
    const a = paint(truth);
    const moved = { ...truth, tx: truth.tx - 137, ty: truth.ty + 61 };
    const b = paint(moved);
    const area = mapArea(a);
    const p = phaseShift(thumb(a, area), thumb(b, area))!;
    expect(Math.abs(p.dx - -137)).toBeLessThan(6);
    expect(Math.abs(p.dy - 61)).toBeLessThan(6);
    expect(p.peak).toBeGreaterThan(14);
  });

  it("tracker: shows a strong fit at once, follows a pan, and drops the pins when the map closes", () => {
    const tr = new MapTracker();
    const f1 = paint(truth);
    const o1 = tr.step(f1, H, mapArea(f1), K);
    expect(o1.how).toBe("fit");
    expect(maxDev(o1.xf!, truth)).toBeLessThan(3);

    const moved = { ...truth, tx: truth.tx + 220, ty: truth.ty - 90 };
    const f2 = paint(moved);
    const o2 = tr.step(f2, H, mapArea(f2), K);
    expect(o2.xf).not.toBeNull();
    expect(maxDev(o2.xf!, moved)).toBeLessThan(3);

    const closed = { ...f2, data: new Uint8ClampedArray(f2.data) };
    for (let i = 0; i < W * 45 * 4; i += 4) closed.data.set([140, 120, 90], i);
    const o3 = tr.step(closed, H, mapArea(closed), K);
    expect(o3.xf).toBeNull();
    expect(tr.tracking).toBe(false);
  });

  it("tracker: an 'ok' fit (unknown zoom) shows only once a second frame agrees", () => {
    const tr = new MapTracker();
    const xf = viewAt(regionCentre("Dry_Steppes"), 2.6);
    const f = paint(xf, 3);
    expect(tr.step(f, H, mapArea(f), K).xf).toBeNull();
    const o = tr.step(f, H, mapArea(f), K);
    expect(o.xf).not.toBeNull();
    expect(maxDev(o.xf!, xf)).toBeLessThan(2.5);
  });
});

describe("pins", () => {
  const xf = viewAt(regionCentre("Dry_Steppes"), ZOOM_LADDER[1]);
  const id = (x: number, y: number): [number, number] => [x, y];

  it("keeps pins inside the map area and out of HUD boxes", () => {
    const hud: Box = { x0: 800, y0: 50, x1: 1400, y1: 120 };
    const pins = pinsFor(xf, { ...AREA, hud: [hud] }, H, { groups: { dungeon: true, collectible: true, side_quest: true }, helltideRegion: null }, id);
    expect(pins.length).toBeGreaterThan(10);
    for (const p of pins) {
      expect(inArea(p.x, p.y)).toBe(true);
      expect(p.x >= hud.x0 && p.x < hud.x1 && p.y >= hud.y0 && p.y < hud.y1).toBe(false);
    }
    expect(pins.some((p) => p.k === "side_quest" && p.approx)).toBe(true);
    expect(pins.some((p) => p.k === "waypoint" || p.k === "cellar")).toBe(false);
  });

  it("shows Helltide chests only during a Helltide, and only in its zone", () => {
    const groups = { helltide_chest: true };
    expect(pinsFor(xf, AREA, H, { groups, helltideRegion: null }, id)).toHaveLength(0);
    const inZone = pinsFor(xf, AREA, H, { groups, helltideRegion: "Dry_Steppes" }, id);
    expect(inZone.length).toBeGreaterThan(0);
    expect(inZone.every((p) => POIS.find((q) => q.id === p.id)?.r === "Dry_Steppes")).toBe(true);
  });

  it("labels journals always and the rest only when zoomed in", () => {
    const j = POIS.find((p) => p.k === "journal")!;
    const near = viewAt(toUv(j), ZOOM_LADDER[0]);
    const pins = pinsFor(near, AREA, H, { groups: { journal: true, collectible: true }, helltideRegion: null }, id);
    expect(pins.find((p) => p.id === j.id)?.label).toMatch(/^Journal \d+$/);
    expect(pins.filter((p) => p.k === "altar").every((p) => !p.label)).toBe(true);
  });
});
