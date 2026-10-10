// Build src/generated/map-pois.json (world-map points of interest) from the datamined
// data/gamedata/map.json (tools/datamine/extract-map.mjs). Re-run after a patch:
//   node scripts/gen-map-pois.mjs
//
// Each poi: { k: kind, n: name (omitted for helltide_chest), r: region (Zone key), x, y: overworld world units (rounded), id: stable key }
// plus optional p (journal part), t (helltide chest tier), a: 1 (approximate position: side quests).
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const map = JSON.parse(readFileSync(join(root, "data/gamedata/map.json"), "utf8"));

// Kinds the app ships. Quest/campaign dungeons, seasonal rifts and one-off activity portals stay in map.json only.
const KINDS = ["waypoint", "altar", "tenet_of_akarat", "chronicle_of_creation", "journal", "stronghold",
  "dungeon", "cellar", "boss_dungeon", "undercity", "side_quest", "helltide_chest"];

const pois = [];
for (const e of map.entries) {
  if (!KINDS.includes(e.kind) || !e.region) continue;
  const o = { k: e.kind, n: e.name, r: e.region, x: Math.round(e.x), y: Math.round(e.y), id: e.hiddenCache || e.item || e.key };
  if (e.extra?.part) o.p = e.extra.part;
  if (e.kind === "helltide_chest") {
    // ~460 spawn points: the name is implied by the kind; id = "<MarkerSet sno>:<marker id>"
    delete o.n;
    o.id = `${e.markerSet}:${e.markerId}`;
    if (e.extra?.tier) o.t = e.extra.tier;
  }
  if (e.precision === "approx") o.a = 1;
  pois.push(o);
}

const { span, artSize, artCenter } = map.projection;
const out = {
  build: map.build,
  source: "data/gamedata/map.json (tools/datamine/extract-map.mjs)",
  // zone-map UV: u = artCenter.x/artSize + (y - x)/(span*sqrt2), v = artCenter.y/artSize + (x + y)/(span*sqrt2)
  projection: { span, artSize, artCenter },
  regions: map.regions,
  pois,
};
mkdirSync(join(root, "src/generated"), { recursive: true });
writeFileSync(join(root, "src/generated/map-pois.json"), JSON.stringify(out));
const counts = {};
for (const p of pois) counts[p.k] = (counts[p.k] ?? 0) + 1;
console.log(`wrote ${pois.length} pois`, JSON.stringify(counts));
