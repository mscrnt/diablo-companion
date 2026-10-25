// The game data, read from the player's own Diablo IV install.
//
// What the rest of the app uses:
//   loadGameData()      the extracted JSON (convert.ts's `Extracted`), or null when there is none
//   loadGeneratedTables()  the small tables (hordes, map pois, OCR vocabulary)
//   useGameData         zustand state: where the install is, which build the cache holds, progress
//   checkGameData()     called once at start: cheap `.build.info` check, re-reads after a patch
//   readGameData()      read now (first run, or the Re-read button in Settings)
//
// Nothing is ever downloaded, the game folder is only read, and the reading happens in a worker.

import { create } from "zustand";
import { isTauri } from "../http";
import type { Extracted } from "./convert";
import { readInWorker } from "./host";
import { parseBuildInfo, unframeBatch, type BuildInfo, type Progress } from "./io";
import { cachedBuilds, detectInstall, pruneCache, readBatchRaw, readBuildInfoFile, readResource, pickGameFolder, type Candidate } from "./native";
import { APP_FILES, APP_STRING_FILES, needsReread, type CacheManifest } from "./pipeline";
import { outRel } from "./tauriIo";

const UTF8 = new TextDecoder("utf-8");

export type GameDataState = "unknown" | "missing" | "reading" | "ready" | "error";

export interface GameData {
  state: GameDataState;
  /** the Diablo IV folder we are using */
  dir: string | null;
  /** where it was found */
  source: Candidate["source"] | null;
  /** the build the cached data was read from */
  build: string | null;
  /** what the install says right now */
  gameBuild: string | null;
  readAt: number | null;
  progress: Progress | null;
  error: string | null;
  /** the game has been patched since we read it */
  stale: boolean;
}

interface GameDataStore extends GameData {
  set: (p: Partial<GameData>) => void;
}

export const useGameData = create<GameDataStore>()((set) => ({
  state: "unknown", dir: null, source: null, build: null, gameBuild: null, readAt: null,
  progress: null, error: null, stale: false,
  set: (p) => set(p),
}));

const put = (p: Partial<GameData>) => useGameData.getState().set(p);

// ------------------------------------------------------------------------------------------------
// the install

/** Where Settings keeps the folder. Imported lazily so this module does not pull the whole store in. */
async function savedDir(): Promise<string> {
  const { useSettings } = await import("../store");
  return useSettings.getState().settings.gamePath ?? "";
}
async function saveDir(dir: string) {
  const { useSettings } = await import("../store");
  useSettings.getState().update((s) => void (s.gamePath = dir));
}

/** Look for the install and remember it. Returns null when nothing was found. */
export async function findInstall(): Promise<{ dir: string; source: Candidate["source"] } | null> {
  if (!isTauri) return null;
  const saved = await savedDir();
  const found = await detectInstall(saved);
  const hit = found.candidates.find((c) => c.valid);
  if (!hit) {
    put({ state: "missing", dir: null, source: null, error: "Diablo IV not found" });
    return null;
  }
  if (hit.dir !== saved) await saveDir(hit.dir);
  put({ dir: hit.dir, source: hit.source, error: null });
  return { dir: hit.dir, source: hit.source };
}

/** "Choose folder": the Windows picker, then check what the player picked. */
export async function chooseInstall(): Promise<string | null> {
  const dir = await pickGameFolder();
  if (!dir) return null;
  try {
    const build = parseBuildInfo(await readBuildInfoFile(dir));
    await saveDir(dir);
    put({ dir, source: "settings", gameBuild: build.version, error: null, state: "missing" });
    return dir;
  } catch (e) {
    put({ error: String((e as Error).message ?? e) });
    throw e;
  }
}

// ------------------------------------------------------------------------------------------------
// the cache

const cacheFile = (base: string, rel: string) => outRel(base, rel);

