#!/usr/bin/env node
// Item icons from the local Diablo IV install, read-only, for recognising items by their icon (roadmap).
//
//   node tools/datamine/extract-icons.mjs [--game "G:\Blizzard\Diablo IV"] [--skip-casc]
//
// Same route as extract.mjs: tools/datamine/bin/cascx.exe (CascLib, read-only) copies files out of CASC and
// the d4data definitions describe their layout. Nothing is modified or decompiled.
//   1. Misc\2D_table.dat: image handle -> texture sheet + frame number
//   2. Texture-Base-Global.dat: every texture's definition (size, pixel format, frame UV rectangles)
//   3. each unique's ItemDefinition.tInvImages: its image handles (one per class)
//   4. the payloads (pixel data) of the sheets those icons are on, decoded (BC1/BC3/BC7 are documented
//      GPU block formats) and each icon cut out as a PNG
// Output: data/gamedata/icons/<item id>.png + index.json (not shipped; the app ships at most embeddings).
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCoreToc, readReplacedSnos, readEncryptedSnos, iterCombinedMeta, MetaReader, loadJson } from './lib/d4meta.mjs';
import { decodeBlocks } from './lib/bcn.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const D4DATA = path.join(ROOT, 'tools', 'vendor', 'd4data');
const CASCX = path.join(HERE, 'bin', 'cascx.exe');
const OUT = path.join(ROOT, 'data', 'gamedata');
const RAW = path.join(OUT, 'raw');
const RAWB = path.join(RAW, 'base');
const ICONS = path.join(OUT, 'icons');
const BS = String.fromCharCode(92);
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const GAME = opt('--game', process.env.D4_GAME_DIR || 'G:\\Blizzard\\Diablo IV');
const SKIP_CASC = argv.includes('--skip-casc');
const log = (...a) => console.log('[icons]', ...a);

function cascx(args) {
  if (!fs.existsSync(CASCX)) throw new Error('cascx.exe not found: run tools/datamine/extract.mjs once to build it');
  try {
    execFileSync(CASCX, [GAME, ...args], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 28 });
  } catch (e) {
    const m = String(e.stderr || '').match(/matched=(\d+) extracted=(\d+) failed=(\d+)/);
    if (!(e.status === 3 && m)) { process.stderr.write(String(e.stderr || '')); throw e; }
    log(`${m[3]} files skipped (encrypted / key not available)`);
  }
}

if (!fs.existsSync(path.join(RAWB, 'CoreTOC.dat'))) throw new Error('no raw cache: run tools/datamine/extract.mjs first');
if (!SKIP_CASC) {
  log('copying the image table and the texture definitions out of CASC ...');
  cascx(['extract', RAW, 'base:Misc' + BS + '2D_table.dat', 'base:Texture-Base-Global.dat']);
}

const definitions = loadJson(path.join(D4DATA, 'definitions.json'));
const snoFileInfo = loadJson(path.join(D4DATA, 'json', 'snoFileInfo.json'));
const groupNames = Object.fromEntries(Object.entries(snoFileInfo).map(([k, v]) => [k, v[0]]));
const attributes = {};
for (const v of Object.values(loadJson(path.join(D4DATA, 'attributeList.json')))) attributes[v.eAttrib] = v.name;
const toc = readCoreToc(fs.readFileSync(path.join(RAWB, 'CoreTOC.dat')));
const mr = new MetaReader({
  definitions, attributes, toc, snoGroupNames: groupNames,
  replacedSnos: readReplacedSnos(fs.readFileSync(path.join(RAWB, 'CoreTOCReplacedSnosMapping.dat'))),
  encryptedSnos: readEncryptedSnos(fs.readFileSync(path.join(RAWB, 'EncryptedSNOs.dat'))), gbid: {},
});
const nameOf = (id) => (toc.byId.get(id) || [])[1];

