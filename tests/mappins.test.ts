// Map pins: detection and registration on synthetic data built from the real waypoint and
// dungeon positions (no game images in the repo).
import { describe, expect, it } from "vitest";
import {
  ICON_UV,
  MapTracker,
  POIS,
  WAYPOINT_UV,
  ZOOM_LADDER,
  PROBE_BAND,
  detect,
  foundAt,
  judge,
  lumaOf,
  makeCtx,
  mapArea,
  navBar,
  navSignature,
  phaseShift,
  pickCarry,
  pinsFor,
  project,
  registerFrame,
  regionKey,
  sameNav,
  sidePanel,
  stripMoved,
  stripSignature,
  thumb,
  toUv,
  visible,
  zoomCarry,
  type Blob,
  type Box,
  type Detection,
  type Frame,
  type Xf,
} from "../src/lib/mappins";
import { MAP_PIN_PRESETS, defaultSettings, migrateMapPins, nextPreset, presetGroups, type Settings } from "../src/lib/store";

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

// ---- clipping: nothing outside the map viewport -----------------------------------------------

/** The map's side panel on the right edge (dark neutral grey) with its round red collapse tab. */
function withPanel(fr: Frame, left = W - 46): Frame {
  const out = { ...fr, data: new Uint8ClampedArray(fr.data) };
  for (let y = 100; y < 610; y++) for (let x = left; x < W; x++) out.data.set([22, 24, 26, 255], (y * W + x) * 4);
  for (let y = 345; y < 380; y++) for (let x = left - 26; x < left + 2; x++) if (Math.hypot(x - (left - 12), y - 362) < 14) out.data.set([170, 30, 25, 255], (y * W + x) * 4);
  return out;
}

describe("clipping", () => {
  const truth = viewAt(regionCentre("Kehjistan"), ZOOM_LADDER[1]);

  it("measures the side panel and keeps the map area (and its collapse tab) clear of it", () => {
    const fr = withPanel(paint(truth));
    const left = sidePanel(fr);
    expect(left).not.toBeNull();
    expect(Math.abs(left! - (W - 46))).toBeLessThanOrEqual(1);
    const area = mapArea(fr);
    expect(area.x1).toBeLessThan(W - 46);
    // the tab sticks out of the panel at mid height: a HUD box covers it
    expect(area.hud.some((h) => h.x0 <= W - 38 && h.x1 >= W - 46 && h.y0 <= 362 && h.y1 >= 362)).toBe(true);
  });

  it("an expanded (wider) panel is measured too; dark brown map art at the edge is not a panel", () => {
    expect(Math.abs(sidePanel(withPanel(paint(truth), W - 400))! - (W - 400))).toBeLessThanOrEqual(1);
    const fr = paint(truth);
    const brown = { ...fr, data: new Uint8ClampedArray(fr.data) };
    for (let y = 0; y < H; y++) for (let x = W - 200; x < W; x++) brown.data.set([28, 10, 2, 255], (y * W + x) * 4);
    expect(sidePanel(brown)).toBeNull();
    // no panel found: the right edge falls back to a fixed strip
    expect(mapArea(brown).x1).toBeLessThan(W - 40);
  });

  it("keeps every pin's whole footprint inside the area and off the HUD boxes", () => {
    const hud: Box = { x0: 800, y0: 50, x1: 1400, y1: 120 };
    const area = { ...AREA, hud: [hud] };
    const m = 14;
    const pins = pinsFor(truth, area, H, { groups: { dungeon: true, cellar: true, collectible: true, side_quest: true, stronghold: true }, helltideRegion: null, margin: m }, (x, y) => [x, y]);
    expect(pins.length).toBeGreaterThan(10);
    for (const p of pins) {
      expect(p.x - m >= AREA.x0 - 0.5 && p.x + m <= AREA.x1 + 0.5 && p.y - m >= AREA.y0 - 0.5 && p.y + m <= AREA.y1 + 0.5).toBe(true);
      expect(p.x + m - 0.5 > hud.x0 && p.x - m + 0.5 < hud.x1 && p.y + m - 0.5 > hud.y0 && p.y - m + 0.5 < hud.y1).toBe(false);
    }
    // without the margin, pins right at the edges would be kept
    const loose = pinsFor(truth, area, H, { groups: { dungeon: true, cellar: true, collectible: true, side_quest: true, stronghold: true }, helltideRegion: null }, (x, y) => [x, y]);
    expect(loose.length).toBeGreaterThan(pins.length);
  });
});

