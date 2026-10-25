// What the extractor needs from whoever hosts it. Two hosts implement this: the app (a Web Worker
// that asks the Rust side over the window's IPC, see host.ts / tauriIo.ts) and the command-line
// runner (node fs, see tools/datamine/nodeIo.mjs). The extractor itself never touches a filesystem,
// a process or the game folder, so there is one implementation of the parsing for both.

/** A row of the game's `.build.info`. */
export interface BuildInfo {
  version: string;
  buildKey?: string;
  cdnKey?: string;
  branch?: string;
  product?: string;
  tags?: string;
}

/** Every enUS string list by SNO name: { "Affix_Foo": { Name: "...", Desc: "..." } }. */
export type StringLists = Record<string, Record<string, string>>;

export interface CascResult {
  matched?: number;
  extracted?: number;
  /** files cascx could not read, normally encrypted ones whose TACT key we don't have */
  failed: number;
}

export interface Progress {
  /** short, player-facing: "Reading affixes" */
  stage: string;
  done?: number;
  total?: number;
}

export interface GameDataIO {
  /** Bytes of a file in the raw CASC copy ("base/CoreTOC.dat", "base/meta/12345"); null when missing. */
  read(rel: string): Promise<Uint8Array | null>;
  /** The same, in one round trip. Same order as `rels`, null for the ones that aren't there. */
  readMany(rels: string[]): Promise<(Uint8Array | null)[]>;
  /** File names directly inside a raw folder ("base/meta"); empty when the folder is missing. */
  list(rel: string): Promise<string[]>;
  /** A bundled d4data file as text ("definitions.json", "json/snoFileInfo.json"). */
  vendor(rel: string): Promise<string>;
  /** Write one output document ("affixes.json", "strings/ui.json"). */
  write(rel: string, text: string): Promise<void>;
  /** Read back a document this run wrote (used by the later stages). */
  readOut?(rel: string): Promise<string | null>;
  /** Empty one of our own output folders ("strings"). Never the game folder. */
  clean(rel: string): Promise<void>;
  /** Empty the raw CASC copy before filling it again. Never the game folder. */
  cleanRaw(): Promise<void>;
  /** Copy files out of CASC into the raw root. "mask" globs, "list" matches exact storage names. */
  casc(names: string[], mode: "mask" | "list"): Promise<CascResult>;
  /** Size of the raw copy on disk, for the manifest. */
  rawBytes(): Promise<number>;
  progress(p: Progress): void;
  /** Called in every long loop: lets the host yield so a player's machine stays responsive. */
  tick(): Promise<void>;
}

/** `JSON.stringify(obj, null, 1)` plus a newline: the shape data/gamedata/*.json has always had. */
export const pretty = (obj: unknown) => JSON.stringify(obj, null, 1) + "\n";
/** Compact, for the string-list files. */
export const compact = (obj: unknown) => JSON.stringify(obj) + "\n";

/**
 * Read a list of raw files in batches and hand them over one at a time, yielding to the host
 * between batches. Keeps at most `chunk` file bodies alive, so a 35 000 file group never needs
 * the whole 100 MB raw copy in memory at once.
 */
export async function* readChunked<T>(
  io: GameDataIO,
  items: T[],
  path: (item: T) => string,
  chunk = 192,
): AsyncGenerator<[T, Uint8Array | null]> {
  for (let i = 0; i < items.length; i += chunk) {
    const slice = items.slice(i, i + chunk);
    const bufs = await io.readMany(slice.map(path));
    for (let j = 0; j < slice.length; j++) yield [slice[j], bufs[j]];
    await io.tick();
  }
}

/**
 * Unpack a batch of files read in one go: `[u32 count][u32 len per file]...[bytes]`, with
 * len = 0xFFFFFFFF for a file that is not there. The pieces are views into the one buffer, so
 * nothing is copied. Both hosts frame their batch reads this way.
 */
export function unframeBatch(buf: ArrayBuffer): (Uint8Array | null)[] {
  const dv = new DataView(buf);
  const count = dv.getUint32(0, true);
  const lens: number[] = [];
  for (let i = 0; i < count; i++) lens.push(dv.getUint32(4 + i * 4, true));
  const out: (Uint8Array | null)[] = [];
  let at = 4 + count * 4;
  for (const len of lens) {
    if (len === 0xffffffff) {
      out.push(null);
      continue;
    }
    out.push(new Uint8Array(buf, at, len));
    at += len;
  }
  return out;
}

/** Parse the `.build.info` text the game keeps in its install root. */
export function parseBuildInfo(text: string): BuildInfo {
  const txt = text.trim().split(/\r?\n/);
  const cols = txt[0].split("|").map((c) => c.split("!")[0]);
  const rows = txt.slice(1).map((l) => Object.fromEntries(l.split("|").map((v, i) => [cols[i], v])) as Record<string, string>);
  const row = rows.find((r) => r.Active === "1") || rows[0] || {};
  return {
    version: row.Version,
    buildKey: row["Build Key"],
    cdnKey: row["CDN Key"],
    branch: row.Branch,
    product: row.Product || "fenris",
    tags: row.Tags,
  };
}
