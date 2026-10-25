// The icon worker: SigLIP2 on the GPU, off the UI thread.
//
// It does the two expensive things: embedding a picture (one ONNX run) and, on first enable or
// after a game patch, decoding the game's texture sheets and embedding every piece of unique art
// into the library. The main thread reads the files (only it can call Rust) and answers this
// worker's requests for them.
//
// WebGPU is the point of running here: the model's matmuls go to the GPU and the CPU stays free
// for reading the screen. Without WebGPU the wasm backend is used single-threaded, which is only
// fast enough for the odd tooltip (see recognise.ts: it won't build a library that way).
import * as ort from "onnxruntime-web/webgpu";
// the wasm the WebGPU build runs on, as a URL Vite serves in dev and emits with the app in a build (left to
// itself, ORT looks for it next to its pre-bundled copy in dev, where it isn't)
import ortWasm from "onnxruntime-web/ort-wasm-simd-threaded.asyncify.wasm?url";
import { artInCrop } from "./crop";
import { cutArt } from "./extract";
import { matchIcon, packLibrary, loadLibrary, quantise, type LoadedLibrary } from "./library";
import { l2, letterbox, pixelValues } from "./square";
import type { Backend, FromWorker, ToWorker } from "./protocol";
import { DIMS, SIZE, type GameFiles, type IconPlanWire, type LibraryEntry, type Rect } from "./types";

const post = (m: FromWorker, transfer?: Transferable[]) => (self as unknown as Worker).postMessage(m, transfer ?? []);

let session: ort.InferenceSession | null = null;
let library: LoadedLibrary | null = null;

// ---- files the main thread fetches for us -------------------------------------------------
let nextFileId = 1;
const pending = new Map<number, (b: ArrayBuffer | null) => void>();
const files: Pick<GameFiles, "read"> = {
  read: (rel) =>
    new Promise<Uint8Array | null>((resolve) => {
      const id = nextFileId++;
      pending.set(id, (b) => resolve(b ? new Uint8Array(b) : null));
      post({ t: "need", id, rel });
    }),
};

// ---- the model ----------------------------------------------------------------------------
async function init(model: ArrayBuffer, backend: Backend) {
  // ONNX Runtime's wasm ships with the app (Vite emits it next to this chunk), never a CDN: the
  // app has to work offline and must not call out to anyone. One thread: the GPU does the work,
  // and the CPU fallback has to stay light.
  ort.env.wasm.numThreads = 1;
  ort.env.wasm.wasmPaths = { wasm: ortWasm };
  ort.env.logLevel = "error";
  const t0 = performance.now();
  session = await ort.InferenceSession.create(model, {
    executionProviders: [backend === "webgpu" ? { name: "webgpu" } : { name: "wasm" }],
    graphOptimizationLevel: "all",
  });
  post({ t: "ready", backend, ms: Math.round(performance.now() - t0) });
}

/** One picture -> one unit vector. The square is the only thing the model ever sees. */
async function embedSquare(square: Uint8Array): Promise<Float32Array> {
  if (!session) throw new Error("the model isn't loaded");
  const input = new ort.Tensor("float32", pixelValues(square), [1, 3, SIZE, SIZE]);
  const out = await session.run({ pixel_values: input });
  // the vision model's pooled output. Both exports take and give float32 (the half-precision one
  // casts at its edges), so a tensor of any other type means the wrong model got loaded.
  const t = out.pooler_output ?? Object.values(out)[0];
  if (t.type !== "float32") throw new Error(`the model's output is ${t.type}, expected float32`);
  const v = Float32Array.from(t.data as Float32Array);
  if (v.length !== DIMS) throw new Error(`expected ${DIMS} dims from the model, got ${v.length}`);
  return l2(v);
}

// ---- building the library -----------------------------------------------------------------
async function build(plan: IconPlanWire, gameBuild: string) {
  const t0 = performance.now();
  const entries: LibraryEntry[] = [];
  const vectors = new Int8Array(plan.items.length * DIMS);
  let done = 0;
  post({ t: "progress", done: 0, total: plan.items.length });
  for await (const art of cutArt(files, plan)) {
    const v = await embedSquare(letterbox(art.rgba, art.w, art.h));
    quantise(v, vectors, entries.length * DIMS);
    entries.push(art.entry);
    if (++done % 16 === 0) {
      post({ t: "progress", done, total: plan.items.length });
      // low priority: hand the GPU and the event loop back between chunks, so a judgement that
      // comes in while the library is building isn't stuck behind a thousand icons
      await new Promise((r) => setTimeout(r, 0));
    }
  }
  const lib = packLibrary(entries, vectors, gameBuild);
  library = loadLibrary(lib);
  post({ t: "progress", done, total: plan.items.length });
  post({ t: "built", lib, ms: Math.round(performance.now() - t0) });
}

// ---- one tooltip --------------------------------------------------------------------------
/**
 * The art in one tooltip: find the square in the crop (the crop is downscaled, so this needs the
 * decoded size), cut it out and score it against the library. An empty answer when the square
 * isn't fully inside the crop: half a picture is worse than none.
 */
async function score(id: number, jpeg: ArrayBuffer, box: Rect, region: Rect, className?: string) {
  if (!library) throw new Error("no icon library yet");
  const t0 = performance.now();
  const bitmap = await createImageBitmap(new Blob([jpeg], { type: "image/jpeg" }));
  const sq = artInCrop(box, region, bitmap.width, bitmap.height);
  if (!sq) {
    bitmap.close();
    return post({ t: "scores", id, scores: {}, ms: Math.round(performance.now() - t0) });
  }
  const canvas = new OffscreenCanvas(sq.w, sq.h);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bitmap, sq.x, sq.y, sq.w, sq.h, 0, 0, sq.w, sq.h);
  bitmap.close();
  const rgba = new Uint8Array(ctx.getImageData(0, 0, sq.w, sq.h).data.buffer);
  const v = await embedSquare(letterbox(rgba, sq.w, sq.h));
  post({ t: "scores", id, scores: matchIcon(library, v, className), ms: Math.round(performance.now() - t0) });
}

self.onmessage = async (ev: MessageEvent<ToWorker>) => {
  const m = ev.data;
  try {
    if (m.t === "file") {
      pending.get(m.id)?.(m.bytes);
      pending.delete(m.id);
    } else if (m.t === "init") await init(m.model, m.backend);
    else if (m.t === "library") library = loadLibrary(m.lib);
    else if (m.t === "build") await build(m.plan, m.gameBuild);
    else if (m.t === "embed") await score(m.id, m.jpeg, m.box, m.region, m.className);
  } catch (e) {
    post({ t: "error", id: "id" in m ? m.id : undefined, message: String((e as Error)?.message ?? e) });
  }
};
