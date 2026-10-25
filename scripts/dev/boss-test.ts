import { loadStaticData } from "../../src/lib/names";
import { findBoss, bossInfo } from "../../src/lib/boss";
import { normaliseMobalytics } from "../../src/lib/mobalytics";
import { readFileSync } from "node:fs";
import raw from "../../tests/fixtures/necromancer-mages-necro-guide.json";
await loadStaticData();
const v = normaliseMobalytics(raw as any).variants.find((x) => x.id === "1")!;
const st = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const b = JSON.parse(st.builds).state;
const prog = (slot: string) => b.progress[`${b.activeBuildId}:${b.activeVariantId}:${slot}`] ?? { state: "missing", greater: [], have: [], tempered: false, masterwork: 0 };
for (const t of ["GRIGOIRE, THE GALVANIC SAINT", "Grigoire", "BOSS TRAINING DUMMY", "Duriel, King of Maggots"]) {
  const n = findBoss([{ text: t, x: 0, y: 0, w: 100, h: 20 }]);
  console.log(JSON.stringify(t), "→", n, n ? JSON.stringify(bossInfo(n, v, prog)) : "");
}