// ---- the fast probe: is the map still open, still where it was? -------------------------------

/** Nav bar with tab labels (bright blocks) and the active tab's red highlight, like the game's. */
function withNav(fr: Frame, active = 3): Frame {
  const out = { ...fr, data: new Uint8ClampedArray(fr.data) };
  const tabs = [600, 760, 920, 1080, 1240, 1400, 1560];
  for (let y = 0; y < 42; y++) for (let x = 0; x < W; x++) out.data.set([20, 19, 18, 255], (y * W + x) * 4);
  tabs.forEach((tx, i) => {
    for (let y = 8; y < 34; y++)
      for (let x = tx; x < tx + 90; x++) {
        if (i === active) out.data.set([150, 25, 25, 255], (y * W + x) * 4);
        if (y > 14 && y < 26 && (x - tx) % 9 < 6) out.data.set([215, 205, 185, 255], (y * W + x) * 4);
      }
  });
  return out;
}

/** The top band of a frame as the probe captures it (downscaled, `f` < 1). */
function band(fr: Frame, f: number): Frame {
  const bw = Math.round(W * f), bh = Math.round(H * PROBE_BAND * f);
  const data = new Uint8ClampedArray(bw * bh * 4);
  for (let y = 0; y < bh; y++)
    for (let x = 0; x < bw; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y / f); yy < Math.floor((y + 1) / f); yy++)
        for (let xx = Math.floor(x / f); xx < Math.floor((x + 1) / f); xx++) {
          const i = (yy * W + xx) * 4;
          r += fr.data[i];
          g += fr.data[i + 1];
          b += fr.data[i + 2];
          n++;
        }
      data.set([r / n, g / n, b / n, 255], (y * bw + x) * 4);
    }
  return { data, width: bw, height: bh };
}

describe("close probe", () => {
  const truth = viewAt(regionCentre("Scosglen"), ZOOM_LADDER[1]);
  const open = withNav(paint(truth));
  const ref = navSignature(open);

  it("the probe band of the open map matches the full frame's nav bar", () => {
    const b = band(open, 0.3);
    const Hs = b.height / PROBE_BAND;
    expect(navBar(b, Hs)).toBeGreaterThanOrEqual(Math.floor(Hs * 0.04));
    expect(sameNav(ref, navSignature(b, Hs))).toBe(true);
  });

  it("fails when the map closes, even in a dark scene that passes the dark-rows test", () => {
    const world = paint(truth);
    for (let i = 0; i < world.data.length; i += 4) world.data.set([120, 110, 95], i);
    expect(sameNav(ref, navSignature(world))).toBe(false);
    const dark = { ...world, data: new Uint8ClampedArray(world.data.length).fill(12) };
    for (let i = 3; i < dark.data.length; i += 4) dark.data[i] = 255;
    expect(navBar(dark)).toBeGreaterThanOrEqual(Math.floor(H * 0.04));
    expect(sameNav(ref, navSignature(dark))).toBe(false);
  });

  it("fails when another tab is picked, but not when a tooltip overlaps one spot of the bar", () => {
    expect(sameNav(ref, navSignature(withNav(paint(truth), 4)))).toBe(false);
    const tip = { ...open, data: new Uint8ClampedArray(open.data) };
    for (let y = 10; y < 42; y++) for (let x = 1010; x < 1060; x++) tip.data.set([90, 200, 210, 255], (y * W + x) * 4);
    expect(sameNav(ref, navSignature(tip))).toBe(true);
  });

  it("sees a pan or zoom in the strip under the nav bar, and not a still map", () => {
    const strip = stripSignature(open);
    const still = band(open, 0.3);
    expect(stripMoved(strip, stripSignature(still, still.height / PROBE_BAND))).toBe(false);
    const panned = band(withNav(paint({ ...truth, tx: truth.tx + 120, ty: truth.ty - 40 })), 0.3);
    expect(stripMoved(strip, stripSignature(panned, panned.height / PROBE_BAND))).toBe(true);
  });

  it("the tracker drops the fit as soon as a frame has no nav bar", () => {
    const tr = new MapTracker();
    expect(tr.step(open, H, mapArea(open), K).xf).not.toBeNull();
    const closed = paint(truth);
    for (let i = 0; i < W * 45 * 4; i += 4) closed.data.set([140, 120, 90], i);
    const o = tr.step(closed, H, mapArea(closed), K);
    expect(o.how).toBe("closed");
    expect(o.xf).toBeNull();
    expect(tr.tracking).toBe(false);
  });
});

