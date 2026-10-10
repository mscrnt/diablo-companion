// Run the in-app map registration (src/lib/mappins.ts) on screenshots of the open map
// and write each with the pins drawn, to check it against the game's own icons.
//   node scripts/dev/run.mjs map-pins <out-dir> <screen.png>... [--height 720] [--no-jpeg] [--all] [--no-quests] [--force]
// The frame goes through the same steps as in the app: crop to the game image (black
// bars removed), downscale to the capture size, a 4:2:0 chroma pass standing in for
// the JPEG step, then detection, registration and projection.
// Screenshots of the game stay local: don't commit them or the output.
import { basename, join } from "node:path";
import { mkdirSync } from "node:fs";
import { chroma420, readPng, resize, writePng, type Rgba } from "./png";
import { GROUP_OF, MapTracker, detect, makeCtx, mapArea, pinsFor, registerFrame, type PinGroup } from "../../src/lib/mappins";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(n);
const opt = (n: string, d: number) => {
  const i = args.indexOf(n);
  return i >= 0 ? Number(args[i + 1]) : d;
};
const files = args.filter((a, i) => !a.startsWith("--") && !(i > 0 && args[i - 1].startsWith("--") && !["--no-jpeg", "--all", "--force", "--no-quests"].includes(args[i - 1])));
const [outDir, ...shots] = files;
const TARGET_H = opt("--height", 720);
mkdirSync(outDir, { recursive: true });

/** Pure-black pillarbox columns on either side. */
function gameBounds(img: Rgba): [number, number] {
  const black = (x: number) => {
    for (let y = 0; y < img.height; y += 4) {
      const i = (y * img.width + x) * 4;
      if (img.data[i] + img.data[i + 1] + img.data[i + 2] > 30) return false;
    }
    return true;
  };
  let l = 0;
  while (l < img.width / 3 && black(l)) l++;
  let r = img.width - 1;
  while (r > (img.width * 2) / 3 && black(r)) r--;
  // the bars are symmetric: take the wider side (as the app's pillarbox detection does)
  const bar = Math.max(l, img.width - 1 - r);
  return [bar, img.width - bar];
}

const COLORS: Record<string, [number, number, number]> = {
  waypoint: [0, 255, 255],
  journal: [255, 255, 255],
  altar: [255, 61, 245],
  tenet_of_akarat: [255, 61, 245],
  chronicle_of_creation: [255, 61, 245],
  dungeon: [255, 208, 0],
  cellar: [255, 122, 0],
  stronghold: [255, 32, 32],
  side_quest: [125, 255, 90],
  helltide_chest: [255, 0, 0],
  undercity: [80, 160, 255],
  boss_dungeon: [200, 0, 0],
};

function ring(img: Rgba, cx: number, cy: number, r: number, c: [number, number, number], t = 3) {
  for (let y = Math.floor(cy - r - t); y <= cy + r + t; y++)
    for (let x = Math.floor(cx - r - t); x <= cx + r + t; x++) {
      if (x < 0 || y < 0 || x >= img.width || y >= img.height) continue;
      const d = Math.hypot(x - cx, y - cy);
      if (Math.abs(d - r) > t / 2) continue;
      const i = (y * img.width + x) * 4;
      img.data[i] = c[0];
      img.data[i + 1] = c[1];
      img.data[i + 2] = c[2];
    }
}

function rect(img: Rgba, x0: number, y0: number, x1: number, y1: number, c: [number, number, number]) {
  for (let x = Math.max(0, Math.floor(x0)); x < Math.min(img.width, x1); x++)
    for (const y of [Math.floor(y0), Math.floor(y1) - 1]) if (y >= 0 && y < img.height) img.data.set(c, (y * img.width + x) * 4);
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(img.height, y1); y++)
    for (const x of [Math.floor(x0), Math.floor(x1) - 1]) if (x >= 0 && x < img.width) img.data.set(c, (y * img.width + x) * 4);
}

const groups: Partial<Record<PinGroup, boolean>> = { journal: true, collectible: true, dungeon: true, cellar: true, stronghold: true, side_quest: !flag("--no-quests") };
if (flag("--all")) for (const g of Object.values(GROUP_OF)) groups[g!] = true;

