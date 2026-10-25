// Build src/generated/map-pois.json (world-map points of interest) from the datamined
// data/gamedata/map.json. Re-run after a patch:
//   node tools/datamine/extract.mjs && node scripts/gen-map-pois.mjs
//
// Each poi: { k: kind, n: name (omitted for helltide_chest), r: region (Zone key), x, y: overworld
// world units (rounded), id: stable key } plus optional p (journal part), t (helltide chest tier),
// a: 1 (approximate position: side quests).
//
// The app builds this itself from the player's own install (src/lib/gamedata/gen.ts, which is what
// this calls), so this script only exists to refresh the copy in the repo.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadTs, ROOT } from "../tools/datamine/tsload.mjs";
import { readGameDataDocs } from "./lib/gamedata-docs.mjs";

const { mods, close } = await loadTs("src/lib/gamedata/gen.ts");
try {
  const { genMapPois } = mods[0];
  const out = genMapPois(readGameDataDocs(["map.json"])["map.json"]);
  mkdirSync(join(ROOT, "src/generated"), { recursive: true });
  writeFileSync(join(ROOT, "src/generated/map-pois.json"), JSON.stringify(out));
  const counts = {};
  for (const p of out.pois) counts[p.k] = (counts[p.k] ?? 0) + 1;
  console.log(`wrote ${out.pois.length} pois`, JSON.stringify(counts));
} finally {
  await close();
}
