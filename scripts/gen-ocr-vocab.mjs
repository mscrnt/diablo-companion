// Build src/generated/ocr-vocab.json: the game's own words and lines, used to snap Windows OCR
// misreads ("Arit10r" -> "Armor") before a tooltip or the character sheet is parsed. Everything
// comes from the datamined enUS strings and tables in data/gamedata (not shipped). Re-run after a
// patch:
//   node tools/datamine/extract.mjs && node scripts/gen-ocr-vocab.mjs
//
// The app builds this itself from the player's own install (src/lib/gamedata/gen.ts, which is what
// this calls), so this script only exists to refresh the copy in the repo.
import { writeFileSync, mkdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadTs, ROOT } from "../tools/datamine/tsload.mjs";
import { readGameDataDocs } from "./lib/gamedata-docs.mjs";

const FILES = [
  "manifest.json", "affixes.json", "aspects.json", "uniques.json", "items.json", "gems_runes.json", "charms.json", "powers.json",
  "strings/ui.json", "strings/items.json", "strings/powers.json", "strings/affixes.json", "strings/paragon.json", "strings/recipes.json",
];

const { mods, close } = await loadTs("src/lib/gamedata/gen.ts");
try {
  const { genOcrVocab } = mods[0];
  const docs = readGameDataDocs(FILES);
  const out = genOcrVocab(docs, docs["manifest.json"].build?.version ?? null);
  mkdirSync(join(ROOT, "src/generated"), { recursive: true });
  const file = join(ROOT, "src/generated/ocr-vocab.json");
  writeFileSync(file, JSON.stringify(out));
  console.log(
    `wrote ${file} (${(statSync(file).size / 1024).toFixed(0)} KB): ${out.words.split(" ").length} words, ` +
      `${out.stats.length} stat lines, ${out.ui.length} UI lines, ${out.sheet.stats.length} sheet stats, ${out.sheet.currency.length} currencies`,
  );
} finally {
  await close();
}