// 1. image handle -> [texture, frame]
const table = fs.readFileSync(path.join(RAWB, 'Misc', '2D_table.dat'));
const handles = new Map();
for (let o = 4; o + 12 <= table.length; o += 12) handles.set(table.readUInt32LE(o), [table.readUInt32LE(o + 4), table.readUInt32LE(o + 8)]);
log(`${handles.size} image handles`);

// 3. the uniques' icons (first, so only the sheets in use get parsed)
const uniques = (() => { const u = JSON.parse(fs.readFileSync(path.join(OUT, 'uniques.json'), 'utf8')); return u.entries || Object.values(u); })();
const meta = (id) => { const p = path.join(RAWB, 'meta', String(id)); return fs.existsSync(p) ? mr.parseMeta(fs.readFileSync(p)) : null; };
const wanted = [];
for (const u of uniques) {
  const m = meta(u.sno);
  const refs = [...new Set((m?.tInvImages || []).map((x) => x.hDefaultImage >>> 0).filter(Boolean))].map((h) => handles.get(h)).filter(Boolean);
  if (refs.length) wanted.push({ u, refs });
}
const sheetIds = new Set(wanted.flatMap((w) => w.refs.map((r) => r[0])));
log(`${wanted.length} of ${uniques.length} uniques have an icon, on ${sheetIds.size} sheets`);

// --frames: also every frame of the weapon / jewellery / seasonal sheets, unlabelled. Their items' records
// carry no image link (tInvImages is empty), so the frames get named later by matching them, locally,
// against named reference icons; the art itself always comes from the install.
const FRAMES = argv.includes('--frames');
const FRAME_SHEETS = /^2DInventory_(Rings|Amulets|Axes|Bows|Daggers|Flails|Glaive|Maces|Offhand|Polearm|Quarterstaff|Scythes?|Shields|Staff|Swords|Wands|crossbows|Items_AF_Uniques|Items_X2|X2_Items|Season\d+_Items|S1[24]_Items|Talisman|Items_Unique_)/i;
const frameSheets = FRAMES ? [...toc.byGroup[44].entries()].filter(([, n]) => FRAME_SHEETS.test(n) && !/stor\d/i.test(n)).map(([id]) => id) : [];
for (const id of frameSheets) sheetIds.add(id);

// 2. those sheets' definitions
const sheets = new Map();
for (const [sno, buf] of iterCombinedMeta(fs.readFileSync(path.join(RAWB, 'Texture-Base-Global.dat')), 44)) {
  if (!sheetIds.has(sno)) continue;
  const t = mr.parseMeta(buf, { standalone: false, group: 44, asType: "TextureDefinition" });
  sheets.set(sno, { name: nameOf(sno), format: t.eTexFormat, width: t.dwWidth, height: t.dwHeight, frames: (t.ptFrame || []).map((f) => [f.flU0, f.flV0, f.flU1, f.flV1]) });
}
log(`${sheets.size} sheet definitions; pixel formats: ${[...new Set([...sheets.values()].map((s) => s.format))].join(', ')}`);