// ---- zoom carry-over -------------------------------------------------------------------------

/** Smooth value noise on a lattice, deterministic. */
function noise(u: number, v: number) {
  const h = (i: number, j: number) => {
    let x = (i * 374761393 + j * 668265263) | 0;
    x = (x ^ (x >>> 13)) * 1274126177;
    return ((x ^ (x >>> 16)) >>> 0) / 2 ** 32;
  };
  const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
  const su = fu * fu * (3 - 2 * fu), sv = fv * fv * (3 - 2 * fv);
  return (h(i, j) * (1 - su) + h(i + 1, j) * su) * (1 - sv) + (h(i, j + 1) * (1 - su) + h(i + 1, j + 1) * su) * sv;
}

/** A map frame whose art scales with the zoom (texture in map-art units), icons at their fixed screen size. */
function paintMap(xf: Xf): Frame {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const u = (x - xf.tx) / xf.s, v = (y - xf.ty) / xf.s;
      const t = 0.5 * noise(u / 0.04, v / 0.04) + 0.3 * noise(u / 0.012, v / 0.012) + 0.2 * noise(u / 0.004, v / 0.004);
      data.set([90 + 110 * t, 80 + 90 * t, 60 + 70 * t, 255], (y * W + x) * 4);
    }
  const icons = paint(xf);
  // copy the icons and chrome from paint() (anything it drew that isn't parchment)
  for (let i = 0; i < data.length; i += 4) {
    const r = icons.data[i], g = icons.data[i + 1], b = icons.data[i + 2];
    if (g > 200 || (r < 60 && g < 60)) data.set([r, g, b, 255], i);
  }
  return { data, width: W, height: H };
}

/** A spot where, at the closest zoom, exactly one waypoint and a dungeon or two are in view. */
function sparseSpot(): Xf | null {
  const z = ZOOM_LADDER[4];
  for (const p of POIS.filter((q) => q.k === "dungeon")) {
    const xf = viewAt(toUv(p), z);
    const inner = { x0: AREA.x0 + 20, y0: AREA.y0 + 20, x1: AREA.x1 - 20, y1: AREA.y1 - 20 };
    const wps = WAYPOINT_UV.filter((uv) => visible(inner, ...project(xf, uv))).length;
    const ics = ICON_UV.filter((uv) => visible(inner, ...project(xf, uv))).length;
    if (wps === 1 && ics >= 1 && ics <= 3) return xf;
  }
  return null;
}

describe("zoom carry-over", () => {
  const near = sparseSpot()!;
  // the same spot two zoom levels out: registered from its many waypoints
  const centre: [number, number] = [((AREA.x0 + AREA.x1) / 2 - near.tx) / near.s, ((AREA.y0 + AREA.y1) / 2 - near.ty) / near.s];
  const wide = viewAt(centre, ZOOM_LADDER[1]);

  it("finds a spot with a single waypoint at the closest zoom (too few to register alone)", () => {
    expect(near).not.toBeNull();
    const fr = paintMap(near);
    const fit = registerFrame(makeCtx(detect(fr, K, mapArea(fr)), mapArea(fr), K), H, ZOOM_LADDER);
    expect(fit?.verdict === "strong" || fit?.verdict === "ok").toBe(false);
  });

  it("matches the zoomed-in view inside the zoomed-out one at the right zoom level", () => {
    const a = paintMap(wide), b = paintMap(near);
    const ca = mapArea(a), cb = mapArea(b);
    const cands = zoomCarry(lumaOf(a, ca), wide, lumaOf(b, cb), H, ZOOM_LADDER);
    expect(cands[0].z).toBe(ZOOM_LADDER[4]);
    expect(cands[0].ncc).toBeGreaterThan(0.6);
    expect(maxDev(cands[0].xf, near)).toBeLessThan(25);
    const pick = pickCarry(makeCtx(detect(b, K, cb), cb, K), cands)!;
    expect(pick).not.toBeNull();
    expect(maxDev(pick.xf, near)).toBeLessThan(4);
  });

  it("the tracker carries the fit over the zoom change and keeps it while the map pans", () => {
    const tr = new MapTracker();
    const a = paintMap(wide);
    expect(tr.step(a, H, mapArea(a), K).how).toBe("fit");
    const b = paintMap(near);
    const o = tr.step(b, H, mapArea(b), K);
    expect(o.how).toBe("zoom");
    expect(maxDev(o.xf!, near)).toBeLessThan(4);
    const moved = { ...near, tx: near.tx - 60, ty: near.ty + 25 };
    const c = paintMap(moved);
    const o2 = tr.step(c, H, mapArea(c), K);
    expect(o2.xf).not.toBeNull();
    expect(maxDev(o2.xf!, moved)).toBeLessThan(4);
  });

  it("never carries the fit to a view that isn't inside the registered one", () => {
    const tr = new MapTracker();
    const a = paintMap(wide);
    tr.step(a, H, mapArea(a), K);
    // the closest zoom somewhere else on the map
    for (const p of POIS.filter((q) => q.k === "waypoint").slice(0, 12)) {
      const far = viewAt(toUv(p), ZOOM_LADDER[4]);
      if (Math.abs(far.tx - near.tx) < W && Math.abs(far.ty - near.ty) < H) continue;
      const fr = paintMap(far);
      const o = tr.step(fr, H, mapArea(fr), K);
      if (o.xf) expect(maxDev(o.xf, far)).toBeLessThan(4);
    }
  });
});

