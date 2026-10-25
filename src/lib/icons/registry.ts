// Where the game data reader is plugged in.
//
// Reading the player's Diablo IV install (CASC) is the game data extractor's job, not this
// feature's: it owns the Rust/cascx side and the raw file cache. Icon recognition asks for files by
// their path in that cache and for the build and the unique list, nothing more (GameFiles and
// GameMeta in types.ts), so whoever owns the reader registers it here once and this feature works:
//
//   import { registerGameData } from "../icons/registry";
//   registerGameData({ files: myReader, meta: myMetaReader });
//
// Until something does, icon recognition says it needs the game data and stays off. The dev path
// in devio.ts registers a reader that points at an extractor cache on disk.
import type { GameFiles, GameMeta } from "./types";

export interface GameData {
  files: GameFiles;
  meta: GameMeta;
}

let registered: GameData | null = null;
const waiting = new Set<(g: GameData) => void>();

export function registerGameData(g: GameData) {
  registered = g;
  for (const fn of waiting) fn(g);
  waiting.clear();
}

export const gameData = () => registered;

/** Resolves as soon as a reader is registered (it may be registered after the app starts). */
export function onGameData(fn: (g: GameData) => void): () => void {
  if (registered) {
    fn(registered);
    return () => {};
  }
  waiting.add(fn);
  return () => waiting.delete(fn);
}
