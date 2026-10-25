// How much does the item's picture help name a unique? Measures the real thing: the library is
// built from the extracted art with the app's own code (square.ts, library.ts, the ONNX model from
// the release asset), and the queries are the labelled icon crops the test-mode log has collected
// from real tooltips.
//
//   npm i --no-save sharp          (only to decode the png/jpeg files; the resizing is ours)
//   node scripts/dev/run.mjs icon-eval --model <dir with vision_model.onnx> [--icons <dir>] [--threads 8]
//
// Nothing here runs in the app, and nothing it reads is committed: the art and the screenshots stay
// on this machine.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import * as ort from "onnxruntime-web";
import sharp from "sharp";
import { fastParse } from "../../src/lib/fastparse";
import { confident, identifyUnique, WEIGHTS, type IdentifyInput } from "../../src/lib/identify";
import { loadStaticData, table } from "../../src/lib/names";
import { matchIcon, loadLibrary, packLibrary, quantise } from "../../src/lib/icons/library";
import { l2, letterbox, pixelValues } from "../../src/lib/icons/square";
import { DIMS, SIZE, type LibraryEntry } from "../../src/lib/icons/types";

const argv = process.argv.slice(2);
const opt = (n: string, d = "") => { const i = argv.indexOf(n); return i >= 0 ? argv[i + 1] : d; };
const MODEL = opt("--model");
const ICONS = opt("--icons", "D:/Projects/diablo-companion/data/gamedata/icons");
const TESTMODE = opt("--test-mode", `${process.env.LOCALAPPDATA}/com.kenneth.d4companion/logs/test-mode`);
const CACHE = opt("--cache", "./.icon-eval");
// the player's class narrows the library in play; left out here so the numbers are the harder case
const CLASS = opt("--class", "");
if (!MODEL) throw new Error("--model <dir with vision_model.onnx> is required");

ort.env.wasm.numThreads = Number(opt("--threads", "8"));
ort.env.logLevel = "error";
mkdirSync(CACHE, { recursive: true });

const session = await ort.InferenceSession.create(readFileSync(`${MODEL}/vision_model.onnx`), { executionProviders: ["wasm"] });
let runs = 0;
let runMs = 0;

/** The app's path exactly: letterbox to 224, SigLIP normalisation, pooler_output, L2. */
async function embed(rgba: Uint8Array, w: number, h: number): Promise<Float32Array> {
  const t0 = performance.now();
  const out = await session.run({ pixel_values: new ort.Tensor("float32", pixelValues(letterbox(rgba, w, h)), [1, 3, SIZE, SIZE]) });
  runs++;
  runMs += performance.now() - t0;
  return l2(Float32Array.from(out.pooler_output.data as Float32Array));
}

const decode = async (file: string) => {
  const { data, info } = await sharp(file).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { rgba: new Uint8Array(data), w: info.width, h: info.height };
};

// ---- the library, from the extracted art ---------------------------------------------------
interface Art { entry: LibraryEntry; file: string }
const art: Art[] = [];
for (const e of JSON.parse(readFileSync(`${ICONS}/index.json`, "utf8")) as { name: string; itemType: string; chaos?: boolean; icons: { file: string; class: string | null }[] }[])
  for (const ic of e.icons) art.push({ entry: { n: e.name, t: e.itemType ?? "", ...(ic.class ? { c: ic.class } : {}), ...(e.chaos ? { x: 1 } : {}) }, file: `${ICONS}/${ic.file}` });
// the weapon / jewellery frames, named by the labelling spike: the in-app builder can't make these
// yet (their item records carry no image link), so they're reported separately
const framesFile = `${ICONS}/frames/labels.json`;
const frames: Art[] = existsSync(framesFile)
  ? (JSON.parse(readFileSync(framesFile, "utf8")) as { name: string; sheet: string; file: string }[]).map((l) => ({
      entry: { n: l.name, t: l.sheet.replace(/^2DInventory_/, "") },
      file: `${ICONS}/frames/${l.file}`,
    }))
  : [];

async function buildLibrary(list: Art[], tag: string) {
  const at = `${CACHE}/lib-${tag}.json`;
  if (existsSync(at)) return loadLibrary(JSON.parse(readFileSync(at, "utf8")))!;
  const vectors = new Int8Array(list.length * DIMS);
  for (let i = 0; i < list.length; i++) {
    const { rgba, w, h } = await decode(list[i].file);
    quantise(await embed(rgba, w, h), vectors, i * DIMS);
    if (i % 50 === 0) process.stdout.write(`\r  ${tag}: ${i}/${list.length}`);
  }
  const lib = packLibrary(list.map((a) => a.entry), vectors, "eval");
  writeFileSync(at, JSON.stringify(lib));
  console.log(`\r  ${tag}: ${list.length} vectors`);
  return loadLibrary(lib)!;
}

console.log(`library: ${art.length} pieces of art linked to a unique, ${frames.length} labelled weapon / jewellery frames`);
const libArmour = await buildLibrary(art, "armour");
const libAll = await buildLibrary([...art, ...frames], "all");

