// Measure OCR snapping on the judge log: item names that resolve to real game text, affix
// lines that match a known stat line, build matches and verdict changes, with and without
// snapping. Also lists every line the snapper changed so over-corrections can be spotted.
//   node scripts/dev/run.mjs snap-test [--lines]
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData, table } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";
import { knownStat, knownWord, snapLine } from "../../src/lib/ocrfix";
import { decide } from "../../src/lib/judge";
import { emptyProgress } from "../../src/lib/store";
import { EXAMPLE_BUILD } from "../../tests/fixtures/example-build";

await loadStaticData();
const v = EXAMPLE_BUILD.variants.find((x) => x.id === (process.env.VARIANT ?? "1")) ?? EXAMPLE_BUILD.variants[0];
console.log(`build variant: ${v.name}`);
const uniques = new Set(Object.values(table("uniques")).map((u) => u.n.toLowerCase()));
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
const showLines = process.argv.includes("--lines");

type Stat = { items: number; parsed: number; nameReal: number; uniqueReal: number; uniques: number; affixes: number; affixKnown: number; buildMatch: number };
const zero = (): Stat => ({ items: 0, parsed: 0, nameReal: 0, uniqueReal: 0, uniques: 0, affixes: 0, affixKnown: 0, buildMatch: 0 });
const S = { off: zero(), on: zero() };
const changes: string[] = [];
const verdicts: string[] = [];
const names: string[] = [];
const unknown: string[] = [];
const ms = { off: 0, on: 0 };
const words = (t: string) => t.match(/[A-Za-z][A-Za-z'’\-]+/g) ?? [];

for (const f of readdirSync(dir).filter((f) => /^2026.*\.json$/.test(f) && !f.includes("_equipped"))) {
  const j = JSON.parse(readFileSync(dir + "/" + f, "utf8"));
  if (!j.hovered?.ocr) continue;
  const ocr: string[] = j.hovered.ocr;
  const llm = j.hovered.llm ?? {};
  const lines = llm.fast && llm.lines
    ? llm.lines
    : ocr.map((t, i) => ({ text: t, bullet: (llm.bullets?.[i] ?? ((llm.lines ?? []).find((l: any) => l.i === i)?.g ? "greater" : "normal")) as any }));
  for (const l of lines) {
    const s = snapLine(l.text);
    if (s !== l.text) changes.push(`${l.text}  →  ${s}`);
  }
  const eq = ocr.some((l) => /^\s*equipped\s*$/i.test(l));
  const res: Record<string, ReturnType<typeof fastParse>> = {};
  for (const mode of ["off", "on"] as const) {
    const st = S[mode];
    st.items++;
    const t0 = performance.now();
    const p = fastParse(lines, eq, v, { snap: mode === "on" });
    ms[mode] += performance.now() - t0;
    res[mode] = p;
    if (!p) continue;
    st.parsed++;
    if (words(p.name).every(knownWord)) st.nameReal++;
    if (p.rarity === "unique" || p.rarity === "mythic") {
      st.uniques++;
      if (uniques.has(p.name.toLowerCase())) st.uniqueReal++;
    }
    for (const a of p.affixes) {
      st.affixes++;
      if (knownStat(a.text)) st.affixKnown++;
      else if (mode === "on") unknown.push(a.text);
      if (a.match) st.buildMatch++;
    }
  }
  const a = res.off, b = res.on;
  if (a?.name !== b?.name) names.push(`${f.slice(11, 19)}  ${a?.name ?? "(none)"}  →  ${b?.name ?? "(none)"}`);
  const va = a ? decide(a, v, { prog: () => emptyProgress }, a.compare) : null;
  const vb = b ? decide(b, v, { prog: () => emptyProgress }, b.compare) : null;
  if (va?.verdict !== vb?.verdict || va?.action !== vb?.action)
    verdicts.push(`${f.slice(11, 19)}  ${b?.name ?? a?.name}: ${va?.verdict ?? "-"} → ${vb?.verdict ?? "-"}\n     was: ${va?.action ?? ""}\n     now: ${vb?.action ?? ""}`);
}

const pct = (n: number, d: number) => `${n}/${d} (${d ? Math.round((100 * n) / d) : 0}%)`;
for (const mode of ["off", "on"] as const) {
  const s = S[mode];
  console.log(`snap ${mode.padEnd(3)}  ${(ms[mode] / s.items).toFixed(1)} ms/tooltip · parsed ${pct(s.parsed, s.items)} · names all real words ${pct(s.nameReal, s.parsed)} · unique names exact ${pct(s.uniqueReal, s.uniques)} · affix lines known ${pct(s.affixKnown, s.affixes)} · build matches ${s.buildMatch}`);
}
console.log(`\n${changes.length} OCR lines changed (${new Set(changes).size} distinct)`);
if (showLines) [...new Set(changes)].forEach((c) => console.log("  " + c));
if (showLines) console.log(`\naffix lines not matching a known stat line:\n  ${[...new Set(unknown)].join("\n  ")}`);
console.log(`\nname changes (${names.length}):`);
names.forEach((n) => console.log("  " + n));
console.log(`\nverdict / action changes (${verdicts.length}):`);
verdicts.forEach((x) => console.log("  " + x));
