// What icon recognition needs from the game install, over this reader's GameDataIO.
//
// Reading the player's Diablo IV folder is this folder's job; the icon feature only ever asks for
// a file by name (GameFiles and GameMeta in src/lib/icons/types.ts). So the two interfaces are
// satisfied here, once, and both hosts get them: the app's Web Worker and the dev runner.
//
// The one wrinkle is that a finished read deletes its ~110 MB raw copy, so by the time the icon
// library is built none of the files the art needs are on disk any more. `ensure` copies just those
// back out through the same read-only cascx sidecar, and `release` deletes them again afterwards.

import { iterCombinedMeta, MetaReader, readCoreToc, readEncryptedSnos, readReplacedSnos } from "./d4meta";
import { loadDefinitions } from "./extract";
import { plan } from "../icons/extract";
import type { GameDataIO } from "./io";
import type { GameFiles, GameMeta, IconPlanWire, UniqueRow } from "../icons/types";

/** The files the SNO reader needs before it can name or parse anything. */
const CORE = ["base:CoreTOC.dat", "base:CoreTOCReplacedSnosMapping.dat", "base:EncryptedSNOs.dat"];

/**
 * The icon build keeps its raw copies in its own folder under the build's cache folder, so a
 * re-read of the same build (the Re-read button) clearing `raw/` can't pull them out from under it.
 */
export const iconBase = (build: string) => `${build}/icons`;

/**
 * Copy these CASC files into the raw folder, skipping the ones this session already copied. One
 * cascx run per call, read-only and at below-normal priority (see src-tauri/src/gamedata.rs).
 */
async function ensureRaw(io: GameDataIO, copied: Set<string>, keys: string[]): Promise<void> {
  const missing = [...new Set(keys)].filter((k) => !copied.has(k));
  if (!missing.length) return;
  // a file this build keeps encrypted just stays missing, and the art it held is skipped
  await io.casc(missing, "list");
  for (const k of missing) copied.add(k);
}

export interface IconDataOpts {
  io: GameDataIO;
  /** the game build the art comes from, which is the library's cache key */
  build: string;
  /** the uniques of this build, from the reader's own uniques.json */
  uniques: UniqueRow[];
}

/** The icon extractor's view of the raw copy. `copied` is shared with whoever made it. */
export function iconFiles({ io, build, uniques }: IconDataOpts, copied = new Set<string>()): GameFiles {
  return {
    async read(rel) {
      return (await io.readMany([rel]))[0];
    },
    readMany: (rels) => io.readMany(rels),
    ensure: (keys) => ensureRaw(io, copied, keys),
    async release() {
      copied.clear();
      await io.cleanRaw();
    },
    async build() {
      return build;
    },
    async uniques() {
      return uniques;
    },
  };
}

/** The SNO meta reader, over the bundled definitions and this build's CoreTOC. */
export async function iconMeta(io: GameDataIO, copied = new Set<string>()): Promise<GameMeta> {
  await ensureRaw(io, copied, CORE);
  const { definitions, snoGroupNames, attributes } = await loadDefinitions(io);
  const must = async (rel: string) => {
    const b = await io.read(rel);
    if (!b) throw new Error(`${rel} isn't in the game data cache`);
    return b;
  };
  const toc = readCoreToc(await must("base/CoreTOC.dat"));
  const mr = new MetaReader({
    definitions,
    attributes,
    toc,
    snoGroupNames,
    replacedSnos: readReplacedSnos(await must("base/CoreTOCReplacedSnosMapping.dat")),
    encryptedSnos: readEncryptedSnos(await must("base/EncryptedSNOs.dat")),
  });
  return {
    nameOf: (sno) => toc.byId.get(sno)?.[1],
    group: (g) => (toc.byGroup[g] ?? new Map()).entries(),
    parseMeta: (buf, opts) => mr.parseMeta(buf, { standalone: true, group: opts?.group ?? null, asType: opts?.asType ?? null }),
    *parseCombined(buf, group, asType) {
      for (const [sno, b] of iterCombinedMeta(buf, group)) yield [sno, mr.parseMeta(b, { standalone: false, group, asType })];
    },
  };
}

export interface PlanIconsOpts extends IconDataOpts {
  onStep?: (done: number, total: number) => void;
}

/**
 * Which piece of art to cut out of which sheet, for every unique of this build. The expensive part
 * (a couple of thousand record parses) is why the app runs this in the reader's worker.
 */
export async function planIcons({ io, build, uniques, onStep }: PlanIconsOpts): Promise<IconPlanWire> {
  const copied = new Set<string>();
  const files = iconFiles({ io, build, uniques }, copied);
  const meta = await iconMeta(io, copied);
  return plan(files, meta, uniques, async (done, total) => {
    onStep?.(done, total);
    await io.tick();
  });
}
