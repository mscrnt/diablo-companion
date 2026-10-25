// Main-thread side of the reader: start the worker, serve its file requests through the Rust
// commands, and pass progress on. Nothing heavy happens here.

import { readBatchRaw } from "./native";
import { rawRel, tauriIo } from "./tauriIo";
import type { BuildInfo, Progress } from "./io";
import type { WorkerMessage, WorkerRequest } from "./worker";

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
    const reply = (id: number, ok: boolean, value: unknown, transfer: Transferable[] = []) =>
      worker.postMessage({ t: "ioResult", id, ok, value }, transfer);

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
      if (msg.t !== "io") return;
      try {
        if (msg.fn === "readBatchRaw") {
          // one buffer with every file in it, handed straight over without a copy
          const rels = (msg.args[0] as string[]).map((r) => rawRel(opts.base, r));
          const buf = await readBatchRaw(rels);
          return reply(msg.id, true, buf, [buf]);
        }
        const fn = (io as unknown as Record<string, (...a: unknown[]) => unknown>)[msg.fn];
        if (typeof fn !== "function") throw new Error("unknown io call " + msg.fn);
        reply(msg.id, true, await fn.apply(io, msg.args));
      } catch (e) {
        reply(msg.id, false, String((e as Error)?.message ?? e));
      }
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
