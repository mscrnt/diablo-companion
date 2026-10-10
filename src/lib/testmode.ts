// Test mode: a play session doubles as a test run. While it's on, every auto-judge scan
// that finds a tooltip (and every near miss) is written to <app log dir>/test-mode with
// the captured frame, the tooltip boxes, all OCR lines, the parse and the verdict. A
// display snapshot (game window, monitors and DPI scale, overlay layout, black-bar
// detection) is written when test mode starts and whenever the window, mode or DPI
// changes, so a session can be checked against each resolution and window mode played.
// Off by default; the folder is capped (oldest files go first).
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./http";
import type { GameStatus } from "./native";
import { useSettings } from "./store";
import { APP_VERSION } from "./version";

export const TEST_FOLDER = "test-mode";

export const testModeOn = () => isTauri && useSettings.getState().settings.testMode.enabled;

const stamp = () => new Date().toISOString().replace(/[:.]/g, "-");

/** Write one record (JSON + optional JPEG frame) to the test-mode folder. */
export function testLog(kind: string, data: Record<string, unknown>, image?: string | null) {
  if (!testModeOn()) return;
  const { maxMB } = useSettings.getState().settings.testMode;
  const json = JSON.stringify({ kind, at: new Date().toISOString(), app: APP_VERSION, ...data }, null, 1);
  invoke("debug_log_write", { name: `${stamp()}_${kind}`, image: image ?? null, json, folder: TEST_FOLDER, maxFiles: 5000, maxMb: maxMB }).catch(() => {});
}

export async function openTestLog() {
  const dir = await invoke<string>("debug_log_dir", { folder: TEST_FOLDER });
  const { openPath } = await import("@tauri-apps/plugin-opener");
  await openPath(dir);
}

// ---- black bars ----------------------------------------------------------------------------

type Bars = { left: number; right: number; top: number; bottom: number } | null;
let lastBars: { at: string; rect: [number, number, number, number]; result: Bars } | null = null;

/** The engine's pillarbox detection reports every sample here (kept for snapshots, logged with its frame). */
export function noteBars(rect: [number, number, number, number], result: Bars, image: string) {
  lastBars = { at: new Date().toISOString(), rect, result };
  testLog("bars", { rect, result, gameBounds: useSettings.getState().settings.overlay.gameBounds }, image);
}

// ---- display context -----------------------------------------------------------------------

export interface DisplayInfo {
  monitors: { name: string; rect: [number, number, number, number]; scale: number; primary: boolean }[];
  game: { rect: [number, number, number, number]; client: [number, number]; caption: boolean; maximized: boolean } | null;
}

/** The monitor holding the centre of a window rect. */
export function monitorOf(rect: [number, number, number, number], monitors: DisplayInfo["monitors"]) {
  const [cx, cy] = [rect[0] + rect[2] / 2, rect[1] + rect[3] / 2];
  return monitors.find((m) => cx >= m.rect[0] && cx < m.rect[0] + m.rect[2] && cy >= m.rect[1] && cy < m.rect[1] + m.rect[3]) ?? null;
}

/** Title bar = windowed; borderless and filling its monitor = windowed fullscreen (or exclusive fullscreen). */
export function windowMode(g: NonNullable<DisplayInfo["game"]>, monitor: DisplayInfo["monitors"][number] | null) {
  if (g.caption) return "windowed";
  return monitor && g.rect[2] >= monitor.rect[2] && g.rect[3] >= monitor.rect[3] ? "fullscreen (borderless)" : "borderless window";
}

/** What the screen looked like: game window and mode, its monitor and DPI scale, overlay layout, bars. */
export async function displayContext() {
  const { useRuntime } = await import("./engine");
  const game = useRuntime.getState().game;
  const info = await invoke<DisplayInfo>("display_info").catch(() => null);
  const g = info?.game ?? null;
  const monitor = g && info ? monitorOf(g.rect, info.monitors) : null;
  const mode = g ? windowMode(g, monitor) : null;
  const o = useSettings.getState().settings.overlay;
  return {
    game: { status: game, window: g, mode, monitor },
    monitors: info?.monitors ?? null,
    // this dashboard window's own scale (the overlay sits on the game's monitor: see monitor.scale)
    devicePixelRatio: window.devicePixelRatio,
    screen: { w: window.screen.width, h: window.screen.height },
    overlay: { enabled: o.enabled, layout: o.layout, gameBounds: o.gameBounds, opacity: o.opacity, widgets: o.widgets },
    bars: lastBars,
  };
}

export async function logContext(reason: string) {
  if (!testModeOn()) return;
  testLog("context", { reason, ...(await displayContext()) });
}

// ---- change watchers -----------------------------------------------------------------------

let lastKey = "";
let debounce: ReturnType<typeof setTimeout> | null = null;

/** Called with every game-status update: log a snapshot when the window's size, place or focus-visible state settles. */
export function onGameStatus(game: GameStatus) {
  if (!testModeOn()) return;
  const key = `${game.running}|${game.rect?.join(",") ?? ""}`;
  if (key === lastKey) return;
  const first = !lastKey;
  lastKey = key;
  if (debounce) clearTimeout(debounce);
  // resizing fires many updates: wait for the window to settle
  debounce = setTimeout(() => logContext(first ? "first game window seen" : "game window size or position changed"), first ? 0 : 1500);
}

let watching = false;
/**
 * DPI scale changes (moving the dashboard to another monitor, changing Windows scaling) and
 * window-mode or monitor-scale changes that keep the same window rect (fullscreen ↔ borderless).
 */
export function watchTestContext() {
  if (watching || !isTauri) return;
  watching = true;
  const arm = () =>
    window.matchMedia(`(resolution: ${window.devicePixelRatio}dppx)`).addEventListener(
      "change",
      () => {
        logContext(`DPI scale changed to ${window.devicePixelRatio}`);
        arm();
      },
      { once: true },
    );
  arm();
  let modeKey = "";
  setInterval(async () => {
    if (!testModeOn()) return void (modeKey = "");
    const info = await invoke<DisplayInfo>("display_info").catch(() => null);
    if (!info) return;
    const g = info.game;
    const key = `${g ? `${g.caption}|${g.maximized}|${g.client.join("x")}` : "-"}|${info.monitors.map((m) => `${m.name}@${m.scale}`).join(",")}`;
    if (modeKey && key !== modeKey) logContext("window mode, client size or monitor scale changed");
    modeKey = key;
  }, 10_000);
}
