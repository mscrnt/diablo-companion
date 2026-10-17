// "Export my stats": the files from exportcore.ts, zipped into Downloads (the same save path as a debug
// report) and shown in Explorer. Nothing is sent anywhere.
import { invoke } from "@tauri-apps/api/core";
import { useCharacter } from "./charmap";
import { debugEvent } from "./debug";
import { markStamp } from "./debugcore";
import { statsFiles } from "./exportcore";
import { isTauri } from "./http";
import { useLoot, useRuns } from "./store";
import { APP_VERSION } from "./version";

export async function saveStatsExport(): Promise<{ path: string; files: string[] }> {
  if (!isTauri) throw new Error("Saving works in the desktop app only.");
  const runs = useRuns.getState().runs;
  const loot = useLoot.getState().history;
  const files = statsFiles({ runs, loot, character: useCharacter.getState(), version: APP_VERSION, now: Date.now() });
  const name = `sanctuary-stats-${markStamp(new Date())}`;
  const path = await invoke<string>("debug_report", { name, entries: files.map((f) => ({ zip: f.name, text: f.text })) });
  debugEvent("export", "stats", { zip: path.split(/[\\/]/).pop(), runs: runs.length, loot: loot.length });
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.revealItemInDir(path).catch(() => {});
  return { path, files: files.map((f) => f.name) };
}
