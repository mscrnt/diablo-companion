#!/usr/bin/env node
// check-static-coverage.mjs
//
// Verifies that every slug referenced by a Mobalytics build resolves against data/static/*.json.
//
// Usage:
//   node scripts/check-static-coverage.mjs <build.json> [--static data/static] [--variant <id>]
//
// <build.json> may be a raw document (data/builds/<slug>.json, doc_live.json shape) or a single
// variant object (data/builds/<slug>.variant-<id>.json). Exits 1 if anything is unresolved.
//
// Exported: loadStatic, collectBuildRefs, resolveRef, checkCoverage.

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const FILES = ['stats', 'aspects', 'uniques', 'skills', 'paragon', 'gems', 'runes', 'charms', 'seals', 'mercenaries', 'chaos-perks', 'soul-shards', 'warplans', 'triad'];

export async function loadStatic(dir) {
  const s = {};
  for (const f of FILES) {
    try {
      s[f] = JSON.parse(await readFile(path.join(dir, `${f}.json`), 'utf8'));
    } catch {
      s[f] = {};
    }
  }
  return s;
}

// Category ids -> lookup tables (a ref may list several candidate tables, e.g. "gems|runes").
const TABLES = {
  stat: (s) => s.stats,
  aspect: (s) => s.aspects,
  unique: (s) => s.uniques,
  skill: (s) => s.skills,
  'paragon-node': (s) => s.paragon.nodes ?? {},
  'paragon-board': (s) => s.paragon.boards ?? {},
  'paragon-glyph': (s) => s.paragon.glyphs ?? {},
  gem: (s) => s.gems,
  rune: (s) => s.runes,
  charm: (s) => s.charms,
  seal: (s) => s.seals,
  mercenary: (s) => s.mercenaries.mercenaries ?? {},
  'mercenary-skill': (s) => s.mercenaries.skills ?? {},
  'mercenary-opportunity': (s) => s.mercenaries.opportunities ?? {},
  'chaos-perk': (s) => s['chaos-perks'],
  'soul-shard': (s) => s['soul-shards'],
  'soul-shard-fragment': (s) =>
    Object.fromEntries(Object.values(s['soul-shards']).flatMap((x) => (x.fragments ?? []).map((f) => [f.slug, f]))),
  'warplan-tree': (s) => s.warplans.trees ?? {},
  'warplan-node': (s) => s.warplans.nodes ?? {},
  'triad-power': (s) => s.triad.powers ?? {},
};

const ENTITY_TYPE = { aspects: 'aspect', uniqueItems: 'unique', chaosPerks: 'chaos-perk', charms: 'charm', seals: 'seal', triadPowers: 'triad-power', gems: 'gem', runes: 'rune' };
const MOD_TYPE = { socket: 'gem|rune', gear: 'stat', implicit: 'stat', tempering: 'stat', transfigured: 'stat', kulleanTransfigured: 'aspect', charm: 'stat', seal: 'stat' };

