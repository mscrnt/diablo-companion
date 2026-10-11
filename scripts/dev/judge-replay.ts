// Re-judge today's real scans from the judge log with the current rules, using your saved
// build, progress and worn gear, and show where the verdict changed.
// node scripts/dev/run.mjs judge-replay [how many, default 40]
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { decide } from "../../src/lib/judge";
import { emptyProgress } from "../../src/lib/store";
import type { ParsedItem } from "../../src/lib/types";

await loadStaticData();
const state = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const b = JSON.parse(state.builds).state;
const build = b.builds[b.activeBuildId];
const v = build.variants.find((x: any) => x.id === b.activeVariantId) ?? build.variants[0];
const prog = (slot: string) => b.progress[`${build.id}:${v.id}:${slot}`] ?? emptyProgress;
const worn = (slot: string) => b.worn[slot] as ParsedItem | undefined;
const inCodex = (slug: string) => !!b.owned[slug];

const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
const n = Number(process.argv[2] ?? 40);
const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.includes("_equipped")).sort().reverse().slice(0, n);
let changed = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const old = j.result;
  if (!old?.item?.name) continue;
  const item = old.item as ParsedItem;
  const r = decide(item, v, { prog, worn, inCodex }, item.compare ?? null);
  const diff = r.verdict !== old.verdict;
  if (diff) changed++;
  console.log(`${diff ? "≠" : " "} ${f.slice(11, 19)} ${item.name} [${item.slot}]  ${old.verdict} → ${r.verdict}: ${r.action}`);
  if (diff || process.env.ALL) r.reasons.forEach((x) => console.log("      · " + x));
}
console.log(`\n${changed} of ${files.length} verdicts changed`);
