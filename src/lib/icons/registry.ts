// Where the game data reader is plugged in.
//
// Reading the player's Diablo IV install (CASC) is the game data reader's job, not this feature's:
// it owns the Rust/cascx side and the raw file cache. Icon recognition asks for files by their path
// in that cache and for the build and the unique list, nothing more (GameFiles and GameMeta in
// types.ts), so whoever owns the reader registers it here once and this feature works:
//
//   import { registerGameData } from "../icons/registry";
//   registerGameData({ files: myReader, plan: myPlanner });
//
// In the app that is `registerIcons()` in src/lib/gamedata/index.ts, called when the setting is
// turned on. Until something registers, icon recognition says it needs the game data and stays off.
import type { GameFiles, GameMeta, IconPlanWire } from "./types";

export interface GameData {
  files: GameFiles;
  /** The SNO reader, when the plan is worked out on the calling thread. */
  meta?: GameMeta;
  /**
   * Work the plan out somewhere else. A reader that owns a worker does it there, which keeps a
   * couple of thousand record parses off the window's thread; without this the plan is worked out
   * where it is asked for, from `files` and `meta`.
   */
  plan?(onStep: (done: number, total: number) => void): Promise<IconPlanWire>;
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
