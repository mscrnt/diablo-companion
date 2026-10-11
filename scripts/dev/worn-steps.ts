// The to-do list for each piece you wear (from the app's worn-gear memory), with the current rules.
// node scripts/dev/run.mjs worn-steps
import { readFileSync } from "node:fs";
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
for (const [slot, it] of Object.entries(b.worn) as [string, ParsedItem][]) {
  const r = decide({ ...it, equipped: true }, v, { prog });
  console.log(`\n[${slot}] ${it.name} → ${r.verdict}: ${r.action}`);
  console.log("   stats: " + it.affixes.map((a) => `${a.text}${a.enchanted ? " (ench)" : ""}${a.tempered ? " (temp)" : ""}${a.greater ? " ★" : ""}`).join(" | "));
  r.steps?.forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
}
