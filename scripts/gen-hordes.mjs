// Build src/generated/hordes.json (Infernal Hordes offers + Spoils chests + Tree of Whispers
// caches) from the datamined game strings in data/gamedata/strings. Re-run after a patch:
//   node tools/datamine/extract.mjs && node scripts/gen-hordes.mjs
//
// The app itself builds this table from the player's own install (src/lib/gamedata/gen.ts, which
// is what this calls), so this script only exists to refresh the copy in the repo.
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadTs, ROOT } from "../tools/datamine/tsload.mjs";
import { readGameDataDocs } from "./lib/gamedata-docs.mjs";

const { mods, close } = await loadTs("src/lib/gamedata/gen.ts");
try {
  const { genHordes } = mods[0];
  const out = genHordes(readGameDataDocs(["strings/actors.json", "strings/items.json"]));
  mkdirSync(join(ROOT, "src/generated"), { recursive: true });
  writeFileSync(join(ROOT, "src/generated/hordes.json"), JSON.stringify(out, null, 1));
  console.log(`wrote ${out.offers.length} offers, ${out.chests.length} chests, ${out.whisperCaches.length} whisper caches`);
} finally {
  await close();
}
