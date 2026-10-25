// Icon recognition, from the app's side: get the model, get a library, and score the art in a
// tooltip while it's being judged.
//
// Only one picture is embedded per judgement, and only for an item whose name is worth checking,
// so this costs one ONNX run on the GPU per tooltip, not a stream of them. Everything expensive
// happens in worker.ts; this file reads files (only the main thread can call Rust), decides what
// to do and keeps the status the Settings card shows.
import { invoke } from "@tauri-apps/api/core";
import { debugEvent } from "../debug";
import { isTauri } from "../http";
import { plan } from "./extract";
import { installModel, modelBytes, modelInstalled, type Dtype } from "./model";
import { gameData, onGameData, type GameData } from "./registry";
import { setIcons, useIcons } from "./status";
import type { Backend, FromWorker, ToWorker } from "./protocol";
import type { IconLibrary, IconPlanWire, Rect } from "./types";

/** How long a tooltip's icon may take before the judgement goes ahead without it. */
const SCORE_TIMEOUT_MS = 2500;
/** How much of the build's progress bar reading the game's tables gets, before any picture. */
const PLAN_SHARE = 0.15;

let worker: Worker | null = null;
let starting: Promise<void> | null = null;
let nextId = 1;
const scoreWaiters = new Map<number, (s: Record<string, number> | null) => void>();
let buildResolve: (() => void) | null = null;
let waitingForData = false;

const send = (m: ToWorker, transfer?: Transferable[]) => worker?.postMessage(m, transfer ?? []);

// ---- the app cache folder -----------------------------------------------------------------
const libraryPath = (gameBuild: string) => `library/${gameBuild.replace(/[^0-9A-Za-z.]/g, "_")}.json`;

async function readCachedLibrary(gameBuild: string): Promise<IconLibrary | null> {
  try {
    const buf = await invoke<ArrayBuffer>("icon_cache_read", { path: libraryPath(gameBuild) });
    return JSON.parse(new TextDecoder().decode(buf)) as IconLibrary;
  } catch {
    return null;
  }
}

async function writeCachedLibrary(lib: IconLibrary) {
  const json = JSON.stringify(lib);
  let bin = "";
  const bytes = new TextEncoder().encode(json);
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  await invoke("icon_cache_write", { path: libraryPath(lib.gameBuild), base64: btoa(bin) });
}

