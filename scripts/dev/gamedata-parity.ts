// How much of the app's current tables (src/generated/static-slim.json, Mobalytics) our own conversion of the
// player's game data reproduces: by slug and, because their slugs carry their own ids, by name. Needs the
// extractor's output (tools/datamine/extract.mjs); set GAMEDATA_DIR to read it from another checkout.
//   node scripts/dev/run.mjs gamedata-parity [table …] [--dump <file>]
import { readFileSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { convert, slugOf, type Extracted } from "../../src/lib/gamedata/convert";
import { normStat, trigramSim } from "../../src/lib/names";

const dir = process.env.GAMEDATA_DIR ?? "data/gamedata";
const g = (f: string) => JSON.parse(readFileSync(join(dir, `${f}.json`), "utf8"));
/** strings/*.json merged into one StringList → labels map (the app's reader will hand over the same). */
const strings = () => {
  const d = join(dir, "strings");
  const out: Record<string, Record<string, string>> = {};
  if (!existsSync(d)) return out;
  for (const f of readdirSync(d)) Object.assign(out, JSON.parse(readFileSync(join(d, f), "utf8")));
  return out;
};

const input: Extracted = {
  build: g("uniques").build,
  uniques: g("uniques"),
  aspects: g("aspects"),
  affixes: g("affixes"),
  powers: g("powers"),
  gemsRunes: g("gems_runes"),
  charms: g("charms"),
  paragon: g("paragon"),
  items: g("items"),
  monsters: g("monsters"),
  gbid: g("gbid"),
  strings: strings(),
};
const out = convert(input);
const slim = JSON.parse(readFileSync("src/generated/static-slim.json", "utf8"));

const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Every upgrade name this build's skill trees offer, as slugs ("bursting", "mighty-roar"). */
const gameMods = new Set(
  (input.powers?.skills ?? []).flatMap((s: any) =>
    Object.entries(s.strings ?? {})
      .filter(([k]) => /^Mod\d+_Name$/.test(k))
      .map(([, v]) => slugOf(String(v))),
  ),
);
const baseSkills = Object.values(out.skills ?? {})
  .filter((e: any) => e.t === "basic")
  .map((e: any) => e.n as string)
  .sort((a, b) => b.length - a.length);
/**
 * A skill-tree upgrade of a skill we know, whose upgrade part is not one of this build's `ModN_Name` strings:
 * Mobalytics still ships the pre-rework naming ("Sharp Withering Fist", "Skeletal Warriors: Skirmishers").
 */
function stale(e: any): boolean {
  if (!e.n || e.t === "basic" || e.t === "choice-connector") return false;
  const base = baseSkills.find((b) => new RegExp(`\\b${esc(b)}\\b`, "i").test(e.n));
  if (!base) return false;
  const rest = slugOf(e.n.replace(new RegExp(`\\b${esc(base)}\\b`, "i"), " "));
  return !!rest && !gameMods.has(rest);
}

/**
 * What the current tables hold that this build of the game simply doesn't: content Blizzard removed, and rows
 * Mobalytics made up or scraped badly. Expected misses, not gaps in the conversion.
 */
const LEFTOVERS: Record<string, { why: string; is: (slug: string, e: any) => boolean }[]> = {
  gems: [{ why: "removed from the game", is: (_s, e) => e.n === "Tyrant Bane" }],
  glyphs: [{ why: "removed from the game", is: (_s, e) => ["Tears of Blood", "Frostfeeder", "Frostbite"].includes(e.n) }],
  seals: [{ why: "placeholder row", is: (s) => s === "new-seal" }],
  charms: [
    // unique powers Mobalytics lists as charms; this build has no Talisman_Charm_Unique item for them
    {
      why: "no charm item in the game files",
      is: (_s, e) =>
        [
          "Black River", "Blood Artisan's Cuirass", "Deathspeaker's Pendant", "Gravebloom", "Greaves of the Empty Tomb",
          "Indira's Memory", "Okun's Catalyst", "Ring of Mendeln", "Rotting Lightbringer", "Sliver of Hate", "Tempest Roar",
          "Gloves of the Illuminator", "Vasily's Prayer", "Beru of the Nameles", "Kabraxis' Wall",
        ].includes(e.n),
    },
  ],
  skills: [
    { why: "Mobalytics' own numeric key, no description", is: (s, e) => /-rune-\d+$/.test(s) && !e.d },
    { why: "weapon expertise, named differently in the game", is: (s) => /^(1h|2h)-(axe|mace|sword)$|^polearm$|^shield$/.test(s) },
    { why: "skill-tree upgrade under a name this build no longer uses", is: (_s, e) => stale(e) },
  ],
  stats: [{ why: "name carries a rolled value", is: (_s, e) => /[\d[\]]|\bX\b/.test(e.n) }],
  boards: [{ why: 'the game calls the starter board "Start"', is: (_s, e) => e.n === "Starter Board" }],
  bloodied: [{ why: "equipment-slot labels; names.ts declares the table but nothing reads it", is: () => true }],
  wpNodes: [{ why: "War Plans node layout (GenericSkillTree meta) is not extracted", is: () => true }],
};

/** Tables whose Mobalytics slug carries something of their own, so only the name can match. */
const NAME_ONLY: Record<string, (slug: string, e: any) => boolean> = {
  // "demolition-finesse-damage-with-two-handed-slashing-weapons": the tempering manual, which is not extracted
  stats: (_s, e) => e.k === "tempering" || !!e.r,
};

const leftover = (table: string, slug: string, e: any) => LEFTOVERS[table]?.find((l) => l.is(slug, e))?.why;

const argv = process.argv.slice(2);
const dump = argv.indexOf("--dump");
if (dump >= 0) writeFileSync(argv[dump + 1], JSON.stringify(out, null, 1));
const asked = argv.filter((a, i) => !a.startsWith("--") && (dump < 0 || i !== dump + 1));
const TABLES = asked.length
  ? asked
  : ["uniques", "aspects", "stats", "skills", "gems", "runes", "charms", "seals", "chaosPerks", "boards", "glyphs", "nodes", "mercs", "mercSkills", "mercOpp", "wpTrees", "wpNodes", "bloodied"];

const pct = (a: number, b: number) => `${b ? Math.round((100 * a) / b) : 0}%`.padStart(4);
const rows: string[] = [];
const notes: string[] = [];

for (const t of TABLES) {
  const ours: Record<string, any> = out[t] ?? {};
  const theirs: Record<string, any> = slim[t] ?? {};
  const ourNames = new Set(Object.values(ours).map((e: any) => slugOf(e.n)));
  const ourList = Object.values(ours).map((e: any) => e.n as string);
  const ourNorm = new Set(ourList.map(normStat));
  // the same entry under different wording ("Core Skill Damage" where the game's line says "Core Damage")
  const near = (n: string) => ourNorm.has(normStat(n)) || ourList.some((o) => trigramSim(n, o) >= 0.8);
  const want = Object.entries(theirs).filter(([, e]) => !e.x);
  const known = want.filter(([s, e]) => leftover(t, s, e));
  const real = want.filter(([s, e]) => !leftover(t, s, e));
  const slugged = real.filter(([s, e]) => !NAME_ONLY[t]?.(s, e));
  const bySlug = slugged.filter(([s]) => ours[s]);
  const byName = real.filter(([, e]) => ourNames.has(slugOf(e.n)));
  const missing = real.filter(([, e]) => !ourNames.has(slugOf(e.n)));
  const byNear = byName.length + missing.filter(([, e]) => near(e.n)).length;
  rows.push(
    [
      t.padEnd(10),
      `ours ${String(Object.keys(ours).length).padStart(5)}`,
      `theirs ${String(want.length).padStart(5)}`,
      `expected misses ${String(known.length).padStart(4)}`,
      `| slug ${String(bySlug.length).padStart(5)} ${pct(bySlug.length, slugged.length)}`,
      `| name ${String(byName.length).padStart(5)} ${pct(byName.length, real.length)}`,
      `| same stat, other wording ${pct(byNear, real.length)}`,
    ].join(" "),
  );
  if (missing.length) notes.push(`${t}: ${missing.length} missing, e.g. ${missing.slice(0, 5).map(([s, e]) => `${s} (${JSON.stringify(e.n)})`).join(", ")}`);
}

console.log(`game build ${input.build} | data ${dir}\n`);
console.log(rows.join("\n"));
console.log("\nreal misses:");
console.log(notes.length ? notes.join("\n") : "  none");
console.log("\nexpected misses (not in this build of the game, or Mobalytics-only):");
for (const [t, list] of Object.entries(LEFTOVERS)) {
  if (!TABLES.includes(t)) continue;
  for (const l of list) {
    const n = Object.entries(slim[t] ?? {}).filter(([s, e]: any) => !e.x && l.is(s, e)).length;
    if (n) console.log(`  ${t.padEnd(8)} ${String(n).padStart(5)}  ${l.why}`);
  }
}
console.log("\nspot checks:");
console.log("  deathgrip      ", JSON.stringify(out.uniques["deathgrip"]));
console.log("  enigma         ", JSON.stringify(out.uniques["enigma"]));
console.log("  berserk ripping", JSON.stringify(out.aspects["aspect-of-berserk-ripping"]));
console.log("  whirlwind burst", JSON.stringify(out.skills["whirlwind-bursting"]));
console.log("  cold resistance", JSON.stringify(out.stats["cold-resistance"]));
console.log("  amn            ", JSON.stringify(out.runes["amn"]));
