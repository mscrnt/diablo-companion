// Character page reading on your saved data and logged hovers: the stats map saved in
// d4c-state.json before/after tidyStats, and the skill / glyph / stats readers replayed on
// skillhover_* and glyphhover_* from the judge log.
//   node scripts/dev/run.mjs char-test
import { readdirSync, readFileSync } from "node:fs";
import { loadStaticData, table } from "../../src/lib/names";
import { parseGlyphHover, parseSkillHover, statsFromRows, tidyStats } from "../../src/lib/charsheet";

await loadStaticData();
const cls = process.env.CLASS ?? "necromancer";
const skills = Object.entries(table("skills")).filter(([, s]) => s.c === cls && s.t === "basic").map(([slug, s]) => ({ slug, name: s.n }));
const glyphs = Object.entries(table("glyphs")).filter(([, g]) => !g.c || g.c === cls).map(([slug, g]) => ({ slug, name: g.n }));

// once the app has migrated your save, fall back to the copy of the old one in the test fixtures
const state = JSON.parse(readFileSync(process.env.APPDATA + "/com.kenneth.d4companion/d4c-state.json", "utf8"));
const saved = JSON.parse(state.character);
const ch = saved.version >= 1 ? JSON.parse(readFileSync("tests/fixtures/character/saved-v0.json", "utf8")) : saved.state;
if (saved.version >= 1) console.log("(your save is already migrated: using tests/fixtures/character/saved-v0.json)");
const before: Record<string, string> = ch.stats ?? {};
const after = tidyStats(before);
console.log(`== saved stats: ${Object.keys(before).length} entries → ${Object.keys(after).length} after tidy`);
for (const [k, v] of Object.entries(after)) console.log(`   ${k}: ${v}`);
console.log("   dropped:", Object.entries(before).filter(([k]) => !(k in after)).map(([k, v]) => `${k} ${v}`).join(" | "));
console.log("\n== saved skills (rank read before the fix = total incl. gear):");
for (const s of Object.values<any>(ch.skills ?? {})) console.log(`   ${s.name}: ${s.rank}${s.max ? "/" + s.max : ""}${s.base != null ? ` base ${s.base} +${s.bonus}` : ""}`);

const dir = process.env.LOCALAPPDATA + "/com.kenneth.d4companion/logs/judge-log";
for (const f of readdirSync(dir).filter((f) => /^(skillhover|glyphhover)_/.test(f))) {
  const j = JSON.parse(readFileSync(dir + "/" + f, "utf8"));
  const lines: string[] = j.lines ?? [];
  const sk = parseSkillHover(lines, skills);
  const gl = parseGlyphHover(lines, glyphs);
  const st = statsFromRows(lines);
  console.log(`\n== ${f}`);
  console.log(`   skill: ${sk ? `${sk.hit.name} total ${sk.total}/${sk.max} bonus ${sk.bonus} → base ${sk.base}` : "-"} · glyph: ${gl ? `${gl.hit.name} level ${gl.level}` : "-"}`);
  if (Object.keys(st).length) console.log("   stats:", Object.entries(st).map(([k, v]) => `${k} ${v}`).join(" | "));
}
