// The app's tables come from the player's own Diablo IV install, and nothing from the game is in the repo, so
// tests that need real names read the data extracted on this PC (`node tools/datamine/extract.mjs`, or
// GAMEDATA_DIR). Without it (CI) those tests are skipped: see `hasGameData`. The converted tables are kept
// next to the data, so each test file doesn't convert them again.
//
// Importing this only wires the source up; setup.ts (vitest) then loads it, and a dev script loads it
// itself. Nothing here may top-level-await: the dev runner injects this file into every module.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convert, type Extracted } from "../src/lib/gamedata/convert";
import { APP_STRING_FILES } from "../src/lib/gamedata/pipeline";
import { setStaticSource, type StaticSource } from "../src/lib/names";

export const GAMEDATA = process.env.GAMEDATA_DIR ?? "data/gamedata";
export const hasGameData = existsSync(join(GAMEDATA, "affixes.json")) && existsSync(join(GAMEDATA, "generated", "ocr-vocab.json"));

const EXTRACTED: [keyof Extracted, string][] = [
  ["affixes", "affixes.json"],
  ["aspects", "aspects.json"],
  ["uniques", "uniques.json"],
  ["items", "items.json"],
  ["gemsRunes", "gems_runes.json"],
  ["charms", "charms.json"],
  ["paragon", "paragon.json"],
  ["powers", "powers.json"],
  ["monsters", "monsters.json"],
  ["gbid", "gbid.json"],
  ["skillTrees", "skilltrees.json"],
  ["tempering", "tempering.json"],
];
const read = (f: string) => (existsSync(join(GAMEDATA, f)) ? JSON.parse(readFileSync(join(GAMEDATA, f), "utf8")) : undefined);

function tables(): StaticSource["tables"] {
  const build = read("manifest.json")?.build?.version ?? read("uniques.json")?.build ?? "?";
  const cache = join(GAMEDATA, ".test", `tables-${build}.json`);
  if (existsSync(cache)) return JSON.parse(readFileSync(cache, "utf8"));
  const x: Extracted = { build };
  for (const [k, f] of EXTRACTED) (x as any)[k] = read(f);
  x.strings = Object.assign({}, ...APP_STRING_FILES.map((f) => read(f) ?? {}));
  const t = convert(x);
  // written once and renamed into place, so test files starting together never read half a file
  mkdirSync(join(GAMEDATA, ".test"), { recursive: true });
  const tmp = `${cache}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(t));
  renameSync(tmp, cache);
  return t as unknown as StaticSource["tables"];
}

setStaticSource(async () =>
  hasGameData
    ? { tables: tables(), ocrVocab: read("generated/ocr-vocab.json"), generated: { hordes: read("generated/hordes.json"), mapPois: read("generated/map-pois.json") } }
    : { tables: null, ocrVocab: null, generated: null },
);