// ---- the queries: labelled icon crops from real tooltips ------------------------------------
// Only uniques and mythics whose name is in the static tables: the log also keeps legendaries
// (their art names the base type, which is useful another day but can't be scored here).
await loadStaticData();
const uniqueNames = new Set(Object.values(table("uniques")).map((u) => u.n));
const files = readdirSync(TESTMODE);
const scans = files.filter((f) => f.endsWith("_scan.json")).sort();
interface Query { file: string; label: string; itemType: string; scan: string | undefined; vector: Float32Array; scores: Record<string, number>; scoresArmour: Record<string, number> }

/**
 * The square the test-mode log took is generous: it catches the tooltip's frame and some of the
 * panel behind it, while the library art is the bare sprite. `inset` trims that fraction off each
 * side before the square is letterboxed, to line the two framings up.
 */
const cropInset = (rgba: Uint8Array, w: number, h: number, inset: number) => {
  if (!inset) return { rgba, w, h };
  const dx = Math.round(w * inset);
  const dy = Math.round(h * inset);
  const nw = w - 2 * dx;
  const nh = h - 2 * dy;
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++) out.set(rgba.subarray(((y + dy) * w + dx) * 4, ((y + dy) * w + dx + nw) * 4), y * nw * 4);
  return { rgba: out, w: nw, h: nh };
};

async function loadQueries(inset: number): Promise<Query[]> {
  const cacheFile = `${CACHE}/queries-${inset}.json`;
  const cached: Record<string, number[]> = existsSync(cacheFile) ? JSON.parse(readFileSync(cacheFile, "utf8")) : {};
  const out: Query[] = [];
  for (const f of files.filter((x) => x.endsWith("_icon.json")).sort()) {
    const j = JSON.parse(readFileSync(`${TESTMODE}/${f}`, "utf8")) as { name: string; itemType: string; rarity: string };
    const jpg = f.replace(/\.json$/, ".jpg");
    if (!/unique|mythic/i.test(j.rarity ?? "") || !uniqueNames.has(j.name) || !existsSync(`${TESTMODE}/${jpg}`)) continue;
    let v: Float32Array;
    if (cached[f]) v = Float32Array.from(cached[f]);
    else {
      const d = await decode(`${TESTMODE}/${jpg}`);
      const c = cropInset(d.rgba, d.w, d.h, inset);
      v = await embed(c.rgba, c.w, c.h);
      cached[f] = [...v];
    }
    out.push({
      file: f,
      label: j.name,
      itemType: j.itemType ?? "",
      scan: scans.filter((s) => s < f).pop(),
      vector: v,
      // no class filter here: in play the app also knows the player's class, which can only help
      scores: matchIcon(libAll, v),
      scoresArmour: matchIcon(libArmour, v),
    });
  }
  writeFileSync(cacheFile, JSON.stringify(cached));
  return out;
}

// how much of the frame to trim: the picture is the only thing that changes, so sweep it first
console.log("trimming the tooltip frame off the square (top-1 by the picture alone):");
let bestInset = 0;
let bestTop1 = -1;
for (const inset of (opt("--insets", "0,0.05,0.1,0.15,0.2").split(",").map(Number))) {
  const qs = await loadQueries(inset);
  const hit = qs.filter((q) => q.label in q.scores && Object.entries(q.scores).sort((a, b) => b[1] - a[1])[0][0] === q.label).length;
  const have = qs.filter((q) => q.label in q.scores).length;
  console.log(`  inset ${inset.toFixed(2)}  ${hit}/${have} = ${((100 * hit) / Math.max(1, have)).toFixed(0)}%`);
  if (hit > bestTop1) {
    bestTop1 = hit;
    bestInset = inset;
  }
}
console.log(`\nusing inset ${bestInset.toFixed(2)}\n`);
const queries = await loadQueries(bestInset);
console.log(`queries: ${queries.length} labelled unique tooltips (${new Set(queries.map((q) => q.label)).size} different uniques)\n`);

// ---- how separable is the right answer? ----------------------------------------------------
const known = queries.filter((q) => q.label in q.scores);
const stats = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  return { n: s.length, p05: s[Math.floor(s.length * 0.05)], med: s[s.length >> 1], p95: s[Math.floor(s.length * 0.95)] };
};
const right = known.map((q) => q.scores[q.label]);
const best = known.map((q) => Math.max(...Object.values(q.scores)));
const wrong = known.flatMap((q) => Object.entries(q.scores).filter(([n]) => n !== q.label).map(([, c]) => c));
const fmt = (s: ReturnType<typeof stats>) => `n=${s.n} p05 ${s.p05.toFixed(3)} median ${s.med.toFixed(3)} p95 ${s.p95.toFixed(3)}`;
console.log(`cosine of the right unique's art: ${fmt(stats(right))}`);
console.log(`cosine of the best match:         ${fmt(stats(best))}`);
console.log(`cosine of every other unique:     ${fmt(stats(wrong))}`);
const top1 = known.filter((q) => Object.entries(q.scores).sort((a, b) => b[1] - a[1])[0][0] === q.label).length;
const top1a = known.filter((q) => q.label in q.scoresArmour && Object.entries(q.scoresArmour).sort((a, b) => b[1] - a[1])[0][0] === q.label).length;
const inArmour = known.filter((q) => q.label in q.scoresArmour).length;
console.log(`\nicon alone, top-1: ${top1}/${known.length} = ${((100 * top1) / known.length).toFixed(0)}% (full library)`);
console.log(`icon alone, top-1: ${top1a}/${inArmour} = ${((100 * top1a) / Math.max(1, inArmour)).toFixed(0)}% (armour-only library, the part the app can build today)\n`);

