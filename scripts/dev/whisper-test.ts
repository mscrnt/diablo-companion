import { loadStaticData } from "../../src/lib/names";
import { findWhisperCaches } from "../../src/lib/whispers";
import { readFileSync } from "node:fs";
import { EXAMPLE_BUILD } from "../../tests/fixtures/example-build";
await loadStaticData();
const v = EXAMPLE_BUILD.variants.find((x) => x.id === "1")!;
// use the user's real tracked progress
const st = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const b = JSON.parse(st.builds).state;
const prog = (slot: string) => b.progress[`${b.activeBuildId}:${b.activeVariantId}:${slot}`] ?? { state: "missing", greater: [], have: [], tempered: false, masterwork: 0 };
console.log("progress:", ["helm", "chest-armor", "ring-1", "ring-2", "gloves"].map((s) => s + "=" + prog(s).state).join(" "));
const L = (t: string, y: number) => ({ text: t, x: 100, y, w: 400, h: 24 });
const r = findWhisperCaches([L("COLLECTION OF HELMS", 0), L("COLLECTION OF CHAOS", 60), L("COLLECTION OF RINGS", 120), L("COLLECTION OF CHESTPLATES", 180)], { x: 0, y: 0 }, v, prog);
r.forEach((c) => console.log(c.rank, c.name, c.score.toFixed(1), "—", c.why));