// 4. pixel data, decoded once per sheet
if (!SKIP_CASC) {
  const listFile = path.join(RAW, 'icon-payloads.txt');
  fs.writeFileSync(listFile, [...sheets.keys()].map((id) => 'base:payload' + BS + id).join('\n'));
  log(`copying ${sheets.size} sheet payloads out of CASC ...`);
  cascx(['extract-list', RAW, listFile]);
}
fs.mkdirSync(ICONS, { recursive: true });
const decoded = new Map();
const pixelsOf = (sno) => {
  if (decoded.has(sno)) return decoded.get(sno);
  const s = sheets.get(sno);
  const p = path.join(RAWB, 'payload', String(sno));
  const rgba = fs.existsSync(p) ? decodeBlocks(fs.readFileSync(p), s.width, s.height, s.format) : null;
  decoded.set(sno, rgba);
  return rgba;
};
const index = [];
let cut = 0, failed = 0;
// the game shows the picture for your class: the class sheets name it ("2DInventory_Items_Necromancer")
const CLASSES = ['Barbarian', 'Druid', 'Necromancer', 'Rogue', 'Sorcerer', 'Spiritborn', 'Paladin', 'Warlock'];
const classOf = (sheet) => CLASSES.find((c) => new RegExp(`_${c}\\b`, 'i').test(sheet)) ?? null;
for (const { u, refs } of wanted) {
  const files = [];
  const icons = [];
  for (const [sno, frame] of refs) {
    const s = sheets.get(sno);
    const uv = s?.frames[frame];
    const rgba = s && uv && pixelsOf(sno);
    if (!rgba) { failed++; continue; }
    const [x0, y0, x1, y1] = [Math.round(uv[0] * s.width), Math.round(uv[1] * s.height), Math.round(uv[2] * s.width), Math.round(uv[3] * s.height)];
    const file = `${u.id}${files.length ? '_' + files.length : ''}.png`;
    fs.writeFileSync(path.join(ICONS, file), png(rgba, s.width, x0, y0, x1 - x0, y1 - y0));
    files.push(file);
    icons.push({ file, sheet: s.name, class: classOf(s.name) });
    cut++;
  }
  // S10_* entries are the season-10 chaos versions of a unique in another armour slot (shared generic art)
  if (files.length) index.push({ sno: u.sno, id: u.id, name: u.name, itemType: u.itemType, chaos: /^S10_/.test(u.id) || undefined, files, icons });
}
fs.writeFileSync(path.join(ICONS, 'index.json'), JSON.stringify(index, null, 1));

if (FRAMES) {
  const dir = path.join(ICONS, 'frames');
  fs.mkdirSync(dir, { recursive: true });
  const frames = [];
  for (const id of frameSheets) {
    const s = sheets.get(id);
    const rgba = s && pixelsOf(id);
    if (!rgba) continue;
    s.frames.forEach((uv, i) => {
      const [x0, y0, x1, y1] = [Math.round(uv[0] * s.width), Math.round(uv[1] * s.height), Math.round(uv[2] * s.width), Math.round(uv[3] * s.height)];
      if (x1 - x0 < 16 || y1 - y0 < 16) return;
      const file = `${s.name}_${i}.png`;
      fs.writeFileSync(path.join(dir, file), png(rgba, s.width, x0, y0, x1 - x0, y1 - y0));
      frames.push({ sheet: s.name, frame: i, file });
    });
  }
  fs.writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(frames, null, 1));
  log(`--frames: ${frames.length} unlabelled frames from ${frameSheets.length} weapon / jewellery / seasonal sheets`);
}
fs.writeFileSync(path.join(ICONS, 'sheets.json'), JSON.stringify(Object.fromEntries([...sheets].map(([id, s]) => {
  const p = path.join(RAWB, 'payload', String(id));
  return [id, { name: s.name, format: s.format, width: s.width, height: s.height, payloadBytes: fs.existsSync(p) ? fs.statSync(p).size : null }];
})), null, 1));
log(`${cut} icons written for ${index.length} uniques (${failed} not decoded) -> ${path.relative(ROOT, ICONS)}`);

/** A PNG of the rectangle (x, y, w, h) of an RGBA image `width` px wide. */
function png(rgba, width, x, y, w, h) {
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let r = 0; r < h; r++) {
    raw[r * (w * 4 + 1)] = 0;
    Buffer.from(rgba.buffer, rgba.byteOffset + ((y + r) * width + x) * 4, w * 4).copy(raw, r * (w * 4 + 1) + 1);
  }
  const crc = (b) => { let c = ~0; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return ~c >>> 0; };
  const chunk = (type, data) => { const t = Buffer.from(type); const len = Buffer.alloc(4); len.writeUInt32BE(data.length); const c = Buffer.alloc(4); c.writeUInt32BE(crc(Buffer.concat([t, data]))); return Buffer.concat([len, t, data, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
