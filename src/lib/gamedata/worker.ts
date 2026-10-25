// The game-data reader, in a Web Worker.
//
// A worker cannot call Tauri directly (the IPC lives on the window), so every file read, write and
// cascx run is a small message to host.ts, which does it and sends the bytes back. The parsing
// itself, which is the expensive part, happens here and never blocks the window.
//
// Being polite with a player's CPU: tick() yields after every batch and sleeps briefly every so
// often, so reading the data next to a running game leaves the game plenty of room.

import { run, type RunResult } from "./pipeline";
import { unframeBatch, type GameDataIO, type Progress } from "./io";

export interface WorkerRequest {
  t: "run";
  build: any;
  skipCasc?: boolean;
  dropRaw?: boolean;
  /** which documents to write; everything else is only used in this run */
  keep?: string[];
}

export type WorkerMessage =
  | { t: "progress"; p: Progress }
  | { t: "io"; id: number; fn: string; args: unknown[] }
  | { t: "done"; build: string; manifest: any; cache: any }
  | { t: "error"; message: string };

let nextId = 1;
const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void }>();

/** Ask the host to do one IO call for us. */
function call<T>(fn: string, ...args: unknown[]): Promise<T> {
  const id = nextId++;
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve, reject });
    self.postMessage({ t: "io", id, fn, args } satisfies WorkerMessage);
  });
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));
let ticks = 0;

/** The IO the extractor sees: every method is one round trip to the host. */
function proxyIo(): GameDataIO {
  return {
    async read(rel) {
      const [b] = unframeBatch(await call<ArrayBuffer>("readBatchRaw", [rel]));
      return b;
    },
    async readMany(rels) {
      return unframeBatch(await call<ArrayBuffer>("readBatchRaw", rels));
    },
    list: (rel) => call("list", rel),
    vendor: (rel) => call("vendor", rel),
    write: (rel, text) => call("write", rel, text),
    readOut: (rel) => call("readOut", rel),
    clean: (rel) => call("clean", rel),
    cleanRaw: () => call("cleanRaw"),
    casc: (names, mode) => call("casc", names, mode),
    rawBytes: () => call("rawBytes"),
    progress(p) {
      self.postMessage({ t: "progress", p } satisfies WorkerMessage);
    },
    async tick() {
      // yield to this worker's event loop so the IO replies land, and every so often give the
      // machine a real breather (the game matters more than finishing a second sooner)
      await sleep(++ticks % 24 === 0 ? 8 : 0);
    },
  };
}

self.onmessage = async (ev: MessageEvent) => {
  const msg = ev.data as WorkerRequest | { t: "ioResult"; id: number; ok: boolean; value: any };
  if (msg.t === "ioResult") {
    const p = pending.get(msg.id);
    pending.delete(msg.id);
    if (p) msg.ok ? p.resolve(msg.value) : p.reject(new Error(String(msg.value)));
    return;
  }
  if (msg.t !== "run") return;
  try {
    const keep = msg.keep;
    const result: RunResult = await run({
      io: proxyIo(),
      build: msg.build,
      skipCasc: msg.skipCasc,
      dropRaw: msg.dropRaw,
      keep: keep ? (rel) => keep.includes(rel) : undefined,
    });
    self.postMessage({ t: "done", build: result.build.version, manifest: result.manifest, cache: result.cache } satisfies WorkerMessage);
  } catch (e) {
    self.postMessage({ t: "error", message: String((e as Error)?.message ?? e) } satisfies WorkerMessage);
  }
};
