// Re-parse today's judge-log scans whose item had no title and show the name the parser gives now.
// node scripts/dev/run.mjs untitled
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";
await loadStaticData();
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
for (const f of readdirSync(dir).filter((f) => f.endsWith(".json") && !f.includes("_equipped")).sort().slice(-200)) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const was = j.result?.item?.name ?? "";
  if (!/^(ancestral )?(mythic )?unique \w+/i.test(was)) continue;
  const lines = j.hovered?.llm?.lines;
  if (!lines) continue;
  const p = fastParse(lines, false, undefined);
  console.log(`${f.slice(11, 19)}  ${was}  →  ${p?.name}  (${p?.affixes.filter((a) => a.greater).length}★)`);
}
