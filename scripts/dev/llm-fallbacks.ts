// Scans the judge log for items that went to the slow AI read and re-runs the quick parser on them:
// which would now be read locally, and what it makes of them.
// node scripts/dev/run.mjs llm-fallbacks [how many files, default 300]
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse, looksSane } from "../../src/lib/fastparse";

await loadStaticData();
const b = JSON.parse(JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8")).builds).state;
const build = b.builds[b.activeBuildId];
const variant = build?.variants.find((x: any) => x.id === b.activeVariantId) ?? build?.variants[0];
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.includes("_equipped")).sort().reverse().slice(0, Number(process.argv[2] ?? 300));
let llm = 0, now = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  if (!j.hovered?.llm || j.hovered.llm.fast === true || !j.hovered?.ocr?.length) continue;
  llm++;
  const lines = j.hovered.ocr.map((t: any) => (typeof t === "string" ? { text: t, bullet: "normal" } : t));
  const it = fastParse(lines, !!j.hovered.equippedLabel, variant);
  const ok = !!it && looksSane(it);
  if (ok) now++;
  console.log(`${ok ? "✓" : "✗"} ${f.slice(11, 19)} ${String(j.result?.item?.name ?? "?").slice(0, 34).padEnd(34)} → ${ok ? `${it!.name} [${it!.slot}/${it!.category}] ${it!.affixes.length} stats` : `first: ${JSON.stringify(j.hovered.ocr.slice(0, 2))}`}`);
}
console.log(`\n${now} of ${llm} AI-read scans would now be read locally`);
