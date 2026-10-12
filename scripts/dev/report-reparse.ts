// Re-parse the tooltips in a player's debug report (unzipped folder) with the current quick parser, to
// see which failed reads today's code handles. Reads the report's files as data only.
// node scripts/dev/run.mjs report-reparse <unzipped report folder>
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";

await loadStaticData();
const dir = `${process.argv[2]}/test-mode`;
let failedThen = 0;
let readNow = 0;
for (const f of readdirSync(dir).filter((f) => f.endsWith("_scan.json")).sort()) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const lines = j.tooltip?.hovered;
  if (!Array.isArray(lines) || !lines.length) continue;
  const then = j.verdict?.item?.name ?? null;
  const p = fastParse(lines, false, undefined);
  if (!then) failedThen++;
  if (!then && p) readNow++;
  const first = lines.slice(0, 3).map((l: { text: string }) => l.text).join(" / ");
  console.log(`${f.slice(11, 19)}  then: ${then ?? "FAILED"}  now: ${p ? `${p.name} [${p.rarity}, ${p.affixes.length} stats, ${p.affixes.filter((a) => a.greater).length}★]` : "FAILED"}  | ${first.slice(0, 70)}`);
}
console.log(`\nfailed then: ${failedThen}, read now: ${readNow}`);
