// Re-read and re-judge shared judgements (downloaded from the bucket, unpacked) with the current code, against
// one of your local builds, and show where the verdict changed. Items the player then put on ("worn" feedback)
// are marked ✓. Reads the files as data only.
// node scripts/dev/run.mjs shared-replay <folder of judgement .json files> <build name part> [install prefix]
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { loadStaticData } from "../../src/lib/names";
import { fastParse } from "../../src/lib/fastparse";
import { decide } from "../../src/lib/judge";
import { emptyProgress } from "../../src/lib/store";
import type { Build, ParsedItem } from "../../src/lib/types";

await loadStaticData();
const [dir, want, install = ""] = process.argv.slice(2);
const state = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const all: Build[] = [];
for (const k of ["builds", "library"]) all.push(...(Object.values(JSON.parse(state[k]).state.builds) as Build[]));
for (const p of Object.values(JSON.parse(state.profiles).state.profiles) as { gear?: { builds: Record<string, Build> } }[]) all.push(...Object.values(p.gear?.builds ?? {}));
const build = all.find((b) => b.name.toLowerCase().includes(want.toLowerCase()));
if (!build) throw new Error(`no local build named like "${want}"`);

const files = (d: string): string[] => readdirSync(d).flatMap((f) => (statSync(join(d, f)).isDirectory() ? files(join(d, f)) : f.endsWith(".json") ? [join(d, f)] : []));
type Item = { kind: string; id: string; at: number; data?: any };
const items: Item[] = [];
for (const f of files(dir)) {
  const j = JSON.parse(readFileSync(f, "utf8"));
  if (String(j.install ?? "").startsWith(install)) items.push(...j.items);
}
const wore = new Set(items.filter((i) => i.kind === "feedback" && (i as any).signal === "worn").map((i) => i.id));
let changed = 0;
let n = 0;
for (const it of items.filter((i) => i.kind === "judgement" && i.data?.build?.name === build.name).sort((a, b) => a.at - b.at)) {
  const d = it.data;
  const v = build.variants.find((x) => x.id === d.build.variantId) ?? build.variants[0];
  const lines = d.tooltip?.hovered;
  const item = (Array.isArray(lines) && lines.length ? fastParse(lines, !!d.tooltip.equippedLabel, v) : null) ?? (d.item as ParsedItem);
  const worn = (_slot: string) => (d.worn as ParsedItem | null) ?? undefined;
  const r = decide(item, v, { prog: () => emptyProgress, worn, className: build.className }, item.compare ?? null);
  n++;
  const diff = r.verdict !== d.verdict;
  if (diff) changed++;
  if (!diff && !process.env.ALL) continue;
  console.log(`${diff ? "≠" : " "}${wore.has(it.id) ? "✓" : " "} ${new Date(it.at).toISOString().slice(5, 19)} ${item.name}  ${d.verdict} → ${r.verdict}: ${r.action}`);
  r.reasons.slice(0, Number(process.env.REASONS ?? 3)).forEach((x) => console.log("      · " + x));
}
console.log(`\n${changed} of ${n} verdicts changed (✓ = the player put it on)`);
