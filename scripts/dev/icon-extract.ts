// Does the TypeScript port of the icon extractor cut the same art as the Node one?
//
//   node scripts/dev/run.mjs icon-extract [--root D:/Projects/diablo-companion/data/gamedata] [--limit 0]
//
// Reads a datamine cache (tools/datamine/extract.mjs output) with node:fs, wires it to the app's
// GameFiles / GameMeta interfaces, runs src/lib/icons/extract.ts over it and compares every square
// it cuts with the PNG tools/datamine/extract-icons.mjs wrote for the same unique. Read-only, and
// nothing it touches is committed.
//
// It doubles as the shape of the real wiring: see src/lib/icons/README.md.
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { cutArt, plan } from "../../src/lib/icons/extract";
import type { GameFiles, GameMeta, UniqueRow } from "../../src/lib/icons/types";
import { readCoreToc, readReplacedSnos, readEncryptedSnos, iterCombinedMeta, MetaReader, loadJson } from "../../tools/datamine/lib/d4meta.mjs";

const argv = process.argv.slice(2);
const opt = (n: string, d = "") => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const ROOT = opt("--root", "D:/Projects/diablo-companion/data/gamedata");
const D4DATA = opt("--d4data", "D:/Projects/diablo-companion/tools/vendor/d4data");
const LIMIT = Number(opt("--limit", "0"));
const RAWB = `${ROOT}/raw/base`;

// ---- the two interfaces, over a datamine cache on disk --------------------------------------
const files: GameFiles = {
  async read(rel) {
    const p = `${ROOT}/raw/${rel}`;
    return existsSync(p) ? new Uint8Array(readFileSync(p)) : null;
  },
  async build() {
    return JSON.parse(readFileSync(`${ROOT}/manifest.json`, "utf8")).build.version as string;
  },
  async uniques(): Promise<UniqueRow[]> {
    const u = JSON.parse(readFileSync(`${ROOT}/uniques.json`, "utf8"));
    const list: UniqueRow[] = u.entries ?? Object.values(u);
    return LIMIT ? list.slice(0, LIMIT) : list;
  },
};

const definitions = loadJson(`${D4DATA}/definitions.json`);
const snoFileInfo = loadJson(`${D4DATA}/json/snoFileInfo.json`);
const attributes: Record<number, string> = {};
for (const v of Object.values(loadJson(`${D4DATA}/attributeList.json`)) as { eAttrib: number; name: string }[]) attributes[v.eAttrib] = v.name;
const toc = readCoreToc(readFileSync(`${RAWB}/CoreTOC.dat`));
const mr = new MetaReader({
  definitions,
  attributes,
  toc,
  snoGroupNames: Object.fromEntries(Object.entries(snoFileInfo).map(([k, v]) => [k, (v as string[])[0]])),
  replacedSnos: readReplacedSnos(readFileSync(`${RAWB}/CoreTOCReplacedSnosMapping.dat`)),
  encryptedSnos: readEncryptedSnos(readFileSync(`${RAWB}/EncryptedSNOs.dat`)),
  gbid: {},
});

const meta: GameMeta = {
  nameOf: (sno) => (toc.byId.get(sno) || [])[1],
  group: (g) => toc.byGroup[g].entries(),
  parseMeta: (buf) => mr.parseMeta(Buffer.from(buf)),
  *parseCombined(buf, group, asType) {
    for (const [sno, b] of iterCombinedMeta(Buffer.from(buf), group)) yield [sno, mr.parseMeta(b, { standalone: false, group, asType })];
  },
};

// ---- plan, cut, compare ---------------------------------------------------------------------
const uniques = await files.uniques();
const t0 = performance.now();
const p = await plan(files, meta, uniques);
console.log(
  `${uniques.length} uniques: ${p.items.length} pieces of art on ${p.sheets.length} sheets, ${p.unlinked} with no image link ` +
    `(${Math.round(performance.now() - t0)} ms)`,
);

// what extract-icons.mjs wrote, keyed by what it is: the same picture may be in several files
const index = JSON.parse(readFileSync(`${ROOT}/icons/index.json`, "utf8")) as { name: string; icons: { file: string; class: string | null }[] }[];
const refBySize = new Map<string, string[]>();
for (const e of index)
  for (const ic of e.icons) {
    const key = `${e.name}|${ic.class ?? ""}`;
    (refBySize.get(key) ?? refBySize.set(key, []).get(key)!).push(ic.file);
  }

/** The RGBA of a PNG written by extract-icons.mjs (8-bit RGBA, one zlib stream, filters 0-4). */
function readPng(file: string): { rgba: Uint8Array; w: number; h: number } {
  const buf = readFileSync(file);
  let o = 8;
  let w = 0,
    h = 0;
  const idat: Buffer[] = [];
  while (o < buf.length) {
    const len = buf.readUInt32BE(o);
    const type = buf.toString("ascii", o + 4, o + 8);
    const data = buf.subarray(o + 8, o + 8 + len);
    if (type === "IHDR") {
      w = data.readUInt32BE(0);
      h = data.readUInt32BE(4);
    } else if (type === "IDAT") idat.push(data);
    o += 12 + len;
  }
  const raw = require("node:zlib").inflateSync(Buffer.concat(idat)) as Buffer;
  const out = new Uint8Array(w * h * 4);
  const stride = w * 4;
  for (let y = 0; y < h; y++) {
    const filter = raw[y * (stride + 1)];
    const row = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride);
    for (let x = 0; x < stride; x++) {
      const a = x >= 4 ? out[y * stride + x - 4] : 0;
      const b = y > 0 ? out[(y - 1) * stride + x] : 0;
      const c = x >= 4 && y > 0 ? out[(y - 1) * stride + x - 4] : 0;
      let v = row[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const pa = Math.abs(b - c);
        const pb = Math.abs(a - c);
        const pc = Math.abs(a + b - 2 * c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[y * stride + x] = v & 0xff;
    }
  }
  return { rgba: out, w, h };
}

let cut = 0;
let same = 0;
let different = 0;
let noReference = 0;
const t1 = performance.now();
for await (const art of cutArt(files, p)) {
  cut++;
  const refs = refBySize.get(`${art.entry.n}|${art.entry.c ?? ""}`) ?? [];
  const match = refs.map((f) => `${ROOT}/icons/${f}`).find((f) => existsSync(f) && readPng(f).w === art.w);
  if (!match) {
    noReference++;
    continue;
  }
  const ref = readPng(match);
  let diff = 0;
  for (let i = 0; i < art.rgba.length; i++) if (art.rgba[i] !== ref.rgba[i]) diff++;
  if (diff === 0) same++;
  else {
    different++;
    if (different <= 5) console.log(`  differs: ${art.entry.n} (${art.entry.c ?? "all"}) ${art.w}x${art.h}: ${diff} of ${art.rgba.length} bytes`);
  }
}
const ms = performance.now() - t1;
console.log(`\n${cut} squares cut in ${(ms / 1000).toFixed(1)} s (${(ms / cut).toFixed(1)} ms each)`);
console.log(`identical to the Node extractor: ${same}   different: ${different}   no reference png: ${noReference}`);
console.log(`extracted pngs on disk: ${readdirSync(`${ROOT}/icons`).filter((f) => f.endsWith(".png")).length}`);