for (const shot of shots) {
  const img = readPng(shot);
  const [gx0, gx1] = gameBounds(img);
  const gw = gx1 - gx0, gh = img.height;
  const f = Math.min(1, TARGET_H / gh);
  const W = Math.round(gw * f), H = Math.round(gh * f);
  const t0 = performance.now();
  let frame = resize(img, W, H, { x: gx0, y: 0, w: gw, h: gh });
  if (!flag("--no-jpeg")) frame = chroma420(frame);
  const t1 = performance.now();
  const k = H / 1440;
  const area = mapArea(frame);
  const t2 = performance.now();
  const det = detect(frame, k, area);
  const t3 = performance.now();
  const ctx = makeCtx(det, area, k);
  const tracker = new MapTracker();
  const fit = registerFrame(ctx, H, tracker.zooms);
  const t4 = performance.now();
  // the tracker as the app runs it (two frames: an "ok" fit needs a second agreeing frame)
  tracker.step(frame, H, area, k);
  const t5 = performance.now();
  const tr = tracker.step(frame, H, area, k);
  const toScreen = (x: number, y: number): [number, number] => [gx0 + x / f, y / f];
  const sc = fit?.score;
  console.log(
    `${basename(shot)}: game ${gw}×${gh} → frame ${W}×${H} | area y ${area.y0.toFixed(0)}..${area.y1.toFixed(0)} | blobs: ${det.waypoints.length} cyan, ${det.icons.length} outlined`,
  );
  if (sc)
    console.log(
      `  fit (${fit!.source}) ${fit!.verdict}: waypoints ${sc.wpInliers}/${sc.wpExpected} err ${(sc.wpErr / f).toFixed(2)} px · icons ${sc.iconInliers}/${sc.iconExpected} err ${(sc.iconErr / f).toFixed(2)} px · s ${(sc.xf.s / f).toFixed(0)} (zoom ${(sc.xf.s / H).toFixed(3)})`,
    );
  console.log(`  tracker: ${tr.how}${tr.xf ? "" : " (no pins)"}`);
  console.log(`  time: downscale ${(t1 - t0).toFixed(0)} ms · area ${(t2 - t1).toFixed(1)} ms · detect ${(t3 - t2).toFixed(1)} ms · register ${(t4 - t3).toFixed(1)} ms · tracker step ${(t5 - t4).toFixed(1)} ms`);

  const out: Rgba = { data: new Uint8ClampedArray(img.data), width: img.width, height: img.height };
  const [ax0, ay0] = toScreen(area.x0, area.y0);
  const [ax1, ay1] = toScreen(area.x1, area.y1);
  rect(out, ax0, ay0, ax1, ay1, [255, 255, 0]);
  for (const b of det.waypoints) ring(out, ...toScreen(b.x, b.y), 4, [0, 120, 255], 3);
  for (const b of det.icons) ring(out, ...toScreen(b.x, b.y), 3, [120, 120, 120], 2);
  // --force: draw the best fit even when the tracker wouldn't show it (to inspect rejected fits)
  const xf = tr.xf ?? (flag("--force") ? sc?.xf ?? null : null);
  if (xf) {
    const pins = pinsFor(xf, area, H, { groups, helltideRegion: null }, toScreen);
    const kinds: Record<string, number> = {};
    for (const p of pins) {
      kinds[p.k] = (kinds[p.k] ?? 0) + 1;
      ring(out, p.x, p.y, p.k === "side_quest" ? 16 : 22, COLORS[p.k] ?? [255, 255, 255], 4);
    }
    // matched waypoints, so the fit itself is visible too
    for (const uv of sc ? sc.pairs.filter((q) => q.w === 1).map((q) => q.uv) : []) ring(out, ...toScreen(xf.s * uv[0] + xf.tx, xf.s * uv[1] + xf.ty), 30, COLORS.waypoint, 4);
    console.log(`  pins: ${JSON.stringify(kinds)}`);
  }
  writePng(join(outDir, basename(shot).replace(/\.png$/, "-pins.png")), out);
}
