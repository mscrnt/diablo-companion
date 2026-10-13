// Capture loop for pins on the in-game map (registration itself: mappins.ts).
// Screen capture only: frames of the game window, nothing else.
//
// While the game is on screen and the feature is on:
//   - map not registered: every 2 s, a small capture of the top band asks "is a full-screen
//     menu open?" (its dark nav bar); only then the whole game image is captured and fitted
//   - map registered: the whole game image every ~600 ms, tracked frame to frame, and in
//     between, every ~180 ms, a fast probe: a small capture of the top band (the nav bar and a
//     strip of map under it). If the nav bar isn't the one the map had, the map closed (or
//     another tab is open): the pins go at once. If the strip moved, the map is being panned
//     or zoomed: the pins go until the next full frame places them again.
// The overlay gets the pins in absolute screen px plus the visible map area (and the HUD boxes
// over it) to clip to. It also drops them by itself if no update arrives for a while.
import { create } from "zustand";
import { emitOverlay } from "./bus";
import { captureRegion, mouseDown, type CaptureResult } from "./native";
import {
  MapTracker,
  PROBE_BAND,
  mapArea,
  navBar,
  navBarInBand,
  navSignature,
  pinsFor,
  sameNav,
  stripMoved,
  stripSignature,
  type Box,
  type Frame,
  type MapArea,
  type Pin,
  type TrackOut,
  type Xf,
} from "./mappins";
import { MAP_PIN_PRESETS, presetGroups, useSettings } from "./store";
import { testLog, testModeOn } from "./testmode";
import { debugEvent } from "./debug";

type Rect = [number, number, number, number];
interface ScreenBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What the overlay draws. Coordinates are absolute physical screen px. */
export interface MapPinsFrame {
  pins: Pin[];
  /** visible map area (between the nav bar and the hint bar, left of the side panel) */
  clip: ScreenBox;
  /** HUD boxes over the map area: nothing is drawn there */
  hud: ScreenBox[];
  /** zoom level (map scale / image height), for decluttering when zoomed out */
  zoom: number;
  /** preset name to show on the map (always for a moment after switching; all the time with the chip on) */
  label?: string;
  /** how long to show the label (ms from now); absent: the chip, shown dimly */
  labelMs?: number;
  /** the overlay drops the pins if no newer frame arrives within this many ms */
  ttl: number;
}

export interface MapPinsStatus {
  state: "off" | "paused" | "idle" | "menu" | "tracking";
  /** last frame: waypoints matched / dungeon icons matched */
  waypoints?: number;
  icons?: number;
  how?: TrackOut["how"];
  pins?: number;
  /** milliseconds, rolling averages */
  captureMs?: number;
  decodeMs?: number;
  fitMs?: number;
  probeMs?: number;
  at?: number;
}

export const useMapPins = create<{ status: MapPinsStatus }>(() => ({ status: { state: "off" } }));

/** Frames are fitted at this image height (icons are ~18 px there; more pixels buy nothing). */
const FIT_HEIGHT = 720;
const NAV_BAND = 0.11;
/** while registered: a full frame this often (ms), and a fast probe in between this often */
const FULL_MS = 600;
const PROBE_MS = 180;
/** the overlay drops pins not refreshed for this long (a stalled loop must not leave them up) */
const TTL_MS = 1200;
/** how long the preset name shows after switching */
const LABEL_MS = 2500;

