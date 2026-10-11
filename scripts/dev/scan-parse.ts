// Parse a test-mode scan record's tooltip lines with the quick parser and print the result.
// node scripts/dev/run.mjs scan-parse <part of the scan file name>
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";
await loadStaticData();
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/test-mode";
const f = readdirSync(dir).filter((f) => f.includes(process.argv[2] ?? "") && f.endsWith("_scan.json")).sort().pop()!;
const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
const h = j.tooltip?.hovered;
console.log("hovered keys", Object.keys(h ?? {}));
const lines = h?.lines ?? h?.llm?.lines ?? j.ocr;
console.log(f, Object.keys(j.tooltip ?? {}));
console.log(lines.map((l: any) => `${String(l.bullet ?? "").padEnd(9)} ${l.text}`).join("\n"));
console.log(JSON.stringify(fastParse(lines, false, undefined), null, 1)?.slice(0, 1500));
