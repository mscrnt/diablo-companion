// What icon recognition is doing right now, for the Settings card. Not persisted: it's worked out
// again every start (is the model there, is the library still for this game build).
import { create } from "zustand";
import type { Backend } from "./protocol";

export type IconState =
  /** the setting is off */
  | "off"
  /** looking for the GPU, the model and the library */
  | "checking"
  /** getting the model from our own release, once */
  | "downloading"
  /** reading the art out of the game install and embedding it */
  | "building"
  | "ready"
  /** no WebGPU, or the game data isn't readable: the reason is in `note` */
  | "unavailable";

interface IconsState {
  state: IconState;
  /** 0..1 while downloading or building, else null */
  progress: number | null;
  /** one short line for the player */
  note: string;
  backend: Backend | null;
  /** pieces of art in the library */
  entries: number;
  /** the game build the library was built from */
  gameBuild: string;
  /** milliseconds the last tooltip's icon took (embed + match) */
  lastMs: number | null;
}

export const useIcons = create<IconsState>(() => ({
  state: "off",
  progress: null,
  note: "",
  backend: null,
  entries: 0,
  gameBuild: "",
  lastMs: null,
}));

export const setIcons = (p: Partial<IconsState>) => useIcons.setState(p);

/** The line the Settings card shows. */
export function iconStatusLine(s: IconsState): string {
  if (s.state === "off") return "Off.";
  if (s.state === "checking") return "Checking…";
  if (s.state === "downloading") return `Getting the model, once: ${Math.round((s.progress ?? 0) * 100)}%`;
  if (s.state === "building") return `Reading your item pictures: ${Math.round((s.progress ?? 0) * 100)}%`;
  if (s.state === "unavailable") return s.note || "Not available on this PC.";
  return `Ready, ${s.entries} pictures${s.backend === "wasm" ? ", on the CPU (no GPU found)" : ""}.`;
}
