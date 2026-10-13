// How well does each signal combination name the item? Pairs each test-mode icon (labelled with its judged
// name) with the scan just before it (the tooltip text), adds the icon scores from the spike, and scores:
// title only, text signals, icon only, and combinations, also with the title removed (as if OCR lost it).
// node scripts/dev/run.mjs identify-eval <icon-scores.json>
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";
import { confident, identifyUnique, WEIGHTS, type IdentifyInput } from "../../src/lib/identify";

await loadStaticData();
const DIR = `${process.env.LOCALAPPDATA}/com.kenneth.d4companion/logs/test-mode`;
const iconScores: { icon: string; label: string; scores: Record<string, number> }[] = JSON.parse(readFileSync(process.argv[2], "utf8"));
const scans = readdirSync(DIR).filter((f) => f.endsWith("_scan.json")).sort();

const cases: { label: string; inp: IdentifyInput }[] = [];
for (const s of iconScores) {
  // the scan written just before this icon (same judgement)
  const scan = scans.filter((f) => f < s.icon).pop();
  if (!scan) continue;
  const j = JSON.parse(readFileSync(`${DIR}/${scan}`, "utf8"));
  const lines: { text: string; bullet?: string }[] = j.tooltip?.hovered ?? [];
  const item = fastParse(lines.map((l) => ({ text: l.text, bullet: (l.bullet ?? "none") as never })), false, undefined);
  if (!item) continue;
  // the raw title: the lines above the type line
  const ti = lines.findIndex((l) => /\b(unique|mythic|legendary)\b/i.test(l.text));
  const title = lines.slice(0, Math.max(0, ti)).map((l) => l.text).filter((t) => !/equipped|transmog|^\W*$/i.test(t)).join(" ");
  cases.push({ label: s.label, inp: { title, itemType: item.itemType, power: item.aspect?.text ?? "", stats: item.affixes.map((a) => a.text), className: "Necromancer", icon: s.scores } });
}

const modes: [string, (i: IdentifyInput) => IdentifyInput][] = [
  ["title only", (i) => ({ ...i, power: "", stats: [], icon: undefined })],
  ["title + power + stats", (i) => ({ ...i, icon: undefined })],
  ["title + power + stats + icon", (i) => i],
  ["NO TITLE: power + stats", (i) => ({ ...i, title: "", icon: undefined })],
  ["NO TITLE: icon only", (i) => ({ ...i, title: "", power: "", stats: [] })],
  ["NO TITLE: power + stats + icon", (i) => ({ ...i, title: "" })],
  ["NO TITLE, NO POWER: stats + icon", (i) => ({ ...i, title: "", power: "" })],
];
console.log(`${cases.length} test items (${new Set(cases.map((c) => c.label)).size} different uniques)\n`);
for (const [name, f] of modes) {
  let first = 0, sure = 0, sureWrong = 0;
  for (const c of cases) {
    const r = identifyUnique(f(c.inp), WEIGHTS);
    if (r[0]?.name === c.label) first++;
    const k = confident(r);
    if (k?.name === c.label) sure++;
    else if (k) sureWrong++;
  }
  const pct = (n: number) => `${Math.round((100 * n) / cases.length)}%`;
  console.log(`${name.padEnd(36)} first ${pct(first).padStart(4)}   confident & right ${pct(sure).padStart(4)}   confident & WRONG ${pct(sureWrong).padStart(4)}`);
}

console.log("\nconfident & wrong (title + power + stats):");
for (const c of cases) {
  const r = identifyUnique({ ...c.inp, icon: undefined }, WEIGHTS);
  const k = confident(r);
  if (k && k.name !== c.label) console.log(`  labelled "${c.label}" → named "${k.name}" | title "${c.inp.title}" | power "${c.inp.power.slice(0, 70)}"`);
}