// ---- found altars ----------------------------------------------------------------------------

describe("unfound only", () => {
  const glyph = (fr: Frame, x: number, y: number) => {
    // a grey glyph with a black outline, its centre 6.4·k above the spot (as the game draws a found altar)
    const cy = y - 6.4 * K;
    for (let dy = -10; dy <= 10; dy++)
      for (let dx = -10; dx <= 10; dx++) {
        const r = Math.hypot(dx, dy);
        const px = Math.round(x + dx), py = Math.round(cy + dy);
        if (r <= 7) fr.data.set([66, 62, 68, 255], (py * W + px) * 4);
        else if (r <= 9) fr.data.set([12, 10, 12, 255], (py * W + px) * 4);
      }
  };
  const truth = viewAt(regionCentre("Scosglen"), ZOOM_LADDER[2]);

  it("tells a found altar's icon from bare map, and from dark brown map art", () => {
    const fr = paint(truth);
    glyph(fr, 500, 300);
    expect(foundAt(fr, "altar", 500, 300, K)).toBe(true);
    expect(foundAt(fr, "altar", 900, 300, K)).toBe(false);
    for (let y = 280; y < 320; y++) for (let x = 1180; x < 1220; x++) fr.data.set([40, 18, 8, 255], (y * W + x) * 4);
    expect(foundAt(fr, "altar", 1200, 300, K)).toBe(false);
  });

  it("hides found altars (or marks them found), zoomed in only", () => {
    const fr = paint(truth);
    const id = (x: number, y: number): [number, number] => [x, y];
    const all = pinsFor(truth, AREA, H, { groups: { collectible: true }, helltideRegion: null }, id);
    expect(all.length).toBeGreaterThan(2);
    const target = all[0];
    glyph(fr, target.x, target.y);
    const hidden = pinsFor(truth, AREA, H, { groups: { collectible: true }, helltideRegion: null, found: { fr, k: K, hide: true } }, id);
    expect(hidden.some((p) => p.id === target.id)).toBe(false);
    expect(hidden.length).toBe(all.length - 1);
    const marked = pinsFor(truth, AREA, H, { groups: { collectible: true }, helltideRegion: null, found: { fr, k: K, hide: false } }, id);
    expect(marked.find((p) => p.id === target.id)?.found).toBe(true);
    // zoomed out to the widest level the icons are dots: nothing is hidden
    const wideXf = viewAt(regionCentre("Scosglen"), ZOOM_LADDER[0]);
    const w = pinsFor(wideXf, AREA, H, { groups: { collectible: true }, helltideRegion: null, found: { fr, k: K, hide: true } }, id);
    expect(w.length).toBe(pinsFor(wideXf, AREA, H, { groups: { collectible: true }, helltideRegion: null }, id).length);
  });
});

// ---- presets ---------------------------------------------------------------------------------

