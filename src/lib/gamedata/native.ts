// Typed wrappers around the game-data commands in src-tauri/src/gamedata.rs.
import { invoke } from "@tauri-apps/api/core";

// gamedata_read_batch frames several files into one buffer; unframeBatch lives in io.ts so the
// worker can use it without pulling the Tauri API in.
export { unframeBatch } from "./io";

export interface Candidate {
  dir: string;
  source: "settings" | "registry" | "battle.net" | "common";
  valid: boolean;
}
export interface Detected {
  dir: string | null;
  candidates: Candidate[];
}
export interface CascOut {
  matched: number;
  extracted: number;
  failed: number;
}

/** Look for the Diablo IV folder: the saved one, the registry, Battle.net's product.db, usual paths. */
export const detectInstall = (saved?: string | null) => invoke<Detected>("gamedata_detect", { saved: saved ?? null });
/** The install's `.build.info` as text. Throws when the folder is not a Diablo IV install. */
export const readBuildInfoFile = (dir: string) => invoke<string>("gamedata_build_info", { dir });
/** The Windows folder picker, for an install in an unusual place. null when the player cancels. */
export const pickGameFolder = () => invoke<string | null>("gamedata_pick_folder");

export const cacheDir = () => invoke<string>("gamedata_cache_dir");
export const readBatchRaw = (rels: string[]) => invoke<ArrayBuffer>("gamedata_read_batch", { rels });
export const listCache = (rel: string) => invoke<string[]>("gamedata_list", { rel });
/** The game builds the cache holds a finished read for. */
export const cachedBuilds = () => invoke<string[]>("gamedata_builds");
export const writeCache = (rel: string, text: string) => invoke<void>("gamedata_write", { rel, text });
export const readCacheText = (rel: string) => invoke<string | null>("gamedata_read_text", { rel });
export const cleanCache = (rel: string) => invoke<void>("gamedata_clean", { rel });
export const pruneCache = (keep: string[]) => invoke<number>("gamedata_prune", { keep });
export const cacheDirSize = (rel: string) => invoke<number>("gamedata_dir_size", { rel });
export const readResource = (rel: string) => invoke<ArrayBuffer>("gamedata_resource", { rel });
export const runCascx = (args: { game: string; raw: string; names: string[]; mode: "mask" | "list" }) => invoke<CascOut>("gamedata_casc", { args });
