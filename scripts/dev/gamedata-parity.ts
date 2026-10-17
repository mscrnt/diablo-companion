// How much of the app's current tables our own game-data conversion reproduces (same slugs). Needs
// data/gamedata from tools/datamine/extract.mjs.   node scripts/dev/run.mjs gamedata-parity
import { readFileSync } from "node:fs";
import { convert } from "../../src/lib/gamedata/convert";
const g = (f: string) => JSON.parse(readFileSync(`data/gamedata/${f}.json`, "utf8"));
const out = convert({ build: g("uniques").build, uniques: g("uniques"), aspects: g("aspects"), affixes: g("affixes"), powers: g("powers"), gemsRunes: g("gems_runes"), charms: g("charms"), paragon: g("paragon"), items: g("items") });
const slim = JSON.parse(readFileSync("src/generated/static-slim.json", "utf8"));
for (const t of ["uniques", "aspects", "stats", "skills", "gems", "runes", "charms", "seals", "glyphs"]) {
  const ours = out[t] ?? {}, theirs = slim[t] ?? {};
  const keys = Object.keys(theirs).filter((k) => !theirs[k].x);
  const hit = keys.filter((k) => ours[k]);
  console.log(t.padEnd(8), "ours", String(Object.keys(ours).length).padStart(5), "| theirs", String(keys.length).padStart(5), "| same slug", `${hit.length} (${Math.round((100 * hit.length) / Math.max(1, keys.length))}%)`, "| missing e.g.", keys.filter((k) => !ours[k]).slice(0, 4).join(", "));
}
console.log("deathgrip", JSON.stringify(out.uniques["deathgrip"]));
console.log("berserk", JSON.stringify(out.aspects["aspect-of-berserk-ripping"]));
