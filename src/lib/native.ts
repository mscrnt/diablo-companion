// Typed wrappers around the Rust commands in src-tauri/src/lib.rs.
import { invoke } from "@tauri-apps/api/core";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface OcrLine {
  text: string;
  x: number;
  y: number;
  w: number;
  h: number;
  /** tooltip bullet icon class, computed in Rust on the same frame as the text */
  bullet?: "greater" | "tempered" | "enchanted" | "masterwork" | "normal" | "none";
}

export interface OcrOut {
  text: string;
  lines: OcrLine[];
}

export interface CaptureResult {
  image: string; // base64 jpeg
  width: number;
  height: number;
  region: Rect;
  monitor: Rect;
  cursor: [number, number];
  ocr: OcrOut | null;
}

export interface CaptureOpts {
  maxEdge?: number;
  quality?: number;
  ocr?: boolean;
  ocrScale?: number;
  ocrMaxChannel?: boolean;
}

export interface GameStatus {
  running: boolean;
  focused: boolean;
  companionFocused: boolean;
  /** on screen: focused, or the focused window is on another monitor */
  visible: boolean;
  rect: [number, number, number, number] | null;
  foregroundTitle: string;
}

export const captureAtCursor = (width: number, height: number, opts: CaptureOpts = {}) =>
  invoke<CaptureResult>("capture_at_cursor", { width, height, opts });

export const captureRegion = (rect: Rect, opts: CaptureOpts = {}) => invoke<CaptureResult>("capture_region", { rect, opts });

export const captureMonitor = (point?: [number, number], opts: CaptureOpts = {}) =>
  invoke<CaptureResult>("capture_monitor", { point: point ?? null, opts });

export const ocrImage = (image: string, scale = 1) => invoke<OcrOut>("ocr_image", { image, scale });

export const listMonitors = () => invoke<[string, Rect, boolean][]>("list_monitors");

export const cursorPosition = () => invoke<[number, number]>("cursor_position");

/** A mouse button held down right now (read-only OS state). */
export const mouseDown = () => invoke<boolean>("mouse_down");

export const gameStatus = () => invoke<GameStatus>("game_status");

export const setOverlayInteractive = (interactive: boolean) => invoke("set_overlay_interactive", { interactive });

export const jpegUrl = (b64: string) => (b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`);

export const setOverlayCapturable = (capturable: boolean) => invoke("set_overlay_capturable", { capturable });
