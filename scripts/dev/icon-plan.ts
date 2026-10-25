// The whole icon path the app takes, outside the app: the game install -> the plan -> the squares.
//
//   node scripts/dev/run.mjs icon-plan [--game "G:\Blizzard\Diablo IV"] [--uniques <uniques.json>]
//                                      [--labels <labels.json>] [--no-cut]
//
// It runs the app's own code (src/lib/gamedata/icons.ts, which is what registerIcons() hands to
// icon recognition) over a Node IO instead of the Tauri one, starting from an EMPTY raw folder, so
// `ensure` has to copy every file it needs out of CASC exactly as it does in the app after a read.
// Reports how many uniques got art, where each one's art was found, which records got none, the
// timings, and how much of it agrees with an independent labelling if one is on disk.
//
// Read-only: cascx only opens the game for reading, and nothing is written outside the scratch
// folder, which is emptied again at the end.
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { iconFiles, planIcons } from "../../src/lib/gamedata/icons";
import { parseBuildInfo } from "../../src/lib/gamedata/io";
import { cutArt } from "../../src/lib/icons/extract";
import type { UniqueRow } from "../../src/lib/icons/types";
import { cleanDir, nodeIo } from "../../tools/datamine/nodeIo.mjs";

const argv = process.argv.slice(2);
const opt = (n: string, d = "") => {
  const i = argv.indexOf(n);
  return i >= 0 ? argv[i + 1] : d;
};
const GAME = opt("--game", "G:\\Blizzard\\Diablo IV");
const UNIQUES = opt("--uniques", "D:/Projects/diablo-companion/data/gamedata/uniques.json");
const VENDOR = opt("--d4data", "src-tauri/resources/d4data");
const CASCX = opt("--cascx", "src-tauri/bin/cascx-x86_64-pc-windows-msvc.exe");
const OUT = opt("--out", join(tmpdir(), "d4c-icon-plan"));
const LABELS = opt("--labels", "D:/Projects/diablo-companion/data/gamedata/icons/frames/labels.json");
const CUT = !argv.includes("--no-cut");

const secs = (ms: number) => (ms / 1000).toFixed(1) + " s";
const mb = (b: number) => (b / 1024 / 1024).toFixed(1) + " MB";
const pct = (n: number, of: number) => `${Math.round((n / Math.max(1, of)) * 100)}%`;

if (!existsSync(GAME)) throw new Error(`no Diablo IV install at ${GAME} (pass --game)`);
if (!existsSync(UNIQUES)) throw new Error(`no uniques.json at ${UNIQUES} (pass --uniques, or run tools/datamine/extract.mjs first)`);

// the uniques the app reads back out of its own cache
const doc = JSON.parse(readFileSync(UNIQUES, "utf8")) as { build?: string; entries: UniqueRow[] };
const uniques: UniqueRow[] = doc.entries.map((u) => ({ sno: u.sno, id: u.id, name: u.name, itemType: u.itemType }));
const build = parseBuildInfo(readFileSync(join(GAME, ".build.info"), "utf8")).version;
console.log(`${GAME}: build ${build}, ${uniques.length} uniques from build ${doc.build ?? "?"}`);
if (doc.build && doc.build !== build) console.log(`  note: the install has been patched since that uniques.json was written`);

// start from nothing, the way the app does: a finished read deletes its raw copy
const raw = join(OUT, "raw");
mkdirSync(raw, { recursive: true });
cleanDir(raw);
const plainIo = nodeIo({ game: GAME, out: OUT, raw, vendor: VENDOR, cascx: CASCX, quiet: true });
// time the copies out of CASC apart from the parsing, since they are most of the wait
let cascMs = 0;
let cascFiles = 0;
const io = {
  ...plainIo,
  async casc(names: string[], mode: "mask" | "list") {
    const t = performance.now();
    const r = await plainIo.casc(names, mode);
    cascMs += performance.now() - t;
    cascFiles += names.length;
    return r;
  },
};

// ---- the plan ------------------------------------------------------------------------------
const t0 = performance.now();
const p = await planIcons({ io, build, uniques });
const planMs = performance.now() - t0;
const planCascMs = cascMs;
const planCascFiles = cascFiles;
const { perClass, item, actor } = p.via;
const found = perClass + item + actor;
const noArt = new Set(p.noArt);

console.log(`\nplan: ${secs(planMs)} = ${secs(planCascMs)} copying ${planCascFiles} files out of CASC (${mb(await io.rawBytes())}) + ${secs(planMs - planCascMs)} reading the tables`);
console.log(`  art to cut       ${p.items.length} pieces on ${p.sheets.length} sheets`);
console.log(`  uniques with art ${found} of ${uniques.length} (${pct(found, uniques.length)})`);
console.log(`    the item's own icon handle   ${item}`);
console.log(`    tInvImages, one per class    ${perClass}`);
console.log(`    the item's actor             ${actor}`);
console.log(`  no art at all    ${p.noArt.length}`);
console.log(`  before this change (tInvImages only): ${perClass} of ${uniques.length} (${pct(perClass, uniques.length)})`);

