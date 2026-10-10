// Build src/generated/hordes.json (Infernal Hordes offers + Spoils chests) from the
// datamined game strings in data/gamedata/strings. Re-run after a patch:
//   node scripts/gen-hordes.mjs
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const actors = JSON.parse(readFileSync(join(root, "data/gamedata/strings/actors.json"), "utf8"));
const clean = (s) => (s ?? "").replace(/\{\/?[^}]*\}/g, "").replace(/[ \t]+/g, " ").trim();

const offers = [];
for (const [stl, m] of Object.entries(actors)) {
  const k = stl.match(/^Actor_BSK_PylChoiceGizmo_(\w+)$/)?.[1];
  if (!k || !m.ShortenedName) continue;
  const lines = clean(m.Name).split(/\n+/).map((x) => x.trim()).filter(Boolean);
  offers.push({ key: k, title: clean(m.ShortenedName), bane: lines[0] ?? "", boon: lines.slice(1).join(" ") });
}

const chests = [];
for (const [stl, m] of Object.entries(actors)) {
  if (!/^Actor_(BSK_UniqueOpChest|Warplans_BSK_TalismanChest)/.test(stl) || /Cheap/.test(stl)) continue;
  const [name, ...rest] = clean(m.Name).split(/\n+/);
  const cost = Number(rest.join(" ").match(/requires\s+(\d+)/i)?.[1] ?? 0) || null;
  chests.push({ key: stl.replace(/^Actor_/, ""), name: name.trim(), detail: rest.join(" ").trim(), cost });
}

// Tree of Whispers caches (Grim Favors rewards)
const items = JSON.parse(readFileSync(join(root, "data/gamedata/strings/items.json"), "utf8"));
const whisperCaches = [];
for (const [stl, m] of Object.entries(items)) {
  const k = stl.match(/^Item_BountyMeta_Cache_(\w+)$/)?.[1];
  if (!k || !m.Name || /Bloodied|Event_Bonus/.test(k)) continue;
  const tier = /_Ancestral$/.test(k) ? "ancestral" : /_(Upgraded|Greater)$/.test(k) ? "greater" : "normal";
  const kind = k.replace(/_(Ancestral|Upgraded|Greater)$/, "");
  whisperCaches.push({ key: k, kind, tier, name: clean(m.Name), description: clean(m.Description) });
}

mkdirSync(join(root, "src/generated"), { recursive: true });
writeFileSync(join(root, "src/generated/hordes.json"), JSON.stringify({ offers, chests, whisperCaches }, null, 1));
console.log(`wrote ${offers.length} offers, ${chests.length} chests, ${whisperCaches.length} whisper caches`);
