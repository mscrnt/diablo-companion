// What the main thread and the icon worker say to each other. The worker does the GPU work and the
// texture decoding; the main thread owns the file reading (only it can call Rust) and the tables.
import type { IconLibrary, IconPlanWire, Rect } from "./types";

export type Backend = "webgpu" | "wasm";

export type ToWorker =
  /** the ONNX bytes, read from the app cache folder; `transfer` the buffer, it's ~186 MB */
  | { t: "init"; model: ArrayBuffer; backend: Backend }
  /** build the library: decode the planned sheets, cut the art, embed it */
  | { t: "build"; plan: IconPlanWire; gameBuild: string }
  /** a file the worker asked for ("base/payload/123456"), or null when it isn't there */
  | { t: "file"; id: number; bytes: ArrayBuffer | null }
  /** match against this library from now on */
  | { t: "library"; lib: IconLibrary }
  /** the art in one tooltip: the jpeg of the tooltip crop, the crop's screen rect and the tooltip's */
  | { t: "embed"; id: number; jpeg: ArrayBuffer; box: Rect; region: Rect; className?: string };

export type FromWorker =
  | { t: "ready"; backend: Backend; ms: number }
  | { t: "need"; id: number; rel: string }
  | { t: "progress"; done: number; total: number }
  | { t: "built"; lib: IconLibrary; ms: number }
  | { t: "scores"; id: number; scores: Record<string, number>; ms: number }
  | { t: "error"; id?: number; message: string };
