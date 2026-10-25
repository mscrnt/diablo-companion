// Run the instant parser on the OCR lines saved in the judge log.
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse, looksSane } from "../../src/lib/fastparse";
import { decide } from "../../src/lib/judge";
import { emptyProgress } from "../../src/lib/store";
import { EXAMPLE_BUILD } from "../../tests/fixtures/example-build";

await loadStaticData();
const v = EXAMPLE_BUILD.variants.find((x) => x.id === "1")!;
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
for (const f of readdirSync(dir).filter((f) => /^20\d\d-.*\.json$/.test(f) && !f.includes("_equipped") && f > "2026-10-10T05-15")) {
  const j = JSON.parse(readFileSync(dir + "/" + f, "utf8"));
  if (!j.hovered?.ocr) continue;
  const ocr: string[] = j.hovered.ocr;
  const llm = j.hovered.llm ?? {};
  // replay exactly when the log has fast lines; older logs: bullets array or LLM labels
  const lines = llm.fast && llm.lines
    ? llm.lines
    : ocr.map((t, i) => ({ text: t, bullet: (llm.bullets?.[i] ?? ((llm.lines ?? []).find((l: any) => l.i === i)?.g ? "greater" : "normal")) as any }));
  const t0 = performance.now();
  const p = fastParse(lines, ocr.some((l) => /^\s*equipped\s*$/i.test(l)), v);
  const ms = (performance.now() - t0).toFixed(1);
  console.log(`\n== ${f.slice(11, 19)}  ${ms}ms  sane=${p ? looksSane(p) : "-"}`);
  if (!p) { console.log("   (not confident → LLM fallback)"); continue; }
  console.log(`   ${p.name} | ${p.rarity} | ${p.itemType} | slot=${p.slot} eq=${p.equipped} tempers=${p.tempersUsed}`);
  p.affixes.forEach((a) => console.log(`     ${a.greater ? "★" : a.masterwork ? "M" : a.tempered ? "T" : " "} ${a.text} -> ${a.match}`));
  if (p.compare) console.log(`   YOURS: ${p.compare.affixes.map((a) => a.text + (a.match ? "✓" : "")).join(" | ")}`);
  if (p.aspect) console.log(`   power: ${p.aspect.name} | ${p.aspect.text.slice(0, 80)}`);
  const r = decide(p, v, { prog: () => emptyProgress }, p.compare);
  console.log(`   → ${r.verdict}: ${r.action}`);
  r.reasons.forEach((x) => console.log("      · " + x));
}
