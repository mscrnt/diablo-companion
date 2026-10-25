import { loadStaticData } from "../../src/lib/names";
import { planFarm, bossRoute } from "../../src/lib/farm";
import { emptyProgress } from "../../src/lib/store";
import { EXAMPLE_BUILD } from "../../tests/fixtures/example-build";
await loadStaticData();
const v = EXAMPLE_BUILD.variants.find((v) => v.id === "1")!;
const steps = planFarm(v, () => emptyProgress);
for (const s of steps) console.log(`${s.slotLabel.padEnd(12)} ${s.item.padEnd(34)} ${s.obtain.map((o) => `[${o.method}] ${o.detail.slice(0, 70)}`).join(" || ") || "-"}`);
console.log("\nROUTE:", bossRoute(steps).map((r) => `${r.boss}: ${r.items.map((i) => i.item).join(", ")}${r.info ? " (summon: " + (r.info.summonMaterials ?? []).join(", ") + ")" : ""}`).join("\n  "));