/** Returns [{ cat, slug, where }] for one build variant. */
export function collectBuildRefs(v) {
  const refs = [];
  const add = (cat, slug, where) => slug && refs.push({ cat, slug, where });
  for (const slot of v.genericBuilder?.slots ?? []) {
    const ge = slot.gameEntity;
    if (!ge) continue;
    const w = `slot ${slot.gameSlotSlug}`;
    add(ENTITY_TYPE[ge.type] ?? `?${ge.type}`, ge.slug, w);
    const m = ge.modifiers ?? {};
    for (const k of ['gearStats', 'implicitStats', 'temperingStats', 'transfiguredStats', 'charmStats', 'sealStats'])
      for (const x of m[k] ?? []) add('stat', x?.id, `${w} ${k}`);
    for (const x of m.kulleanTransfiguredStats ?? []) add('aspect', x?.id, `${w} kulleanTransfiguredStats`);
    for (const x of (m.socketStats ?? []).filter(Boolean)) add(x.type === 'runes' ? 'rune' : 'gem', x.slug, `${w} socket`);
  }
  for (const s of v.skillTree?.skills ?? []) add('skill', s.skill?.slug, 'skillTree');
  for (const s of v.skillTree?.priorityList ?? []) add('skill', s.slug, 'skillTree.priorityList');
  const as = v.assignedSkills ?? {};
  for (const s of as.skills ?? []) add('skill', s.skill?.slug, 'assignedSkills.skills');
  for (const s of as.summons ?? []) add('skill', s.spec?.slug, 'assignedSkills.summons');
  for (const k of ['expertise', 'specialization', 'enchantments']) {
    const x = as[k];
    for (const e of Array.isArray(x) ? x : x ? [x] : []) add('skill', e?.slug, `assignedSkills.${k}`);
  }
  for (const b of as.boons ?? []) add('skill', b.value?.slug, 'assignedSkills.boons');
  for (const ss of as.soulShards ?? []) {
    add('soul-shard', ss.shard?.slug, 'assignedSkills.soulShards');
    for (const f of ss.fragments ?? []) add('soul-shard-fragment', f.slug, 'assignedSkills.soulShards.fragments');
  }
  for (const n of v.paragon?.nodes ?? []) add('paragon-node', n.slug, 'paragon.nodes');
  for (const b of v.paragon?.boards ?? []) {
    add('paragon-board', b.board?.slug, 'paragon.boards');
    add('paragon-glyph', b.glyph?.slug, 'paragon.boards.glyph');
  }
  for (const p of v.paragon?.priorityList ?? []) add('paragon-glyph|paragon-board', p.slug, 'paragon.priorityList');
  const mc = v.mercenary ?? {};
  add('mercenary', mc.primaryMercenary?.slug, 'mercenary.primary');
  add('mercenary', mc.reinforcementMercenary?.slug, 'mercenary.reinforcement');
  add('mercenary-skill', mc.skill?.slug, 'mercenary.skill');
  add('mercenary-opportunity', mc.opportunity?.opportunity?.slug, 'mercenary.opportunity');
  add('mercenary-skill', mc.opportunity?.skill?.slug, 'mercenary.opportunity.skill');
  for (const s of mc.skillTree ?? []) add('mercenary-skill', s.skill?.slug, 'mercenary.skillTree');
  for (const t of v.warPlan?.warplanTrees ?? []) {
    add('warplan-tree', t.warplanTree?.slug, 'warPlan');
    for (const n of t.warplanNodes ?? []) add('warplan-node', n.slug, 'warPlan.nodes');
  }
  for (const e of v.equipmentPriorityList ?? []) {
    add('aspect|unique', e.slug, `equipmentPriorityList ${e.type}`);
    for (const m of e.modifiers ?? []) add(MOD_TYPE[m.type] ?? `?${m.type}`, m.slug, `equipmentPriorityList ${e.type} ${m.type}`);
  }
  for (const t of v.talismansPriorityList ?? []) {
    add('charm|seal', t.slug, `talismansPriorityList ${t.type}`);
    for (const m of t.modifiers ?? []) add(MOD_TYPE[m.type] ?? `?${m.type}`, m.slug, `talismansPriorityList ${m.type}`);
  }
  return refs;
}

export function resolveRef(stat, ref) {
  for (const cat of ref.cat.split('|')) {
    const table = TABLES[cat]?.(stat);
    if (table?.[ref.slug]) return { cat, entry: table[ref.slug] };
  }
  return null;
}

export function checkCoverage(stat, variant) {
  const refs = collectBuildRefs(variant);
  const byCat = {};
  const unresolved = [];
  const seen = new Set();
  for (const r of refs) {
    const key = `${r.cat}:${r.slug}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const c = (byCat[r.cat] ??= { total: 0, resolved: 0 });
    c.total++;
    const hit = resolveRef(stat, r);
    if (hit) c.resolved++;
    else unresolved.push(r);
  }
  const total = Object.values(byCat).reduce((a, c) => a + c.total, 0);
  const resolved = Object.values(byCat).reduce((a, c) => a + c.resolved, 0);
  return { total, resolved, byCat, unresolved, refCount: refs.length };
}

async function main() {
  const argv = process.argv.slice(2);
  let file = null, staticDir = null, variantId = null;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--static') staticDir = argv[++i];
    else if (argv[i] === '--variant') variantId = argv[++i];
    else file = argv[i];
  }
  if (!file) {
    console.log('Usage: node scripts/check-static-coverage.mjs <build.json> [--static <dir>] [--variant <id>]');
    process.exit(1);
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const stat = await loadStatic(path.resolve(staticDir ?? path.join(repoRoot, 'data', 'static')));
  const json = JSON.parse(await readFile(file, 'utf8'));
  const variants = json.data?.buildVariants?.values ?? (json.genericBuilder || json.paragon ? [json] : []);
  let bad = 0;
  for (const v of variants) {
    if (variantId != null && String(v.id) !== String(variantId)) continue;
    const r = checkCoverage(stat, v);
    console.log(`variant ${v.id}: ${r.resolved}/${r.total} unique slug refs resolved (${r.refCount} refs total)`);
    for (const [cat, c] of Object.entries(r.byCat)) console.log(`  ${cat.padEnd(28)} ${c.resolved}/${c.total}`);
    if (r.unresolved.length) {
      console.log('  UNRESOLVED:');
      for (const u of r.unresolved) console.log(`    [${u.cat}] ${u.slug}   (${u.where})`);
    }
    bad += r.unresolved.length;
  }
  process.exit(bad ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => {
    console.error(e);
    process.exit(2);
  });
}