/** Read several cached documents in one call. Bytes, so a 6 MB file is not JSON-escaped twice. */
async function readDocs(base: string, rels: string[]): Promise<Record<string, any>> {
  const bufs = unframeBatch(await readBatchRaw(rels.map((r) => cacheFile(base, r))));
  const out: Record<string, any> = {};
  rels.forEach((rel, i) => {
    const b = bufs[i];
    if (!b) return;
    try {
      out[rel] = JSON.parse(UTF8.decode(b));
    } catch {
      /* a half-written file: treat it as missing */
    }
  });
  return out;
}

/** What the last finished read of that build left behind, or null. */
export async function readCacheManifest(build: string): Promise<CacheManifest | null> {
  const docs = await readDocs(build, ["cache.json"]);
  const c = docs["cache.json"] as CacheManifest | undefined;
  return c && c.v === 1 ? c : null;
}

/** The d4data build we bundle, so a definitions bump also triggers a re-read. 11 bytes. */
async function bundledDefinitionsBuild(): Promise<string | null> {
  try {
    return UTF8.decode(await readResource("buildVersion.txt")).trim();
  } catch {
    return null;
  }
}

// ------------------------------------------------------------------------------------------------
// reading

let running: ReturnType<typeof readInWorker> | null = null;
/** Set before the first await, so two callers can never start two reads of the same folder. */
let starting: Promise<void> | null = null;

export interface ReadGameDataOpts {
  /** read again even when the cache already matches this build */
  force?: boolean;
  /** keep the ~100 MB raw copy (only useful when debugging the reader) */
  keepRaw?: boolean;
}

/**
 * Read the game data now. Resolves when the cache is complete. Safe to call twice: the second call
 * waits for the first, so the first run and the start-up check never read the same folder twice.
 */
export function readGameData(opts: ReadGameDataOpts = {}): Promise<void> {
  if (starting) return starting;
  starting = readGameDataOnce(opts).finally(() => {
    starting = null;
  });
  return starting;
}

async function readGameDataOnce(opts: ReadGameDataOpts): Promise<void> {
  if (!isTauri) return;
  const install = (await findInstall()) ?? (useGameData.getState().dir ? { dir: useGameData.getState().dir! } : null);
  if (!install) return;
  let build: BuildInfo;
  try {
    build = parseBuildInfo(await readBuildInfoFile(install.dir));
  } catch (e) {
    put({ state: "error", error: String((e as Error).message ?? e) });
    return;
  }
  put({ gameBuild: build.version });
  if (!opts.force) {
    const cached = await readCacheManifest(build.version);
    if (!needsReread(cached, build, await bundledDefinitionsBuild())) {
      put({ state: "ready", build: cached!.build, readAt: cached!.read, stale: false, error: null, progress: null });
      return;
    }
  }

  put({ state: "reading", progress: { stage: "Reading your Diablo IV install" }, error: null });
  running = readInWorker({
    game: install.dir,
    build,
    base: build.version,
    dropRaw: !opts.keepRaw,
    keep: [...APP_FILES, "cache.json"],
    onProgress: (p) => put({ progress: p }),
  });
  try {
    const done = await running;
    put({ state: "ready", build: done.build, readAt: done.cache?.read ?? Date.now(), stale: false, progress: null, error: null });
    // one build's worth of data is enough; a patch's folder replaces the last one
    await pruneCache([build.version]).catch(() => 0);
  } catch (e) {
    put({ state: "error", error: String((e as Error).message ?? e), progress: null });
  } finally {
    running = null;
  }
}

/** True while a read is in flight. */
export const isReading = () => starting !== null || running !== null;

/**
 * Called once at app start. Reads only `.build.info` (a few hundred bytes) and the cache manifest,
 * so it costs nothing. When the game has been patched, or there is no cache yet, it reads in the
 * background and leaves the old data in place until the new data is complete.
 */
