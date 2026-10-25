// Re-run the decision logic on real items from the app's loot history.
import { readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { normaliseMobalytics } from "../../src/lib/mobalytics";
import { decide } from "../../src/lib/judge";
import { cubeHint } from "../../src/lib/farm";
import { emptyProgress } from "../../src/lib/store";
import raw from "../../tests/fixtures/necromancer-mages-necro-guide.json";
import type { ParsedItem } from "../../src/lib/types";

await loadStaticData();
const v = normaliseMobalytics(raw as any).variants.find((x) => x.id === "1")!;
const state = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const hist = JSON.parse(state.loot).state.history as { item: any }[];
const show = (label: string, item: ParsedItem, worn?: Record<string, ParsedItem>) => {
  const r = decide(item, v, { prog: () => emptyProgress, worn: (s) => worn?.[s], cubeHint });
  console.log(`\n[${label}] ${item.name} → ${r.verdict}: ${r.action}`);
  r.reasons.forEach((x) => console.log("   · " + x));
  r.steps?.forEach((x, i) => console.log(`   ${i + 1}. ${x}`));
};
const items = hist.map((h) => ({ ...h.item, affixes: h.item.affixes.map((a: any) => ({ ...a, tempered: false })) })) as ParsedItem[];
for (const it of items.slice(0, 3)) {
  show("backpack, nothing known", { ...it, equipped: false });
  show("wearing it", { ...it, equipped: true });
}
// a weaker stand-in helm vs the worn Undercrown
const crown = items.find((i) => /undercrown/i.test(i.name))!;
const rareHelm: ParsedItem = { name: "Grim Visage", rarity: "rare", itemType: "Rare Helm", slot: "helm", itemPower: 800, affixes: [{ text: "+90 Intelligence", greater: false, match: "Intelligence" }, { text: "+900 Armor", greater: false, match: "Armor" }], aspect: null };
show("rare helm vs worn Undercrown", rareHelm, { helm: { ...crown, equipped: true } });
const scythe: ParsedItem = { name: "Scythe", rarity: "common", itemType: "Two-Handed Scythe", slot: "weapon", itemPower: 800, affixes: [], aspect: null };
show("white scythe", scythe);
