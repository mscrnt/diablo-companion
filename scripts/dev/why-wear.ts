// Why did the judge say what it said? Prints both items' stats, the comparison rows and each
// stat's weight and contribution for judge-log entries whose item name matches.
// node scripts/dev/run.mjs why-wear "<name regex>" [how many, default 3]
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { decide } from "../../src/lib/judge";
import { buildProfile, compareValue, rowsFromItems } from "../../src/lib/statvalue";
import { emptyProgress } from "../../src/lib/store";
import type { ParsedItem } from "../../src/lib/types";

await loadStaticData();
const state = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const b = JSON.parse(state.builds).state;
const build = b.builds[b.activeBuildId];
const v = build.variants.find((x: any) => x.id === b.activeVariantId) ?? build.variants[0];
const prog = (slot: string) => b.progress[`${build.id}:${v.id}:${slot}`] ?? emptyProgress;
const worn = (slot: string) => b.worn[slot] as ParsedItem | undefined;
const prof = buildProfile(v);

const re = new RegExp(process.argv[2] ?? ".", "i");
const n = Number(process.argv[3] ?? 3);
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
const files = readdirSync(dir).filter((f) => /^\d{4}-.*\.json$/.test(f) && !f.includes("_equipped")).sort().reverse();
const show = (label: string, it: ParsedItem | null | undefined) => {
  if (!it) return console.log(`  ${label}: (none)`);
  console.log(`  ${label}: ${it.name} · ${it.itemType} · ${it.itemPower ?? "?"} IP · ${it.rarity}`);
  for (const a of it.affixes) console.log(`     ${a.greater ? "★" : " "}${a.tempered ? "T" : " "}${a.masterwork ? "M" : " "}${a.enchanted ? "E" : " "} ${a.text}${a.match ? `  [${a.match}]` : ""}`);
  if (it.aspect) console.log(`     power: ${it.aspect.name ?? ""} ${it.aspect.text?.slice(0, 120) ?? ""}`);
};
console.log("main stat:", prof.mainStat, "· tags:", prof.tags.join(", "));
let shown = 0;
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const item = j.result?.item as ParsedItem | undefined;
  if (!item?.name || !re.test(item.name)) continue;
  console.log(`\n=== ${f}  ${j.result.verdict}: ${j.result.action}`);
  show("THIS", item);
  show("COMPARE", item.compare);
  show("WORN (remembered)", worn(item.slot));
  const slots = v.gear.filter((g: any) => g.group === "gear" && g.slot === item.slot);
  for (const slot of slots.length ? slots : v.gear.filter((g: any) => g.group === "gear").slice(0, 0)) {
    const w = item.compare ?? worn(slot.slot) ?? null;
    const rows = item.compareRows?.length ? item.compareRows : w ? rowsFromItems(item, w) : [];
    console.log(`  rows from ${item.compareRows?.length ? "the game's comparison" : "the two items"} · slot ${slot.slotLabel} (${slot.kind} ${slot.itemName ?? ""})`);
    const { score, deltas } = compareValue(rows, slot, prof);
    for (const d of deltas) console.log(`     ${d.value >= 0 ? "+" : ""}${d.value.toFixed(2).padStart(5)}  w${d.weight.toFixed(2)}  ${d.label}  mine ${d.mine ?? "—"} / yours ${d.yours ?? "—"}${d.unit}`);
    console.log(`     stats score ${score.toFixed(2)}`);
  }
  const r = decide(item, v, { prog, worn }, item.compare ?? null);
  console.log(`  now: ${r.verdict} · ${r.action}`);
  r.reasons.forEach((x) => console.log("     · " + x));
  if (++shown >= n) break;
}
