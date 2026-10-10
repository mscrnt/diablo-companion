// Capture loop for pins on the in-game map (registration itself: mappins.ts).
// Screen capture only: frames of the game window, nothing else.
//
// While the game is on screen and the feature is on:
//   - map not registered: every 2 s, a small capture of the top band asks "is a full-screen
//     menu open?" (its dark nav bar); only then the whole game image is captured and fitted
//   - map registered: every ~600 ms, the whole game image, tracked frame to frame
// The overlay gets the pins in absolute screen px plus the visible map area to clip to.
import { create } from "zustand";
import { emitOverlay } from "./bus";
import { captureRegion, type CaptureResult } from "./native";
import { MapTracker, mapArea, navBarInBand, pinsFor, type Box, type Frame, type Pin, type TrackOut } from "./mappins";
import { useSettings } from "./store";
import { testLog, testModeOn } from "./testmode";

type Rect = [number, number, number, number];

/** What the overlay draws. Coordinates are absolute physical screen px. */
export interface MapPinsFrame {
  pins: Pin[];
  /** visible map area (between the nav bar and the hint bar) */
  clip: { x: number; y: number; w: number; h: number };
  /** zoom level (map scale / image height), for decluttering when zoomed out */
  zoom: number;
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
  at?: number;
}

export const useMapPins = create<{ status: MapPinsStatus }>(() => ({ status: { state: "off" } }));

/** Frames are fitted at this image height (icons are ~18 px there; more pixels buy nothing). */
const FIT_HEIGHT = 720;
const NAV_BAND = 0.11;

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

/**
 * `active`: game on screen, overlay showing, feature on. `helltideRegion`: POI region key of
 * the running Helltide (e.g. "Dry_Steppes"), or null.
 */
export function startMapPins(active: () => boolean, gameRect: () => Rect | null, helltideRegion: () => string | null) {
  const tracker = new MapTracker();
  let lastSent = "";
  let lastLog = 0;
  let wasTracking = false;

  const send = (f: MapPinsFrame | null) => {
    const key = f ? JSON.stringify(f) : "";
    if (key === lastSent) return;
    lastSent = key;
    emitOverlay("mappins", f);
  };
  const setStatus = (p: Partial<MapPinsStatus>) => useMapPins.setState((s) => ({ status: { ...s.status, ...p, at: Date.now() } }));

  async function tick(): Promise<number> {
    const rect = gameRect();
    const { mapPins, overlay } = useSettings.getState().settings;
    const on = mapPins.enabled;
    // an overlay that shows in screen captures would put our own pins into the frames we read
    if (!on || overlay.capturable || !active() || !rect || rect[2] < 200 || rect[3] < 200) {
      tracker.reset();
      send(null);
      setStatus({ state: !on ? "off" : overlay.capturable ? "paused" : "idle", how: undefined });
      return 2000;
    }
    const img = gameImage(rect);
    const st = useMapPins.getState().status;

    // not registered yet: a cheap look at the top band first
    if (!tracker.tracking) {
      const t0 = performance.now();
      const band = await captureRegion({ x: img.x, y: img.y, w: img.w, h: Math.round(img.h * NAV_BAND) }, { maxEdge: 640, quality: 70 });
      const f = await decode(band.image);
      if (!navBarInBand(f, NAV_BAND)) {
        send(null);
        setStatus({ state: "idle", how: "closed", captureMs: avg(st.captureMs, performance.now() - t0) });
        return 2000;
      }
    }

    const scale = Math.min(1, FIT_HEIGHT / img.h);
    const t0 = performance.now();
    const cap: CaptureResult = await captureRegion(img, { maxEdge: Math.round(Math.max(img.w, img.h) * scale), quality: 92 });
    const t1 = performance.now();
    const fr = await decode(cap.image);
    const t2 = performance.now();
    const H = fr.height;
    const area = mapArea(fr);
    const out = tracker.step(fr, H, area, H / 1440);
    const t3 = performance.now();

    // frame px → absolute screen px
    const sx = cap.region.w / fr.width, sy = cap.region.h / fr.height;
    const toScreen = (x: number, y: number): [number, number] => [cap.region.x + x * sx, cap.region.y + y * sy];
    let pins: Pin[] = [];
    if (out.xf) {
      const s = useSettings.getState().settings.mapPins;
      pins = pinsFor(out.xf, area, H, { groups: s.groups, helltideRegion: helltideRegion() }, toScreen);
      const [cx, cy] = toScreen(area.x0, area.y0);
      const [cx1, cy1] = toScreen(area.x1, area.y1);
      send({ pins, clip: { x: Math.round(cx), y: Math.round(cy), w: Math.round(cx1 - cx), h: Math.round(cy1 - cy) }, zoom: out.xf.s / H });
    } else send(null);

    const sc = out.fit?.score;
    setStatus({
      state: out.xf ? "tracking" : area.chrome ? "menu" : "idle",
      how: out.how,
      waypoints: sc?.wpInliers,
      icons: sc?.iconInliers,
      pins: pins.length,
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
          zooms: tracker.zooms,
          frame: { w: fr.width, h: fr.height, region: cap.region },
          area: { ...area, hud: area.hud as Box[] },
          ms: { capture: Math.round(t1 - t0), decode: Math.round(t2 - t1), fit: Math.round(t3 - t2) },
        },
        cap.image,
      );
    }
    wasTracking = !!out.xf;
    return out.xf ? 600 : area.chrome ? 900 : 2000;
  }

  const loop = async () => {
    const t = performance.now();
    let next = 2000;
    try {
      next = await tick();
    } catch (e) {
      console.warn("map pins tick failed", e);
      tracker.reset();
      send(null);
    }
    // the interval is start to start: a slow capture doesn't stretch it
    setTimeout(loop, Math.max(150, next - (performance.now() - t)));
  };
  setTimeout(loop, 3000);
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