/** base64 JPEG → RGBA pixels, in the webview. */
async function decode(b64: string): Promise<Frame> {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const c = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(bmp.width, bmp.height) : Object.assign(document.createElement("canvas"), { width: bmp.width, height: bmp.height });
  const ctx = c.getContext("2d", { willReadFrequently: true }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const d = ctx.getImageData(0, 0, c.width, c.height);
  return { data: d.data, width: d.width, height: d.height };
}

/** The game image inside the game window (black bars removed), absolute physical px. */
function gameImage(rect: Rect) {
  const b = useSettings.getState().settings.overlay.gameBounds;
  const [x, y, w, h] = rect;
  if (!b) return { x, y, w, h };
  return { x: Math.round(x + w * b.left), y: Math.round(y + h * b.top), w: Math.round(w * (b.right - b.left)), h: Math.round(h * (b.bottom - b.top)) };
}

const avg = (prev: number | undefined, v: number) => (prev == null ? v : prev * 0.8 + v * 0.2);
const presetLabel = (id: string) => MAP_PIN_PRESETS.find((p) => p.id === id)?.label ?? id;

/** The last registered frame, to redraw the pins at once when the preset changes. */
interface Shown {
  xf: Xf;
  area: MapArea;
  fr: Frame;
  H: number;
  toScreen: (x: number, y: number) => [number, number];
  /** frame px per screen px */
  fps: number;
}

let repin: (() => boolean) | null = null;
let labelUntil = 0;

/**
 * The preset was switched (hotkey, chord or the Overlay page): redraw the pins with it now and
 * show its name on the map for a moment. Returns false if no map is on screen to show it on.
 */
export function mapPinsPresetChanged(): boolean {
  labelUntil = Date.now() + LABEL_MS;
  return repin?.() ?? false;
}

/**
 * `active`: game on screen, overlay showing, feature on. `helltideRegion`: POI region key of
 * the running Helltide (e.g. "Dry_Steppes"), or null.
 */
export function startMapPins(active: () => boolean, gameRect: () => Rect | null, helltideRegion: () => string | null) {
  const tracker = new MapTracker();
  let lastSent = "";
  let lastLog = 0;
  let wasTracking = false;
  let dbgTracking = false;
  let lastFull = 0;
  /** the nav bar and the map strip of the last full frame, for the fast probes */
  let navRef: Float32Array | null = null;
  let stripRef: Float32Array | null = null;
  let shown: Shown | null = null;
  /** the map was moving: a full frame's pins wait here until a probe sees it still */
  let settling = false;
  let pending: Shown | null = null;
  /** consecutive probe/frame results, so one noisy reading doesn't blank the pins (flicker) */
  let closedRun = 0;
  let missRun = 0;
  /** the last probe saw the map still and open: shown pins are still right */
  let stillOpen = false;
  /** a mouse button is held on the open map (dragging it): no pins until it's let go and the map is still */
  let held = false;
  /** expiry the overlay applies, sized to the measured cycle so a slow capture can't blink pins */
  const ttl = () => {
    const st = useMapPins.getState().status;
    const cycle = FULL_MS + (st.captureMs ?? 0) + (st.decodeMs ?? 0) + (st.fitMs ?? 0);
    return Math.max(TTL_MS, Math.round(cycle * 2.5));
  };

  const send = (f: MapPinsFrame | null) => {
    const key = f ? JSON.stringify(f) : "";
    // pins go out on every update (the overlay's keep-alive); "nothing" only once
    if (!f && key === lastSent) return;
    lastSent = key;
    emitOverlay("mappins", f);
  };
  const setStatus = (p: Partial<MapPinsStatus>) => useMapPins.setState((s) => ({ status: { ...s.status, ...p, at: Date.now() } }));
  const clear = () => {
    tracker.reset();
    navRef = stripRef = null;
    shown = pending = null;
    settling = false;
    closedRun = missRun = 0;
    stillOpen = false;
    send(null);
  };

  /** The pins for the last registered frame, with the current settings. */
  const frameFor = (s: Shown): MapPinsFrame => {
    const mp = useSettings.getState().settings.mapPins;
    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    const pins = pinsFor(
      s.xf,
      s.area,
      s.H,
      {
        groups: presetGroups(mp.preset, mp.groups),
        helltideRegion: helltideRegion(),
        // keep a whole pin (about 26 CSS px across) inside the map area and off the HUD boxes
        margin: 13 * dpr * s.fps,
        found: { fr: s.fr, k: s.H / 1440, hide: mp.unfoundOnly },
        ui: s.fr,
      },
      s.toScreen,
    );
    const box = (b: Box): ScreenBox => {
      const [x0, y0] = s.toScreen(b.x0, b.y0);
      const [x1, y1] = s.toScreen(b.x1, b.y1);
      return { x: Math.round(x0), y: Math.round(y0), w: Math.round(x1 - x0), h: Math.round(y1 - y0) };
    };
    const left = labelUntil - Date.now();
    return {
      pins,
      clip: box(s.area),
      hud: (s.area.hud ?? []).map(box),
      zoom: s.xf.s / s.H,
      label: left > 0 || mp.chip ? presetLabel(mp.preset) : undefined,
      labelMs: left > 0 ? left : undefined,
      ttl: ttl(),
    };
  };

  repin = () => {
    if (!shown || !tracker.tracking) return false;
    const mp = useSettings.getState().settings.mapPins;
    if (mp.preset === "off") {
      clear();
      return false;
    }
    send(frameFor(shown));
    return true;
  };

  /** Fast check between full frames: is the map still open, and still where it was? */
  async function probe(img: { x: number; y: number; w: number; h: number }): Promise<"ok" | "closed" | "moved"> {
    const t0 = performance.now();
    const band = await captureRegion({ x: img.x, y: img.y, w: img.w, h: Math.round(img.h * PROBE_BAND) }, { maxEdge: 640, quality: 70 });
    const f = await decode(band.image);
    const Hs = f.height / PROBE_BAND;
    setStatus({ probeMs: avg(useMapPins.getState().status.probeMs, performance.now() - t0) });
    if (navBar(f, Hs) < Math.floor(Hs * 0.04) || !navRef || !sameNav(navRef, navSignature(f, Hs))) return "closed";
    if (!stripRef || stripMoved(stripRef, stripSignature(f, Hs))) return "moved";
    return "ok";
  }

  async function tick(): Promise<number> {
    const rect = gameRect();
    const { mapPins, overlay } = useSettings.getState().settings;
    const on = mapPins.enabled && mapPins.preset !== "off";
    // an overlay that shows in screen captures would put our own pins into the frames we read
    if (!on || overlay.capturable || !active() || !rect || rect[2] < 200 || rect[3] < 200) {
      if (dbgTracking) {
        dbgTracking = false;
        debugEvent("mappins", "lost", { why: !on ? "map pins off" : overlay.capturable ? "overlay is capturable (paused)" : "game or overlay not showing" });
      }
      clear();
      setStatus({ state: !on ? "off" : overlay.capturable ? "paused" : "idle", how: undefined });
      return 2000;
    }
    const img = gameImage(rect);
    const st = useMapPins.getState().status;

    // registered: fast probes between full frames
    if (tracker.tracking && performance.now() - lastFull < FULL_MS - PROBE_MS / 2) {
      const p = await probe(img);
      closedRun = p === "closed" ? closedRun + 1 : 0;
      stillOpen = p === "ok";
      // act on two readings in a row (~0.36 s): a single noisy probe made the pins blink
      if (closedRun >= 2) {
        closedRun = 0;
        debugEvent("mappins", "closed", { why: "nav bar gone or changed on two probes in a row" });
        clear();
        dbgTracking = false;
        setStatus({ state: "idle", how: "closed" });
        return PROBE_MS;
      }
      if (p === "closed") {
        if (shown) send(frameFor(shown));
        return Math.round(PROBE_MS / 2);
      }
      // moving: hide at once (pins sliding against the map look wrong); they return once it's still
      if (p === "moved") {
        // being panned or zoomed: no pins until the map is still again (a full frame right away, and
        // its pins once a probe sees nothing moved since)
        if (!settling) debugEvent("mappins", "moved", { why: "map strip changed between probes: pins hidden until it settles" });
        shown = pending = null;
        settling = true;
        send(null);
        lastFull = 0;
        return 0;
      }
      if (settling && pending && !held) {
        shown = pending;
        pending = null;
        settling = false;
      }
      if (shown) send(frameFor(shown));
      return PROBE_MS;
    }

    // not registered yet: a cheap look at the top band first
    if (!tracker.tracking) {
      const t0 = performance.now();
      const band = await captureRegion({ x: img.x, y: img.y, w: img.w, h: Math.round(img.h * NAV_BAND) }, { maxEdge: 640, quality: 70 });
      const f = await decode(band.image);
      if (!navBarInBand(f, NAV_BAND)) {
        clear();
        setStatus({ state: "idle", how: "closed", captureMs: avg(st.captureMs, performance.now() - t0) });
        return 2000;
      }
    }

    const scale = Math.min(1, FIT_HEIGHT / img.h);
    const t0 = performance.now();
    lastFull = t0;
    const cap: CaptureResult = await captureRegion(img, { maxEdge: Math.round(Math.max(img.w, img.h) * scale), quality: 92 });
    const t1 = performance.now();
    const fr = await decode(cap.image);
    const t2 = performance.now();
    const H = fr.height;
    const area = mapArea(fr);
    // the map has to still be the open menu: same nav bar as when it was registered
    const nav = navSignature(fr);
    if (tracker.tracking && navRef && !sameNav(navRef, nav)) {
      tracker.reset();
      navRef = null;
    }
    const out = tracker.step(fr, H, area, H / 1440);
    const t3 = performance.now();

    // frame px → absolute screen px
    const sx = cap.region.w / fr.width, sy = cap.region.h / fr.height;
    const toScreen = (x: number, y: number): [number, number] => [cap.region.x + x * sx, cap.region.y + y * sy];
    let frame: MapPinsFrame | null = null;
    if (!out.xf && shown && stillOpen && !settling && missRun < 2 && navRef && sameNav(navRef, nav)) {
      // one frame didn't register, but the map is open and hasn't moved since the last good fit:
      // those pins are still right, so keep them for a frame or two instead of blinking
      missRun++;
      frame = frameFor(shown);
      send(frame);
    } else if (out.xf) {
      missRun = 0;
      navRef ??= nav;
      stripRef = stripSignature(fr);
      const s: Shown = { xf: out.xf, area, fr, H, toScreen, fps: 1 / sx };
      frame = frameFor(s);
      if (settling) {
        pending = s;
        shown = null;
        send(null);
      } else {
        shown = s;
        send(frame);
      }
    } else {
      navRef = stripRef = null;
      shown = pending = null;
      settling = false;
      missRun = 0;
      send(null);
    }

    const sc = out.fit?.score;
    setStatus({
      state: out.xf ? "tracking" : area.chrome ? "menu" : "idle",
      how: out.how,
      waypoints: sc?.wpInliers,
      icons: sc?.iconInliers,
      pins: frame?.pins.length ?? 0,
      captureMs: avg(st.captureMs, t1 - t0),
      decodeMs: avg(st.decodeMs, t2 - t1),
      fitMs: avg(st.fitMs, t3 - t2),
    });

    // test mode: record when the map is found or lost (with the frame), at most every 5 s
    if (testModeOn() && !!out.xf !== wasTracking && Date.now() - lastLog > 5000) {
      lastLog = Date.now();
      testLog(
        "mappins",
        {
          event: out.xf ? "found" : "lost",
          how: out.how,
          fit: sc && { source: out.fit!.source, verdict: out.fit!.verdict, xf: sc.xf, wp: [sc.wpInliers, sc.wpExpected, sc.wpErr], icons: [sc.iconInliers, sc.iconExpected, sc.iconErr] },
          pan: out.pan,
          carry: out.carry,
          zooms: tracker.zooms,
          frame: { w: fr.width, h: fr.height, region: cap.region },
          area: { ...area, hud: area.hud as Box[] },
          ms: { capture: Math.round(t1 - t0), decode: Math.round(t2 - t1), fit: Math.round(t3 - t2) },
        },
        cap.image,
      );
    }
    wasTracking = !!out.xf;
    // debug log: found / lost (a frame kept from the last fit counts as still tracking)
    const tracking = !!out.xf || !!frame;
    if (tracking !== dbgTracking) {
      dbgTracking = tracking;
      debugEvent("mappins", tracking ? "found" : "lost", {
        how: out.how,
        waypoints: sc?.wpInliers,
        icons: sc?.iconInliers,
        pins: frame?.pins.length ?? 0,
        preset: useSettings.getState().settings.mapPins.preset,
        menu: !!area.chrome,
        fitMs: Math.round(t3 - t2),
      });
    }
    return out.xf ? PROBE_MS : area.chrome ? 900 : 2000;
  }

  const loop = async () => {
    const t = performance.now();
    let next = 2000;
    try {
      next = await tick();
    } catch (e) {
      debugEvent("mappins", "error", { error: String(e) });
      console.warn("map pins tick failed", e);
      clear();
    }
    // the interval is start to start: a slow capture doesn't stretch it
    setTimeout(loop, Math.max(next === 0 ? 0 : 120, next - (performance.now() - t)));
  };
  setTimeout(loop, 3000);

  // dragging the map: a slow drag barely changes the probe's strip, and a full frame mid-drag placed pins
  // that then slid. A held mouse button hides them at once (read-only OS state, nothing sent to the game);
  // they come back once it's let go and a probe sees the map still.
  const holdLoop = async () => {
    try {
      if (tracker.tracking || shown) {
        const down = await mouseDown();
        if (down && !held) {
          held = true;
          debugEvent("mappins", "drag", { why: "mouse button held on the open map: pins hidden" });
          shown = pending = null;
          settling = true;
          send(null);
        } else if (!down && held) {
          held = false;
          lastFull = 0; // a fresh full frame right away
        }
      } else held = false;
    } catch {
      held = false;
    }
    setTimeout(holdLoop, 50);
  };
  setTimeout(holdLoop, 3000);
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