// the actor route is what weapons and jewellery needed, so report coverage per kind of item. Per
// RECORD, not per name: an S10 chaos copy of an amulet is a Boots record with the amulet's name.
const kind = (t = "") =>
  /Ring|Amulet/i.test(t) ? "jewellery" : /Gloves|Boots|Helm|Chest|Legs|Pants/i.test(t) ? "armour" : /Shield|Focus|Totem/i.test(t) ? "offhand" : t ? "weapon/other" : "unknown";
const kinds = new Map<string, { n: number; art: number; missed: string[] }>();
for (const u of uniques) {
  const k = kinds.get(kind(u.itemType)) ?? { n: 0, art: 0, missed: [] };
  k.n++;
  if (noArt.has(u.sno)) k.missed.push(`${u.id} "${u.name}"`);
  else k.art++;
  kinds.set(kind(u.itemType), k);
}
console.log(`\nby kind of item, per record:`);
for (const [k, v] of [...kinds].sort((a, b) => b[1].n - a[1].n)) console.log(`  ${k.padEnd(13)} ${String(v.art).padStart(4)} of ${String(v.n).padEnd(4)} ${pct(v.art, v.n)}`);
const missed = [...kinds].flatMap(([k, v]) => v.missed.map((m) => `${k}: ${m}`));
if (missed.length) {
  console.log(`\nno art for ${missed.length} records:`);
  for (const m of missed.slice(0, 25)) console.log(`  ${m}`);
}

// ---- does it pick the frame an independent labelling picked? -------------------------------
// data/gamedata/icons/frames/labels.json comes from a one-off spike that matched every frame of
// every sheet against named reference icons. It isn't reproducible and it isn't ground truth, but
// it was arrived at a completely different way, so agreement is worth something.
if (existsSync(LABELS)) {
  const labels = JSON.parse(readFileSync(LABELS, "utf8")) as { name: string; sheet: string; frame: number }[];
  const sheetName = new Map(p.sheets.map((s) => [s.sno, s.name]));
  const mine = new Map<string, Set<string>>();
  for (const i of p.items) {
    const at = `${sheetName.get(i.sheet)}#${i.frame}`;
    (mine.get(i.entry.n) ?? mine.set(i.entry.n, new Set()).get(i.entry.n)!).add(at);
  }
  let agree = 0;
  const differ: string[] = [];
  let unknown = 0;
  for (const l of labels) {
    const got = mine.get(l.name);
    if (!got) {
      unknown++;
      continue;
    }
    if (got.has(`${l.sheet}#${l.frame}`)) agree++;
    else differ.push(`${l.name}: labelled ${l.sheet}#${l.frame}, planned ${[...got].join(" ")}`);
  }
  console.log(`\nagainst ${LABELS}:`);
  console.log(`  ${agree} of ${agree + differ.length} labelled names land on exactly the same frame (${pct(agree, agree + differ.length)}); ${unknown} labelled names have no record in this build`);
  for (const d of differ.slice(0, 10)) console.log(`  differs: ${d}`);
}

// ---- the squares ---------------------------------------------------------------------------
const files = iconFiles({ io, build, uniques });
if (CUT) {
  const sheetOf = new Map(p.items.map((i) => [i.entry, i.sheet]));
  const sheetName = new Map(p.sheets.map((s) => [s.sno, s.name]));
  const t2 = performance.now();
  await files.ensure!(p.sheets.map((s) => `base:payload\\${s.sno}`));
  const payloadMs = performance.now() - t2;
  const payloadBytes = await io.rawBytes();
  const t1 = performance.now();
  let cut = 0;
  let px = 0;
  const perSheet = new Map<string, number>();
  for await (const art of cutArt(files, p)) {
    cut++;
    px += art.w * art.h;
    const name = sheetName.get(sheetOf.get(art.entry)!) ?? "?";
    perSheet.set(name, (perSheet.get(name) ?? 0) + 1);
  }
  const cutMs = performance.now() - t1;
  console.log(`\nsheets: ${secs(payloadMs)} to copy ${p.sheets.length} payloads out of CASC, raw copy now ${mb(payloadBytes)}`);
  console.log(`cut: ${secs(cutMs)} for ${cut} squares (${(cutMs / Math.max(1, cut)).toFixed(1)} ms each), ${mb(px * 4)} of pixels`);
  if (p.items.length - cut) console.log(`${p.items.length - cut} planned pieces were not cut (an encrypted sheet, or a frame under 8 px)`);
  console.log(`\nsheets, most art first:`);
  for (const [name, n] of [...perSheet].sort((a, b) => b[1] - a[1]).slice(0, 14)) console.log(`  ${String(n).padStart(4)}  ${name}`);
} else console.log(`\n(--no-cut: the sheets were not decoded)`);

await files.release!();
console.log(`\nraw copy deleted again: ${mb(await io.rawBytes())}`);