// ---- naming the item: every signal combination ---------------------------------------------
const cases: { label: string; inp: IdentifyInput }[] = [];
for (const q of queries) {
  if (!q.scan) continue;
  const j = JSON.parse(readFileSync(`${TESTMODE}/${q.scan}`, "utf8")) as { tooltip?: { hovered?: { text: string; bullet?: string }[] } };
  const lines = j.tooltip?.hovered ?? [];
  const item = fastParse(lines.map((l) => ({ text: l.text, bullet: (l.bullet ?? "none") as never })), false, undefined);
  if (!item) continue;
  const ti = lines.findIndex((l) => /\b(unique|mythic|legendary)\b/i.test(l.text));
  const title = lines.slice(0, Math.max(0, ti)).map((l) => l.text).filter((t) => !/equipped|transmog|^\W*$/i.test(t)).join(" ");
  cases.push({
    label: q.label,
    inp: { title, itemType: item.itemType, power: item.aspect?.text ?? "", stats: item.affixes.map((a) => a.text), ...(CLASS ? { className: CLASS } : {}), icon: q.scores },
  });
}

const modes: [string, (i: IdentifyInput) => IdentifyInput][] = [
  ["title + power + stats", (i) => ({ ...i, icon: undefined })],
  ["title + power + stats + icon", (i) => i],
  ["NO TITLE: power + stats", (i) => ({ ...i, title: "", icon: undefined })],
  ["NO TITLE: power + stats + icon", (i) => ({ ...i, title: "" })],
  ["NO TITLE, NO POWER: stats", (i) => ({ ...i, title: "", power: "", icon: undefined })],
  ["NO TITLE, NO POWER: stats + icon", (i) => ({ ...i, title: "", power: "" })],
];
const score = (f: (i: IdentifyInput) => IdentifyInput, w = WEIGHTS) => {
  let first = 0, sure = 0, sureWrong = 0;
  for (const c of cases) {
    const r = identifyUnique(f(c.inp), w);
    if (r[0]?.name === c.label) first++;
    const k = confident(r);
    if (k?.name === c.label) sure++;
    else if (k) sureWrong++;
  }
  return { first, sure, sureWrong };
};
const pct = (n: number) => `${Math.round((100 * n) / cases.length)}%`.padStart(4);
console.log(`${cases.length} items with both a tooltip and a picture\n`);
for (const [name, f] of modes) {
  const s = score(f);
  console.log(`${name.padEnd(34)} first ${pct(s.first)}   confident & right ${pct(s.sure)}   confident & WRONG ${pct(s.sureWrong)}`);
}

// The icon's weight has to stay under the power's (0.7) so a unique power read whole always wins;
// within that, how much it helps depends on where the cosines are read from.
console.log("\nicon weight and floor (confident & right / confident & WRONG, the hardest case: no title, no power):");
for (const floor of [0.7, 0.74, 0.78, 0.8, 0.82]) {
  const row: string[] = [];
  for (const iw of [0.3, 0.4, 0.5, 0.6, 0.7]) {
    const w = { ...WEIGHTS, icon: iw, iconFloor: floor };
    const c = score((i) => ({ ...i, title: "", power: "" }), w);
    const a = score((i) => i, w);
    row.push(`${iw.toFixed(1)}: ${pct(c.sure)}/${pct(c.sureWrong)}${a.sureWrong ? ` (full ${pct(a.sureWrong)} wrong!)` : ""}`);
  }
  console.log(`  floor ${floor.toFixed(2)}   ${row.join("   ")}`);
}

console.log(`\n${runs} model runs, ${(runMs / runs).toFixed(0)} ms each (wasm, ${ort.env.wasm.numThreads} threads)`);

// ---- what one tooltip costs, apart from the model run --------------------------------------
{
  const first = (JSON.parse(readFileSync(`${ICONS}/index.json`, "utf8")) as { icons: { file: string }[] }[])[0].icons[0].file;
  const d = await decode(`${ICONS}/${first}`);
  const N = 200;
  let t = performance.now();
  for (let i = 0; i < N; i++) pixelValues(letterbox(d.rgba, d.w, d.h));
  const prep = (performance.now() - t) / N;
  const v = queries[0].vector;
  t = performance.now();
  for (let i = 0; i < N; i++) matchIcon(libAll, v);
  const match = (performance.now() - t) / N;
  console.log(`\nper tooltip, apart from the model: square + normalise ${prep.toFixed(2)} ms, match against ${libAll.entries.length} vectors ${match.toFixed(2)} ms`);
}
