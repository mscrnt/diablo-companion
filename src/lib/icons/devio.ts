// A stand-in game data reader for dev builds, so icon recognition can be tried end to end before
// the in-app reader exists: it points at a datamine cache on disk (the folder
// tools/datamine/extract.mjs writes, data/gamedata) and reads the same files the real reader will.
//
// Dev builds only: icon_dev_read refuses in a release build, and nothing here is reachable from the
// UI. Delete this file once the reader is wired up in registry.ts.
import { invoke } from "@tauri-apps/api/core";
import { registerGameData } from "./registry";
import type { GameFiles, GameMeta, UniqueRow } from "./types";

const read = async (path: string): Promise<Uint8Array | null> => {
  try {
    return new Uint8Array(await invoke<ArrayBuffer>("icon_dev_read", { path }));
  } catch {
    return null;
  }
};

/**
 * `root` is a datamine output folder ("D:/Projects/diablo-companion/data/gamedata"). `meta` has to
 * come from somewhere: in dev, the gamedata port once it exists.
 */
export function registerDevGameData(root: string, meta: GameMeta) {
  const files: GameFiles = {
    read: (rel) => read(`${root}/raw/${rel}`),
    async build() {
      const buf = await read(`${root}/manifest.json`);
      if (!buf) throw new Error(`no manifest.json under ${root}`);
      return (JSON.parse(new TextDecoder().decode(buf)) as { build?: { version?: string } }).build?.version ?? "unknown";
    },
    async uniques(): Promise<UniqueRow[]> {
      const buf = await read(`${root}/uniques.json`);
      if (!buf) throw new Error(`no uniques.json under ${root}`);
      const j = JSON.parse(new TextDecoder().decode(buf)) as { entries?: UniqueRow[] } | Record<string, UniqueRow>;
      const list = (j as { entries?: UniqueRow[] }).entries ?? Object.values(j as Record<string, UniqueRow>);
      return list.map((u) => ({ sno: u.sno, id: u.id, name: u.name, itemType: u.itemType }));
    },
  };
  registerGameData({ files, meta });
}
