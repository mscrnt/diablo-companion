#!/usr/bin/env node
// Packs the SigLIP2 vision encoder into the release asset the app downloads once, when icon
// recognition is first turned on. The app never talks to Hugging Face: this script does, here,
// and the asset goes up as a GitHub release asset of this repo (see src/lib/icons/model.ts).
//
//   node scripts/build-model-asset.mjs [--dtype fp16,q8] [--out dist-model]
//
// Output per dtype: <out>/siglip2-base-patch16-224-onnx-<dtype>.zip plus its size and SHA-256,
// which go into MODEL_FILES in src/lib/icons/model.ts. Upload the zips to the release named by
// MODEL_RELEASE there; nothing is uploaded from here.
import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, statSync, existsSync } from "node:fs";
import path from "node:path";
import zlib from "node:zlib";

const REPO = "onnx-community/siglip2-base-patch16-224-ONNX";
/** The HF revision the asset is built from, pinned so a rebuild gives the same bytes. */
const REV = "ba1f3b0843f24bc5417d38e19c37b287d719b2f4";
/** transformers.js dtype name -> the file in the repo's onnx/ folder. */
const ONNX = { fp16: "vision_model_fp16.onnx", q8: "vision_model_quantized.onnx" };

const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const dtypes = opt("--dtype", "fp16,q8").split(",").map((s) => s.trim()).filter(Boolean);
const OUT = path.resolve(opt("--out", "dist-model"));
const CACHE = path.join(OUT, "hf-cache");
const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");

mkdirSync(CACHE, { recursive: true });

/** One file of the pinned revision, cached on disk so a second run doesn't download it again. */
async function hf(rel) {
  const to = path.join(CACHE, rel.replace(/\//g, "_"));
  if (existsSync(to)) return readFileSync(to);
  const url = `https://huggingface.co/${REPO}/resolve/${REV}/${rel}`;
  process.stdout.write(`  fetching ${rel} … `);
  const r = await fetch(url);
  if (!r.ok) throw new Error(`${url}: ${r.status} ${r.statusText}`);
  const buf = Buffer.from(await r.arrayBuffer());
  writeFileSync(to, buf);
  console.log(`${(buf.length / 1e6).toFixed(1)} MB`);
  return buf;
}

// ---- a minimal ZIP writer (the Rust side reads store + deflate) ----------------------------
// The .onnx is already dense binary and deflate buys well under 1% of it, so it goes in stored
// (which also makes unpacking a plain copy); the small text files are deflated.
const crcTable = (() => {
  const t = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c;
  }
  return t;
})();
const crc32 = (buf) => {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) c = (c >>> 8) ^ crcTable[(c ^ buf[i]) & 0xff];
  return ~c >>> 0;
};

function zip(files) {
  const parts = [];
  const central = [];
  let off = 0;
  for (const { name, data, store } of files) {
    const body = store ? data : zlib.deflateRawSync(data, { level: 9 });
    const nameBuf = Buffer.from(name, "utf8");
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(store ? 0 : 8, 8); // method
    local.writeUInt32LE(0, 10); // time + date (fixed, so the asset is reproducible)
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(body.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    parts.push(local, nameBuf, body);
    const cd = Buffer.alloc(46);
    cd.writeUInt32LE(0x02014b50, 0);
    cd.writeUInt16LE(20, 4);
    cd.writeUInt16LE(20, 6);
    cd.writeUInt16LE(store ? 0 : 8, 10);
    cd.writeUInt32LE(crc, 16);
    cd.writeUInt32LE(body.length, 20);
    cd.writeUInt32LE(data.length, 24);
    cd.writeUInt16LE(nameBuf.length, 28);
    cd.writeUInt32LE(off, 42);
    central.push(cd, nameBuf);
    off += 30 + nameBuf.length + body.length;
  }
  const cdBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(cdBuf.length, 12);
  end.writeUInt32LE(off, 16);
  return Buffer.concat([...parts, cdBuf, end]);
}

// ---- build ----------------------------------------------------------------------------------
const license = readFileSync(path.join(ROOT, "licenses", "siglip2-LICENSE-Apache-2.0.txt"));
const notice = readFileSync(path.join(ROOT, "licenses", "siglip2-NOTICE.txt"));
const config = await hf("config.json");
const preprocessor = await hf("preprocessor_config.json");

mkdirSync(OUT, { recursive: true });
const rows = [];
for (const dtype of dtypes) {
  const file = ONNX[dtype];
  if (!file) throw new Error(`unknown dtype "${dtype}" (known: ${Object.keys(ONNX).join(", ")})`);
  console.log(`${dtype}:`);
  const onnx = await hf(`onnx/${file}`);
  const out = path.join(OUT, `siglip2-base-patch16-224-onnx-${dtype}.zip`);
  writeFileSync(
    out,
    zip([
      { name: "vision_model.onnx", data: onnx, store: true },
      { name: "config.json", data: config },
      { name: "preprocessor_config.json", data: preprocessor },
      { name: "LICENSE-Apache-2.0.txt", data: license },
      { name: "NOTICE.txt", data: notice },
    ]),
  );
  const bytes = statSync(out).size;
  const sha256 = createHash("sha256").update(readFileSync(out)).digest("hex");
  rows.push({ dtype, bytes, sha256 });
  console.log(`  -> ${path.relative(ROOT, out)}  ${(bytes / 1e6).toFixed(1)} MB  sha256 ${sha256}`);
}

console.log("\nPaste into MODEL_FILES in src/lib/icons/model.ts:\n");
for (const r of rows) console.log(`  ${r.dtype}: { zip: "siglip2-base-patch16-224-onnx-${r.dtype}.zip", bytes: ${r.bytes}, sha256: "${r.sha256}" },`);