// ---- the GPU ------------------------------------------------------------------------------
/** WebGPU is what this feature is for: the GPU does the matmuls and the CPU keeps reading the screen. */
async function webgpuAvailable(): Promise<boolean> {
  const gpu = (navigator as Navigator & { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
  if (!gpu) return false;
  try {
    return !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}

// ---- the worker ---------------------------------------------------------------------------
function spawn(): Worker {
  const w = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
  w.onmessage = async (ev: MessageEvent<FromWorker>) => {
    const m = ev.data;
    if (m.t === "need") {
      const bytes = (await gameData()?.files.read(m.rel)) ?? null;
      // a fresh copy: the buffer is transferred, and the reader may be handing out a view of a cache
      const copy = bytes ? bytes.slice().buffer : null;
      send({ t: "file", id: m.id, bytes: copy }, copy ? [copy] : []);
    } else if (m.t === "progress") {
      // the plan took the first 15%, the pictures take the rest
      setIcons({ progress: PLAN_SHARE + (1 - PLAN_SHARE) * (m.total ? m.done / m.total : 0) });
    } else if (m.t === "built") {
      await writeCachedLibrary(m.lib).catch(() => {});
      setIcons({ state: "ready", progress: null, entries: m.lib.entries.length, gameBuild: m.lib.gameBuild, note: "" });
      debugEvent("icons", "library-built", { entries: m.lib.entries.length, gameBuild: m.lib.gameBuild, ms: m.ms });
      buildResolve?.();
      buildResolve = null;
    } else if (m.t === "scores") {
      setIcons({ lastMs: m.ms });
      scoreWaiters.get(m.id)?.(m.scores);
      scoreWaiters.delete(m.id);
    } else if (m.t === "ready") {
      setIcons({ backend: m.backend });
      debugEvent("icons", "model-ready", { backend: m.backend, ms: m.ms });
    } else if (m.t === "error") {
      debugEvent("icons", "error", { message: m.message });
      if (m.id != null) {
        scoreWaiters.get(m.id)?.(null);
        scoreWaiters.delete(m.id);
      } else {
        setIcons({ state: "unavailable", progress: null, note: m.message.slice(0, 120) });
        buildResolve?.();
        buildResolve = null;
      }
    }
  };
  return w;
}

// ---- turning it on ------------------------------------------------------------------------
/**
 * Get icon recognition ready, or say why it can't be. Safe to call again: the first call does the
 * work and the rest wait for it.
 */
export function startIcons(): Promise<void> {
  starting ??= run().finally(() => {
    starting = null;
  });
  return starting;
}

async function run() {
  if (!isTauri) return setIcons({ state: "unavailable", note: "Only in the app." });
  setIcons({ state: "checking", progress: null, note: "" });
  const gpu = await webgpuAvailable();
  const dtype: Dtype = gpu ? "fp16" : "q8";

  // the model, once, from our own release
  if (!(await modelInstalled(dtype))) {
    if (!gpu) return setIcons({ state: "unavailable", note: "This PC has no GPU the app can use for this." });
    setIcons({ state: "downloading", progress: 0 });
    try {
      await installModel(dtype, (f) => setIcons({ progress: f }));
    } catch (e) {
      debugEvent("icons", "model-download-failed", { error: String(e) });
      return setIcons({ state: "unavailable", progress: null, note: `Couldn't get the model: ${String((e as Error).message ?? e).slice(0, 90)}` });
    }
  }

  worker ??= spawn();
  const model = await modelBytes(dtype);
  send({ t: "init", model, backend: (gpu ? "webgpu" : "wasm") satisfies Backend }, [model]);

  // the library, built here from the player's own install
  const data = gameData();
  if (!data) {
    setIcons({ state: "unavailable", progress: null, note: "Waiting for your game files to be read." });
    if (!waitingForData) {
      waitingForData = true;
      onGameData(() => {
        waitingForData = false;
        void startIcons();
      });
    }
    return;
  }
  const gameBuild = await data.files.build();
  const cached = await readCachedLibrary(gameBuild);
  if (cached && cached.gameBuild === gameBuild) {
    send({ t: "library", lib: cached });
    return setIcons({ state: "ready", progress: null, entries: cached.entries.length, gameBuild, note: "" });
  }
  // building needs ~1,000 runs of the model: only worth doing on the GPU
  if (!gpu) return setIcons({ state: "unavailable", progress: null, note: "This PC has no GPU the app can use for this." });

  setIcons({ state: "building", progress: 0, gameBuild });
  try {
    const p = await planFor(data, (done, total) => setIcons({ progress: (PLAN_SHARE * done) / Math.max(1, total) }));
    debugEvent("icons", "library-plan", { art: p.items.length, sheets: p.sheets.length, via: p.via, noArt: p.noArt.length, gameBuild });
    // the sheets' pixel data has to be out of CASC before the worker asks for it
    await data.files.ensure?.(p.sheets.map((s) => `base:payload\\${s.sno}`));
    await new Promise<void>((resolve) => {
      buildResolve = resolve;
      send({ t: "build", plan: p, gameBuild });
    });
  } catch (e) {
    // a table this build keeps encrypted, or the game files couldn't be read at all
    debugEvent("icons", "library-failed", { error: String(e), gameBuild });
    setIcons({ state: "unavailable", progress: null, note: `Couldn't read your item pictures: ${String((e as Error).message ?? e).slice(0, 80)}` });
  } finally {
    // the copies the plan and the build needed aren't wanted again until the next patch
    await data.files.release?.().catch(() => {});
  }
}

/** The plan, worked out by the reader's own worker when it has one, else here. */
function planFor(data: GameData, onStep: (done: number, total: number) => void): Promise<IconPlanWire> {
  if (data.plan) return data.plan(onStep);
  const meta = data.meta;
  if (!meta) throw new Error("the game data reader can't say which art to read");
  return data.files.uniques().then((uniques) =>
    plan(data.files, meta, uniques, async (done, total) => {
      onStep(done, total);
      // the tables are being parsed on this thread: let the window breathe between batches
      await new Promise((r) => setTimeout(r, 0));
    }),
  );
}

/** Turn it off and let go of the model (the session holds a few hundred MB). */
export function stopIcons() {
  worker?.terminate();
  worker = null;
  scoreWaiters.forEach((fn) => fn(null));
  scoreWaiters.clear();
  // a build in flight dies with the worker: let whoever is waiting on it go
  buildResolve?.();
  buildResolve = null;
  setIcons({ state: "off", progress: null, note: "", backend: null, entries: 0, lastMs: null });
}

/** Is there a library loaded and a model to match it with? */
export const iconsReady = () => useIcons.getState().state === "ready";

/**
 * The cosine of the art in this tooltip against every unique's art, for identify.ts. Null when
 * icon recognition isn't ready, the square isn't fully in the crop, or it took too long: the text
 * signals decide on their own then, as they always have.
 */
export async function iconScores(jpeg: ArrayBuffer, box: Rect, region: Rect, className?: string): Promise<Record<string, number> | null> {
  if (!iconsReady() || !worker) return null;
  const id = nextId++;
  return new Promise<Record<string, number> | null>((resolve) => {
    const timer = setTimeout(() => {
      scoreWaiters.delete(id);
      resolve(null);
    }, SCORE_TIMEOUT_MS);
    scoreWaiters.set(id, (s) => {
      clearTimeout(timer);
      resolve(s);
    });
    send({ t: "embed", id, jpeg, box, region, className }, [jpeg]);
  });
}
