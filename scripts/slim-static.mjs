// Reduce data/static/*.json (≈15 MB, all fields) to the compact lookup tables the
// app ships with: src/generated/static-slim.json. Re-run after fetch-mobalytics-static.
//   node scripts/slim-static.mjs
import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const dir = join(root, "data", "static");
const read = (f) => (existsSync(join(dir, f)) ? JSON.parse(readFileSync(join(dir, f), "utf8")) : {});
const clip = (s, n = 600) => (typeof s === "string" ? (s.length > n ? s.slice(0, n) + "…" : s) : undefined);

function map(obj, fn) {
  const out = {};
  for (const [k, v] of Object.entries(obj ?? {})) {
    if (!v || typeof v !== "object") continue;
    const r = fn(v, k);
    if (r) out[k] = Object.fromEntries(Object.entries(r).filter(([, x]) => x !== undefined && x !== null && x !== ""));
  }
  return out;
}

const stats = map(read("stats.json"), (v) => ({ n: v.displayName || v.name, k: v.kind, r: v.recipe }));
const aspects = map(read("aspects.json"), (v) => ({ n: v.name, d: clip(v.description), c: v.class, t: v.typeName, loc: v.dungeon || v.location, x: v.deprecated ? 1 : undefined }));
const uniques = map(read("uniques.json"), (v) => ({
  n: v.name,
  d: clip(v.description),
  c: v.class,
  t: v.itemTypeName,
  m: v.isMythic ? 1 : undefined,
  src: v.dropSource,
  x: v.deprecated ? 1 : undefined,
}));
const skills = map(read("skills.json"), (v) => ({ n: v.name, d: clip(v.descriptionRank1 || v.description, 400), c: v.class, t: v.type }));
const gems = map(read("gems.json"), (v) => ({ n: v.name, d: clip(v.description, 300) }));
const runes = map(read("runes.json"), (v) => ({ n: v.name, d: clip(v.description, 300), t: v.type }));
const charms = map(read("charms.json"), (v) => ({ n: v.name, d: clip(v.description, 400), c: v.class, set: v.set?.name }));
const seals = map(read("seals.json"), (v) => ({ n: v.name, d: clip(v.description, 300) }));
const chaosPerks = map(read("chaos-perks.json"), (v) => ({ n: v.name, d: clip(v.description, 300), c: v.class }));
const p = read("paragon.json");
const boards = map(p.boards, (v) => ({ n: v.name, d: clip(v.description, 300) }));
const glyphs = map(p.glyphs, (v) => ({ n: v.name, d: clip(v.description, 500), c: v.class }));
// Only the named (rare/magic/legendary) nodes are interesting to show.
const nodes = map(p.nodes, (v) =>
  /normal|gate|start/i.test(v.type ?? "") ? null : { n: v.name, d: clip(v.description, 300), t: v.type },
);
const m = read("mercenaries.json");
const mercs = map(m.mercenaries, (v) => ({ n: v.fullName || v.name }));
const mercSkills = map(m.skills, (v) => ({ n: v.name, d: clip(v.description, 300) }));
const mercOpp = map(m.opportunities, (v) => ({ n: v.name }));
const bloodied = map(read("bloodied-affixes.json"), (v) => ({ n: v.name }));

const wp = read("warplans.json");
const wpTrees = map(wp.trees, (v) => (v.deprecated ? null : { n: v.name, max: v.maxPoints }));
const wpNodes = map(wp.nodes, (v) =>
  v.deprecated ? null : { n: v.name, d: clip(v.description, 500), t: v.tree, k: v.nodeType, dep: v.depends ?? [], x: v.x, y: v.y, ic: v.iconUrl },
);

const out = {
  meta: { ...read("meta.json"), slimmedAt: new Date().toISOString() },
  stats, aspects, uniques, skills, gems, runes, charms, seals, chaosPerks,
  boards, glyphs, nodes, mercs, mercSkills, mercOpp, bloodied, wpTrees, wpNodes,
};
mkdirSync(join(root, "src", "generated"), { recursive: true });
const file = join(root, "src", "generated", "static-slim.json");
writeFileSync(file, JSON.stringify(out));
const counts = Object.fromEntries(Object.entries(out).filter(([k]) => k !== "meta").map(([k, v]) => [k, Object.keys(v).length]));
console.log(`wrote ${file} (${(JSON.stringify(out).length / 1e6).toFixed(2)} MB)`, counts);