export async function checkGameData(): Promise<void> {
  if (!isTauri) return;
  const install = await findInstall();
  if (!install) return;
  let build: BuildInfo;
  try {
    build = parseBuildInfo(await readBuildInfoFile(install.dir));
  } catch (e) {
    put({ state: "error", error: String((e as Error).message ?? e) });
    return;
  }
  put({ gameBuild: build.version });
  const cached = await readCacheManifest(build.version);
  if (!needsReread(cached, build, await bundledDefinitionsBuild())) {
    put({ state: "ready", build: cached!.build, readAt: cached!.read, stale: false, error: null });
    return;
  }
  // either nothing cached yet (a new install, or an upgrade from 0.2.x) or the game was patched
  const any = await anyCachedBuild();
  put({ state: any ? "ready" : "missing", build: any?.build ?? null, readAt: any?.read ?? null, stale: !!any });
  void readGameData();
}

/** The newest cached build, whichever it is: the app keeps using it while a patch is being read. */
async function anyCachedBuild(): Promise<CacheManifest | null> {
  const builds = await cachedBuilds().catch(() => [] as string[]);
  for (const b of [...builds].reverse()) {
    const c = await readCacheManifest(b);
    if (c) return c;
  }
  return null;
}

// ------------------------------------------------------------------------------------------------
// reading the data back

/**
 * convert.ts's `Extracted` fields and the document each one comes from. `skillTrees` and
 * `tempering` are handed over too, ready for the War Plans nodes and the tempering manual names;
 * convert.ts declares them when it starts reading them.
 */
const EXTRACTED: [string, string][] = [
  ["affixes", "affixes.json"],
  ["aspects", "aspects.json"],
  ["uniques", "uniques.json"],
  ["items", "items.json"],
  ["gemsRunes", "gems_runes.json"],
  ["charms", "charms.json"],
  ["paragon", "paragon.json"],
  ["powers", "powers.json"],
  ["monsters", "monsters.json"],
  ["gbid", "gbid.json"],
  ["skillTrees", "skilltrees.json"],
  ["tempering", "tempering.json"],
];

let loaded: Promise<Extracted | null> | null = null;

/**
 * Wait only as long as we have to: start the cheap check if nobody has, and block on a full read
 * only when there is no cached build at all to serve in the meantime.
 */
async function waitForCache() {
  if (useGameData.getState().state === "unknown") await checkGameData();
  if (!useGameData.getState().build && starting) await starting.catch(() => {});
}

/** The extracted game data for convert.ts, from the cache. null when the app has not read the game yet. */
export function loadGameData(): Promise<Extracted | null> {
  return (loaded ??= (async () => {
    if (!isTauri) return null;
    await waitForCache();
    const build = useGameData.getState().build;
    if (!build) return null;
    const docs = await readDocs(build, [...EXTRACTED.map(([, f]) => f), ...APP_STRING_FILES]);
    if (!docs["affixes.json"]) return null;
    const out: Extracted = { build };
    for (const [key, file] of EXTRACTED) if (docs[file]) (out as any)[key] = docs[file];
    // convert.ts wants the string lists as one map, keyed by StringList name
    const strings: Record<string, Record<string, string>> = {};
    for (const f of APP_STRING_FILES) if (docs[f]) Object.assign(strings, docs[f]);
    if (Object.keys(strings).length) (out as any).strings = strings;
    return out;
  })());
}

export interface GeneratedTables {
  hordes: any;
  mapPois: any;
  ocrVocab: any;
}

let loadedGen: Promise<GeneratedTables | null> | null = null;

/** The three small tables the app used to ship in src/generated/. */
export function loadGeneratedTables(): Promise<GeneratedTables | null> {
  return (loadedGen ??= (async () => {
    if (!isTauri) return null;
    await waitForCache();
    const build = useGameData.getState().build;
    if (!build) return null;
    const docs = await readDocs(build, ["generated/hordes.json", "generated/map-pois.json", "generated/ocr-vocab.json"]);
    if (!docs["generated/ocr-vocab.json"]) return null;
    return {
      hordes: docs["generated/hordes.json"],
      mapPois: docs["generated/map-pois.json"],
      ocrVocab: docs["generated/ocr-vocab.json"],
    };
  })());
}

/** Forget what loadGameData() cached, so the next call reads the new build. */
export function resetLoaded() {
  loaded = null;
  loadedGen = null;
}

useGameData.subscribe((s, prev) => {
  if (s.build !== prev.build) resetLoaded();
});
