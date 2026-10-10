// Parse tooltip fixtures (tests/fixtures/tooltips/<name>.json) with and without OCR snapping.
//   node scripts/dev/run.mjs fixture-parse doom-armor-of-dominance serrated-reaper
import { readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { normaliseMobalytics } from "../../src/lib/mobalytics";
import { fastParse } from "../../src/lib/fastparse";
import { decide } from "../../src/lib/judge";
import { emptyProgress } from "../../src/lib/store";
import raw from "../../src/seed/necromancer-mages-necro-guide.json";
await loadStaticData();
const v = normaliseMobalytics(raw as any).variants.find((x) => x.id === "1")!;
for (const n of process.argv.slice(2)) {
  const f = JSON.parse(readFileSync(`tests/fixtures/tooltips/${n}.json`, "utf8"));
  for (const snap of [false, true]) {
    const p = fastParse(f.lines, false, v, { snap })!;
    console.log(`== ${n} snap=${snap}: ${p?.name} | ${p?.rarity} | ${p?.slot} | aspect=${p?.aspect?.name} | ${p ? decide(p, v, { prog: () => emptyProgress }, p.compare).verdict : "-"}`);
    p?.affixes.forEach((a) => console.log(`    ${a.text} -> ${a.match}`));
    console.log("    power:", p?.aspect?.text?.slice(0, 120));
    console.log("    compare:", p?.compare?.affixes.map((a) => a.text).join(" | "));
  }
}
