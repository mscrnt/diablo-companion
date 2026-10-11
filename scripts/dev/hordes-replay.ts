// Replay the logged Hordes offer screens (judge-log/hordes_*.json) through the offer logic.
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData } from "../../src/lib/names";
import { findOffers, offerPhase, trackerAether, trackerWave, parseAether } from "../../src/lib/hordes";

await loadStaticData();
const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
const files = readdirSync(dir).filter((f) => /^hordes_2.*\.json$/.test(f)).sort();
let phase: string | null = null;
let wave: number | null = null;
const remembered = new Map<string, { title: string; score: number; hits: number }>();
for (const f of files) {
  const j = JSON.parse(readFileSync(`${dir}/${f}`, "utf8"));
  const ocr: string[] = j.ocr ?? [];
  const lines = ocr.map((text, i) => ({ text, x: 0, y: i * 20, w: 200, h: 18 }));
  const text = ocr.join("\n");
  const seen = findOffers(lines, { x: 0, y: 0 }, "balanced");
  const ph = offerPhase(text);
  if (ph && ph !== phase) { remembered.clear(); phase = ph; }
  const w = trackerWave(text);
  if (w != null && w !== wave) { if (wave != null) remembered.clear(); wave = w; }
  if (phase !== "chosen") for (const o of seen) remembered.set(o.key, { title: o.title, score: o.score, hits: (remembered.get(o.key)?.hits ?? 0) + 1 });
  const ranked = phase === "chosen" ? [] : [...remembered.values()].sort((a, b) => b.hits - a.hits).slice(0, 3).sort((a, b) => b.score - a.score);
  console.log(`${f.slice(18, 26)} ${(phase ?? "-").padEnd(9)} aether ${String(trackerAether(lines) ?? parseAether(text) ?? "-").padEnd(4)} now: ${seen.map((o) => o.title.replace("The ", "")).join(", ").padEnd(46)} | pick: ${ranked[0]?.title ?? "-"}`);
}
