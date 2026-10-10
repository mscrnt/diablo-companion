import { loadStaticData } from "../../src/lib/names";
import { findOffers, findChests, chestAdvice, looksLikeHordes, parseAether } from "../../src/lib/hordes";
import { normaliseMobalytics } from "../../src/lib/mobalytics";
import { emptyProgress } from "../../src/lib/store";
import raw from "../../src/seed/necromancer-mages-necro-guide.json";
await loadStaticData();
const L = (text: string, x: number, y: number) => ({ text, x, y, w: 300, h: 24 });
// OCR-ish text with typos, three offers side by side
const lines = [
  L("The Wrath of HeIl", 400, 300), L("Hellfire intensifies", 400, 330), L("At the end of each wave spawn 15-24 additional Aether", 400, 360),
  L("The Stalking DeviI", 1200, 300), L("A demon of great power has your scent", 1200, 330),
  L("The Aether Goblins", 2000, 300), L("Monsters now have greatly increased health", 2000, 330),
];
for (const style of ["safe", "balanced", "greedy"] as const) {
  const r = findOffers(lines, { x: 0, y: 0 }, style);
  console.log(style.padEnd(9), r.map((o) => `${o.rank}. ${o.title} (${o.score.toFixed(2)})`).join("  |  "));
}
console.log("why #1:", findOffers(lines, { x: 0, y: 0 }, "balanced")[0].why);
console.log("chests:", findChests([L("Spoils of Greater Equipment", 0, 0), L("Spoils of Talismans", 500, 0), L("Spoils of Gold", 900, 0)], { x: 0, y: 0 }).map((c) => c.name));
const v = normaliseMobalytics(raw as any).variants.find((x) => x.id === "1")!;
console.log("advice:", chestAdvice(v, () => emptyProgress, 1250));
console.log("tracker:", looksLikeHordes("Infernal Hordes Wave 3/10 Burning Aether 245"), parseAether("Burning Aether 245"), parseAether("245 Aether"));