describe("presets", () => {
  const custom = { ...defaultSettings.mapPins.groups };

  it("each preset shows its kinds; Custom shows the checkboxes; Off shows nothing", () => {
    expect(presetGroups("collectibles", custom)).toEqual({ journal: true, collectible: true });
    expect(presetGroups("dungeons", custom)).toEqual({ dungeon: true, cellar: true });
    expect(presetGroups("quests", custom)).toEqual({ side_quest: true, stronghold: true });
    expect(presetGroups("helltide", custom)).toEqual({ helltide_chest: true });
    expect(Object.keys(presetGroups("everything", custom))).toHaveLength(9);
    expect(presetGroups("off", custom)).toEqual({});
    expect(presetGroups("custom", custom)).toBe(custom);
  });

  it("the new defaults are quiet: collectibles and dungeons", () => {
    const on = Object.entries(defaultSettings.mapPins.groups).filter(([, v]) => v).map(([k]) => k);
    expect(on.sort()).toEqual(["collectible", "dungeon", "journal"]);
    expect(defaultSettings.mapPins.preset).toBe("custom");
    expect(defaultSettings.mapPins.unfoundOnly).toBe(true);
  });

  it("the hotkey steps through the presets in the cycle, in order, wrapping around", () => {
    const cycle = ["custom", "dungeons", "off"] as const;
    expect(nextPreset("custom", [...cycle])).toBe("dungeons");
    expect(nextPreset("dungeons", [...cycle])).toBe("off");
    expect(nextPreset("off", [...cycle])).toBe("custom");
    // not in the cycle (picked on the Overlay page): the first one
    expect(nextPreset("quests", [...cycle])).toBe("custom");
    expect(nextPreset("quests", [])).toBe("quests");
    expect(MAP_PIN_PRESETS.map((p) => p.id)).toEqual(defaultSettings.mapPins.cycle);
  });

  it("has a default hotkey and pad chord that no other action uses", () => {
    const keys = Object.entries(defaultSettings.hotkeys).filter(([a]) => a !== "mapPinsPreset").map(([, k]) => k);
    expect(defaultSettings.hotkeys.mapPinsPreset).toBeTruthy();
    expect(keys).not.toContain(defaultSettings.hotkeys.mapPinsPreset);
    expect(defaultSettings.hotkeys.mapPinsPreset).not.toBe("CommandOrControl+Shift+M");
    const chord = defaultSettings.padChords.mapPinsPreset.join("+");
    expect(chord).toBeTruthy();
    expect(Object.entries(defaultSettings.padChords).filter(([a]) => a !== "mapPinsPreset").map(([, c]) => c.join("+"))).not.toContain(chord);
  });

  // settings as the store loads them: saved values over the defaults, then the migration
  const merged = (persisted: any): Settings =>
    migrateMapPins(
      structuredClone({
        ...defaultSettings,
        mapPins: { ...defaultSettings.mapPins, ...persisted.mapPins },
        hotkeys: { ...defaultSettings.hotkeys, ...persisted.hotkeys },
        padChords: { ...defaultSettings.padChords, ...persisted.padChords },
      }),
      persisted,
    );
  const { mapPinsPreset: _k, ...oldHotkeys } = defaultSettings.hotkeys;
  const { mapPinsPreset: _c, ...oldChords } = defaultSettings.padChords;
  const oldDefaults = { journal: true, collectible: true, dungeon: true, cellar: true, stronghold: true, side_quest: true, helltide_chest: true, undercity: false, boss_dungeon: false };

  it("moves the old everything-on defaults to the quiet ones, once", () => {
    const m = merged({ mapPins: { enabled: true, groups: oldDefaults } });
    expect(m.mapPins.groups).toEqual(defaultSettings.mapPins.groups);
    expect(m.mapPins.v).toBe(2);
    // already migrated: whatever the user ticks since stays
    const again = merged({ mapPins: { enabled: true, groups: oldDefaults, v: 2 } });
    expect(again.mapPins.groups).toEqual(oldDefaults);
  });

  it("keeps settings the user had changed, and keeps the new keys off ones already taken", () => {
    const mine = { ...oldDefaults, side_quest: false };
    expect(merged({ mapPins: { enabled: true, groups: mine } }).mapPins.groups).toEqual(mine);
    const taken = merged({ mapPins: { groups: mine }, hotkeys: { ...oldHotkeys, clip: "Alt+M" }, padChords: { ...oldChords, clip: ["LS", "View"] } });
    expect(taken.hotkeys.mapPinsPreset).toBe("");
    expect(taken.padChords.mapPinsPreset).toEqual([]);
    const free = merged({ mapPins: { groups: mine }, hotkeys: oldHotkeys, padChords: oldChords });
    expect(free.hotkeys.mapPinsPreset).toBe(defaultSettings.hotkeys.mapPinsPreset);
    expect(free.padChords.mapPinsPreset).toEqual(defaultSettings.padChords.mapPinsPreset);
  });
});
