// Main-thread side of the reader: start the worker, serve its file requests through the Rust
// commands, and pass progress on. Nothing heavy happens here.

import { iconBase } from "./icons";
import { readBatchRaw } from "./native";
import { rawRel, tauriIo } from "./tauriIo";
import type { BuildInfo, GameDataIO, Progress } from "./io";
import type { IconPlanWire, UniqueRow } from "../icons/types";
import type { WorkerMessage, WorkerRequest } from "./worker";

/**
 * Do one of the worker's IO calls here, where the Tauri IPC lives. Both jobs below are driven this
 * way: the worker parses, this thread does the file and process calls.
 */
async function serveIo(worker: Worker, io: GameDataIO, base: string, msg: Extract<WorkerMessage, { t: "io" }>) {
  const reply = (ok: boolean, value: unknown, transfer: Transferable[] = []) => worker.postMessage({ t: "ioResult", id: msg.id, ok, value }, transfer);
  try {
    if (msg.fn === "readBatchRaw") {
      // one buffer with every file in it, handed straight over without a copy
      const buf = await readBatchRaw((msg.args[0] as string[]).map((r) => rawRel(base, r)));
      return reply(true, buf, [buf]);
    }
    const fn = (io as unknown as Record<string, (...a: unknown[]) => unknown>)[msg.fn];
    if (typeof fn !== "function") throw new Error("unknown io call " + msg.fn);
    reply(true, await fn.apply(io, msg.args));
  } catch (e) {
    reply(false, String((e as Error)?.message ?? e));
  }
}

export interface ReadOpts {
  game: string;
  build: BuildInfo;
  /** the cache sub-folder, normally the build version */
  base: string;
  skipCasc?: boolean;
  dropRaw?: boolean;
  keep?: string[];
  onProgress?: (p: Progress) => void;
}

export interface ReadDone {
  build: string;
  manifest: any;
  cache: any;
}

/** Read the game data in a worker. Resolves when the cache folder holds everything. */
export function readInWorker(opts: ReadOpts): Promise<ReadDone> & { cancel: () => void } {
  const io = tauriIo({ game: opts.game, base: opts.base, onProgress: opts.onProgress });
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "gamedata" });
  let cancelled = false;

  const promise = new Promise<ReadDone>((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "the game data worker stopped"));
    worker.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data as WorkerMessage;
      if (msg.t === "progress") return opts.onProgress?.(msg.p);
      if (msg.t === "done") {
        worker.terminate();
        return resolve({ build: msg.build, manifest: msg.manifest, cache: msg.cache });
      }
      if (msg.t === "error") {
        worker.terminate();
        return reject(new Error(msg.message));
      }
      if (msg.t === "io") await serveIo(worker, io, opts.base, msg);
    };

    worker.postMessage({
      t: "run", build: opts.build, skipCasc: opts.skipCasc, dropRaw: opts.dropRaw, keep: opts.keep,
    } satisfies WorkerRequest);
  });

  return Object.assign(promise, {
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      worker.terminate();
    },
  });
}

export interface IconPlanOpts {
  /** the Diablo IV folder, for cascx */
  game: string;
  build: string;
  uniques: UniqueRow[];
  onStep?: (done: number, total: number) => void;
}

/**
 * Work the icon plan out in a reader worker, so the couple of thousand record parses it takes stay
 * off the window's thread. Resolves with the plan; the icon worker cuts and embeds the art from it.
 */
export function planIconsInWorker({ game, build, uniques, onStep }: IconPlanOpts): Promise<IconPlanWire> {
  const base = iconBase(build);
  const io = tauriIo({ game, base });
  const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "gamedata-icons" });
  return new Promise<IconPlanWire>((resolve, reject) => {
    worker.onerror = (e) => reject(new Error(e.message || "the game data worker stopped"));
    worker.onmessage = async (ev: MessageEvent) => {
      const msg = ev.data as WorkerMessage;
      if (msg.t === "progress") return onStep?.(msg.p.done ?? 0, msg.p.total ?? 0);
      if (msg.t === "iconPlan") {
        worker.terminate();
        return resolve(msg.plan);
      }
      if (msg.t === "error") {
        worker.terminate();
        return reject(new Error(msg.message));
      }
      if (msg.t === "io") await serveIo(worker, io, base, msg);
    };
    worker.postMessage({ t: "iconPlan", build, uniques } satisfies WorkerRequest);
  });
}
