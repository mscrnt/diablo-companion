// Builds the icon library the app downloads when "Recognise items by their icon" is on: one SigLIP2 vector per
// piece of unique art in the game install, with the item's name, type, class and chaos flag. Vectors and names
// only, never the art (vectors can't be turned back into it). Inputs come from tools/datamine/extract-icons.mjs:
//   data/gamedata/icons/index.json (armour, per-class art) and frames/labels.json (weapons and jewellery frames).
//   cd tools/icons && npm install && node build-library.mjs [--device dml|cpu]
// Output: data/gamedata/icons/icon-library.json (published as a release asset; data/gamedata is git-ignored).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import sharp from "sharp";
import { AutoProcessor, SiglipVisionModel, RawImage } from "@huggingface/transformers";

export const MODEL = "onnx-community/siglip2-base-patch16-224-ONNX";
/** the dark tooltip corner the art sits on in game: letterbox colour for every square fed to the model */
export const BG = { r: 22, g: 19, b: 17 };
const I = new URL("../../data/gamedata/icons/", import.meta.url);
const device = process.argv.includes("--device") ? process.argv[process.argv.indexOf("--device") + 1] : "dml";
const dtype = device === "cpu" ? "fp32" : "fp16";

const processor = await AutoProcessor.from_pretrained(MODEL);
const model = await SiglipVisionModel.from_pretrained(MODEL, { device, dtype });
const embed = async (png) => {
  const v = (await model(await processor(await RawImage.fromBlob(new Blob([png]))))).pooler_output.data;
  let n = 0;
  for (const x of v) n += x * x;
  n = Math.sqrt(n);
  return Float32Array.from(v, (x) => x / n);
};
const square = (file) => sharp(fileURLToPath(file)).resize(224, 224, { fit: "contain", background: BG }).flatten({ background: BG }).png().toBuffer();

const list = [];
for (const e of JSON.parse(readFileSync(new URL("index.json", I), "utf8")))
  for (const ic of e.icons) list.push({ n: e.name, t: e.itemType ?? "", c: ic.class ?? null, x: !!e.chaos, file: new URL(ic.file, I) });
for (const l of JSON.parse(readFileSync(new URL("frames/labels.json", I), "utf8")))
  list.push({ n: l.name, t: l.sheet.replace(/^2DInventory_/, ""), c: null, x: false, file: new URL(`frames/${l.file}`, I) });

const dims = 768;
// int8 per dimension (unit vectors × 127): 768 bytes an icon, cosine changes by well under 1%
const q = new Int8Array(list.length * dims);
const t0 = performance.now();
for (let i = 0; i < list.length; i++) {
  const v = await embed(await square(list[i].file));
  if (v.length !== dims) throw new Error(`expected ${dims} dims, got ${v.length}`);
  for (let d = 0; d < dims; d++) q[i * dims + d] = Math.max(-127, Math.min(127, Math.round(v[d] * 127)));
  if (i % 100 === 0) process.stdout.write(`\r${i}/${list.length}`);
}
const out = {
  v: 1,
  model: MODEL,
  size: 224,
  bg: [BG.r, BG.g, BG.b],
  dims,
  quant: "int8/127",
  built: new Date().toISOString(),
  entries: list.map(({ n, t, c, x }) => ({ n, t, ...(c ? { c } : {}), ...(x ? { x: 1 } : {}) })),
  vectors: Buffer.from(q.buffer).toString("base64"),
};
writeFileSync(new URL("icon-library.json", I), JSON.stringify(out));
console.log(`\n${list.length} icons in ${((performance.now() - t0) / 1000).toFixed(1)} s (${device}, ${dtype}) → data/gamedata/icons/icon-library.json`);
