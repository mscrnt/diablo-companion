// Load the extractor's output from data/gamedata, keyed the way src/lib/gamedata/gen.ts expects
// ("affixes.json", "strings/ui.json", ...).
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT } from "../../tools/datamine/tsload.mjs";

export const GAMEDATA = process.env.D4_DATA_DIR || join(ROOT, "data", "gamedata");

/** @param {string[]} rels */
export function readGameDataDocs(rels) {
  const docs = {};
  for (const rel of rels) {
    const p = join(GAMEDATA, rel);
    if (!existsSync(p)) throw new Error(`${p} is missing: run "node tools/datamine/extract.mjs" first`);
    docs[rel] = JSON.parse(readFileSync(p, "utf8"));
  }
  return docs;
}
