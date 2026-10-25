// One run of the whole reader: the game's data files -> the JSON the app and the generators use.
// Both hosts call this: the app's Web Worker and the command-line runner.

import { extract, type ExtractOutput } from "./extract";
import { extractMap } from "./extractMap";
import { genHordes, genMapPois, genOcrVocab } from "./gen";
import { compact, pretty, type BuildInfo, type GameDataIO } from "./io";

/** The documents the app reads back at every start (convert.ts's `Extracted` plus the small tables). */
export const APP_FILES = [
  "manifest.json", "affixes.json", "aspects.json", "uniques.json", "items.json", "gems_runes.json",
  "charms.json", "paragon.json", "powers.json", "map.json",
  "generated/hordes.json", "generated/map-pois.json", "generated/ocr-vocab.json",
];

export interface RunOpts {
  io: GameDataIO;
  build: BuildInfo;
  /** reuse the raw copy already in the cache instead of reading the game again */
  skipCasc?: boolean;
  /** false for a document this host does not want on disk */
  keep?: (rel: string) => boolean;
  /** delete the raw copy (about 100 MB) once everything is parsed */
  dropRaw?: boolean;
}

export interface RunResult {
  build: BuildInfo;
  manifest: any;
  docs: Record<string, any>;
  cache: CacheManifest;
}

/** What the app writes next to the cached documents so the next start knows what it has. */
export interface CacheManifest {
  v: 1;
  /** the game build these files were read from */
  build: string;
  /** the `.build.info` row, so a patch is noticed without opening CASC */
  buildKey?: string;
  definitionsBuild: string;
  read: number;
  files: string[];
  counts: Record<string, number>;
}

/**
 * Does the app need to read the game again? Yes when there is no finished read, when the install is
 * on another build (a patch), or when we have bundled newer type definitions since. `buildKey` is
 * the CASC build hash, which catches a rebuild that kept the same version string.
 */
export function needsReread(cache: CacheManifest | null | undefined, build: BuildInfo, definitionsBuild?: string | null): boolean {
  if (!cache || cache.v !== 1) return true;
  if (!cache.build || cache.build !== build.version) return true;
  if (cache.buildKey && build.buildKey && cache.buildKey !== build.buildKey) return true;
  if (definitionsBuild && cache.definitionsBuild && cache.definitionsBuild !== definitionsBuild) return true;
  if (!cache.files?.length) return true;
  return false;
}

export async function run({ io, build, skipCasc = false, keep = () => true, dropRaw = false }: RunOpts): Promise<RunResult> {
  const out: ExtractOutput = await extract({ io, build, skipCasc, keep });

  const map = await extractMap({
    io, build: build.version, strings: out.strings, toc: out.toc, definitions: out.definitions,
    snoGroupNames: out.snoGroupNames, encryptedSnos: out.encryptedSnos, skipCasc, keep,
  });
  out.docs["map.json"] = map;

  io.progress({ stage: "Building the app's tables" });
  const generated: Record<string, unknown> = {
    "generated/hordes.json": genHordes(out.docs),
    "generated/map-pois.json": genMapPois(map),
    "generated/ocr-vocab.json": genOcrVocab(out.docs, build.version ?? null),
  };
  for (const [rel, doc] of Object.entries(generated)) {
    out.docs[rel] = doc;
    // these three were written compact in src/generated/, and they are read on every app start
    if (keep(rel)) await io.write(rel, rel.endsWith("hordes.json") ? pretty(doc) : compact(doc));
    await io.tick();
  }

  const cache: CacheManifest = {
    v: 1,
    build: build.version,
    buildKey: build.buildKey,
    definitionsBuild: out.manifest.definitionsBuild,
    read: Date.now(),
    files: APP_FILES.filter((f) => keep(f)),
    counts: out.manifest.counts,
  };
  if (keep("cache.json")) await io.write("cache.json", pretty(cache));

  if (dropRaw) {
    io.progress({ stage: "Tidying up" });
    await io.cleanRaw();
  }
  io.progress({ stage: "Done" });
  return { build, manifest: out.manifest, docs: out.docs, cache };
}
