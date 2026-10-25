// The GameDataIO the app uses, on the main thread: every file and every cascx run goes through the
// Rust commands. The extractor itself runs in a Web Worker and reaches this through host.ts, so the
// heavy parsing never blocks the window.

import { cacheDirSize, cleanCache, listCache, readBatchRaw, readCacheText, readResource, runCascx, writeCache } from "./native";
import { unframeBatch, type CascResult, type GameDataIO, type Progress } from "./io";

const UTF8 = new TextDecoder("utf-8");

export interface TauriIoOpts {
  /** the Diablo IV folder, for cascx */
  game: string;
  /** the cache sub-folder for this build, e.g. "3.2.3.73883" */
  base: string;
  onProgress?: (p: Progress) => void;
}

/** Paths inside the cache folder: "<build>/raw/..." for the copies, "<build>/..." for our JSON. */
export const rawRel = (base: string, rel = "") => `${base}/raw${rel ? "/" + rel : ""}`;
export const outRel = (base: string, rel = "") => `${base}${rel ? "/" + rel : ""}`;

export function tauriIo({ game, base, onProgress }: TauriIoOpts): GameDataIO {
  const vendorCache = new Map<string, string>();
  return {
    async read(rel) {
      const [b] = unframeBatch(await readBatchRaw([rawRel(base, rel)]));
      return b;
    },
    async readMany(rels) {
      return unframeBatch(await readBatchRaw(rels.map((r) => rawRel(base, r))));
    },
    async list(rel) {
      return listCache(rawRel(base, rel));
    },
    async vendor(rel) {
      let text = vendorCache.get(rel);
      if (text === undefined) {
        text = UTF8.decode(await readResource(rel));
        // definitions.json is 7.6 MB: hold on to the small ones only
        if (text.length < 1_000_000) vendorCache.set(rel, text);
      }
      return text;
    },
    async write(rel, text) {
      await writeCache(outRel(base, rel), text);
    },
    async readOut(rel) {
      return readCacheText(outRel(base, rel));
    },
    async clean(rel) {
      await cleanCache(outRel(base, rel));
    },
    async cleanRaw() {
      await cleanCache(rawRel(base));
    },
    async casc(names, mode): Promise<CascResult> {
      const r = await runCascx({ game, raw: rawRel(base), names, mode });
      return r;
    },
    async rawBytes() {
      return cacheDirSize(rawRel(base));
    },
    progress(p) {
      onProgress?.(p);
    },
    async tick() {
      /* the worker's own IO yields; nothing to do on this side */
    },
  };
}
