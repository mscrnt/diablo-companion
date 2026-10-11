// Cross-window messaging. The dashboard ("main") window owns all state and logic;
// the overlay window is a renderer that receives snapshots over Tauri events.
import { emitTo, listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isTauri } from "./http";

export type OverlayEvent = "state" | "verdict" | "toast" | "judging" | "tooltip" | "guide" | "hordes" | "advisor" | "helltide" | "boss" | "mappins" | "debug-request";
export type MainEvent = "layout" | "overlay-ready" | "overlay-action" | "overlay-debug" | "debug-event";

export function emitOverlay(ev: OverlayEvent, payload: unknown) {
  if (!isTauri) return;
  emitTo("overlay", `ov:${ev}`, payload).catch(() => {});
}

export function emitMain(ev: MainEvent, payload: unknown) {
  if (!isTauri) return;
  emitTo("main", `main:${ev}`, payload).catch(() => {});
}

export function onOverlay<T>(ev: OverlayEvent, fn: (p: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(`ov:${ev}`, (e) => fn(e.payload));
}

export function onMain<T>(ev: MainEvent, fn: (p: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(`main:${ev}`, (e) => fn(e.payload));
}

export function onGlobal<T>(name: string, fn: (p: T) => void): Promise<UnlistenFn> {
  if (!isTauri) return Promise.resolve(() => {});
  return listen<T>(name, (e) => fn(e.payload));
}
