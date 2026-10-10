#!/usr/bin/env node
// fetch-mobalytics-static.mjs
//
// Downloads Diablo 4 static game data (stats/affixes, aspects, uniques, skills,
// paragon boards/nodes/glyphs, gems, runes, charms, seals, mercenaries, ...) from
// Mobalytics' public GraphQL API and writes normalized lookup maps
// (slug -> { name, description, iconUrl, ... }) to data/static/*.json.
//
// Node 22+, ESM, zero dependencies (uses global fetch).
//
// Usage:
//   node scripts/fetch-mobalytics-static.mjs [--out data/static] [--class necromancer] [--raw]
//
//   --out <dir>     output directory (default: <repo>/data/static)
//   --class <slug>  keep only entries for this class + class-agnostic entries
//                   (default: all classes)
//   --raw           also write the untouched GraphQL response to <out>/raw.json
//
// Source: the query below is Mobalytics' own `Diablo4NgfStaticDataQuery`, copied
// verbatim (fragments inlined) from the site bundle
// https://mobalytics.gg/diablo-4/static/js/diablo-4-app.<hash>.chunk.js
// The site calls it with every filter set to { page: { all: true } }; without
// that every list returns `data: null`. Introspection is disabled server-side,
// so these field selections are the only known-good ones. A copy lives in
// scripts/mobalytics-static-query.graphql.
//
// The core logic is exported (fetchStaticData, normalizeStaticData,
// writeStaticData) so it can be imported / ported.

import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ENDPOINT = 'https://mobalytics.gg/api/diablo4/v1/graphql/query';
export const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

export const STATIC_DATA_META_QUERY = `query Diablo4NgfStaticDataMetaQuery {
  game: diablo4 {
    staticData: staticDataV2 {
      meta: d4Skills {
        version
      }
    }
  }
}`;

export const STATIC_DATA_QUERY = `query Diablo4NgfStaticDataQuery(
$skillsFilter: D4SkillsFilter
$aspectsFilter: D4AspectsFilter
$uniqueItemsFilter: D4UniqueItemsFilter
$runesFilter: D4RunesFilter
$gemsFilter: D4GemsFilter
$witchcraftPowersFilter: D4WitchcraftPowersFilter
$bossPowersFilter: D4BossPowersFilter
$paragonBoardFilter: D4ParagonBoardsFilter
$paragonGlyphFilter: D4ParagonGlyphsFilter
$paragonNodesFilter: D4ParagonNodesFilter
$classesFilter: D4ClassesFilter
$skillSectionsFilter: D4SkillSectionsFilter
$skillTreeConnectorsFilter: D4ConnectorsFilter
$buildSlotsFilter: D4BuildSlotsFilter
$statsFilter: D4StatsFilter
$statImplicitFilter: D4StatImplicitFilter
$statTemperingFilter: D4StatTemperingFilter
$transfiguredStatsFilter: D4TransfiguredStatsFilter
$mercenariesFilter: D4MercenariesFilter
$mercenarySkillsFilter: D4MercenarySkillsFilter
$reinforcementMercenaryOpportunitiesFilter: D4OpportunitiesFilter
$chaosPerksFilter: D4ChaosPerksFilter
$bloodiedAffixesFilter: D4BloodiedAffixesFilter
$divineGiftsFilter: D4DivineGiftsFilter
$elixirsFilter: D4ElixirsFilter
$soulShardsFilter: D4SoulShardsFilter
$charmsFilter: D4CharmsFilter
$sealsFilter: D4SealsFilter
$warplanTreesFilter: D4WarplanTreesFilter
$warplanNodesFilter: D4WarplanNodesFilter
$triadSplintersFilter: D4TriadSplintersFilter
$triadPowersFilter: D4TriadPowersFilter
  ) {
game: diablo4 {
  staticData: staticDataV2 {
    d4Skills(filter: $skillsFilter) {
      data {
        ...D4SkillTreeSkillFragment
      }
    }
    d4Aspects(filter: $aspectsFilter) {
      data {
        ...D4AspectFragment
      }
    }
    d4UniqueItems(filter: $uniqueItemsFilter) {
      data {
        ...D4UniqItemFragment
      }
    }
    d4Runes(filter: $runesFilter) {
      data {
        ...D4RuneFragment
      }
    }
    d4Gems(filter: $gemsFilter) {
      data {
        ...D4GemFragment
      }
    }
    d4WitchcraftPowers(filter: $witchcraftPowersFilter) {
      data {
        ...D4WitchcraftPowerFragment
      }
    }
    d4BossPowers(filter: $bossPowersFilter) {
      data {
        ...D4BossPowerFragment
      }
    }
    d4ParagonBoards(filter: $paragonBoardFilter) {
      data {
        ...D4ParagonBoardFragment
      }
    }
    d4ParagonGlyphs(filter: $paragonGlyphFilter) {
      data {
        ...D4ParagonBoardGlyphFragment
      }
    }
    d4ParagonNodes(filter: $paragonNodesFilter) {
      data {
        ...D4ParagonBoardNodeFragment
      }
    }
    d4Classes(filter: $classesFilter) {
      data {
        ...D4ClassFragment
      }
    }
    d4SkillSections(filter: $skillSectionsFilter) {
      data {
        ...D4SkillSectionFragment
      }
    }
    d4Connectors(filter: $skillTreeConnectorsFilter) {
      data {
        ...D4SkillTreeConnectorFragment
      }
    }
    d4BuildSlots(filter: $buildSlotsFilter) {
      data {
        ...D4BuildSlotFragment
      }
    }
    d4Stats(filter: $statsFilter) {
      data {
        ...D4StatFragment
      }
    }
    d4StatImplicit(filter: $statImplicitFilter) {
      data {
        ...D4StatImplicitFragment
      }
    }
    d4StatTempering(filter: $statTemperingFilter) {
      data {
        ...D4StatTemperingFragment
      }
    }
    d4TransfiguredStats(filter: $transfiguredStatsFilter) {
      data {
        ...D4TransfiguredStatFragment
      }
    }
    d4Mercenaries(filter: $mercenariesFilter) {
      data {
        ...D4MercenaryFragment
      }
    }
    d4MercenarySkills(filter: $mercenarySkillsFilter) {
      data {
        ...D4MercenarySkillFragment
      }
    }
    reinforcementMercenaryOpportunities: d4Opportunities(filter: $reinforcementMercenaryOpportunitiesFilter) {
      data {
        ...D4MercenaryOpportunityFragment
      }
    }
    d4ChaosPerks(filter: $chaosPerksFilter) {
      data {
        ...D4ChaosPerkFragment
      }
    }
    d4BloodiedAffixes(filter: $bloodiedAffixesFilter) {
      data {
        ...D4BloodiedAffixFragment
      }
    }
    d4DivineGifts(filter: $divineGiftsFilter) {
      data {
        ...D4DivineGiftsFragment
      }
    }
    d4Elixirs(filter: $elixirsFilter) {
      data {
        ...D4ElixirsAndIncensesFragment
      }
    }
    d4SoulShards(filter: $soulShardsFilter) {
      data {
        ...D4SoulShardFragment
      }
    }
    d4Charms(filter: $charmsFilter) {
      data {
        ...D4CharmFragment
      }
    }
    d4Seals(filter: $sealsFilter) {
      data {
        ...D4SealFragment
      }
    }
    d4WarplanTrees(filter: $warplanTreesFilter) {
      data {
        ...D4WarplanTreeFragment
      }
    }
    d4WarplanNodes(filter: $warplanNodesFilter) {
      data {
        ...D4WarplanNodeFragment
      }
    }
    d4TriadSplinters(filter: $triadSplintersFilter) {
      data {
        ...D4TriadSplintersFragment
      }
    }
    d4TriadPowers(filter: $triadPowersFilter) {
      data {
        ...D4TriadPowersFragment
      }
    }
    meta: d4Skills {
      version
    }
  }
}
  }

fragment D4SkillTreeSkillFragment on D4Skill {
__typename
id
slug
classSlug
class {
  name
}
name
description
enchantment
maxRank
requiredRank
iconUrl
deprecated
weaponArsenalSlots {
  id
  name
  iconUrl
}
x
y
section {
  id
  name
}
disables {
  id
  type {
    id
    name
  }
}
dependsOnSlugs: dependsOnV2Slugs
type: typeV2 {
  id
  slug
  name
}
tags {
  name
}
resources {
  value
  name
}
substitutions {
  key
  values
}
  }

fragment D4AspectFragment on D4Aspect {
__typename
slug
id
name
iconUrl
description
type {
  id
  name
}
dungeon {
  id
  name
}
location {
  id
  name
}
class {
  id
  name
  iconUrl
}
deprecated
  }

fragment D4UniqItemFragment on D4UniqueItem {
__typename
id
slug
name
iconUrl
description
type {
  id
  name
}
class {
  id
  name
}
effect
mainStats
secondaryStats
secondaryStatsSlugs
deprecated
chaos
mythic
dropSource
  }

fragment D4RuneFragment on D4Rune {
__typename
id
slug
name
iconUrl
deprecated

rarity
type

gain
bonus
requires
cooldown
overflow
  }

fragment D4GemFragment on D4Gem {
__typename
id
slug
name
iconUrl
description
occult
bonuses {
  description
  slotSlug
  slot {
    id
    name
  }
}
deprecated
  }

fragment D4WitchcraftPowerFragment on D4WitchcraftPower {
__typename
id
slug
name
description
iconUrl
unique
type
deprecated
  }

fragment D4BossPowerFragment on D4BossPower {
__typename
id
name
slug
iconUrl
location
main
modifier
type
deprecated
  }

fragment D4ParagonBoardFragment on D4ParagonBoard {
__typename
id
slug
name
description
deprecated
iconUrl
classes {
  id
  name
}
nodes {
  id
  name
  x
  y
  iconUrlNormal
  iconUrlActive
  effects
  requiredStats {
    value
    step
    type {
      name
    }
  }
  bonusAmount
  requires
  type {
    id
    name
  }
  nodeStats {
    value
    type {
      name
    }
  }
}
  }

fragment D4ParagonBoardGlyphFragment on D4ParagonGlyph {
__typename
id
slug
name
iconUrl
deprecated
level: maxLevel
radius: maxRadius
affectedType {
  id
}
scaling
rarity {
  id
  name
}
bonus
additionalBonus
value
legendaryValue
legendaryBonus
requirementsStats {
  value
  type {
    id
    name
  }
}
radiusDistribution {
  radius
  level
}
class {
  id
  name
}
  }

fragment D4ParagonBoardNodeFragment on D4ParagonNode {
__typename
id
slug
name
type {
  id
  name
}
iconUrlNormal
effects
requiredStats {
  value
  step
  type {
    id
    name
  }
}
bonusAmount
nodeStats {
  value
  type {
    id
    name
  }
}
deprecated
  }

fragment D4ClassFragment on D4Class {
__typename
id
slug
name
dex
int
will
str
deprecated
  }

fragment D4SkillSectionFragment on D4SkillSection {
__typename
id
slug
name
iconUrl
classSlug
requiredRank
deprecated
index
x
y
skills {
  ...D4SkillTreeSkillFragment
}
class {
  id
  slug
  name
  dex
  str
  will
  int
}
  }

fragment D4SkillTreeConnectorFragment on D4Connector {
__typename
id
x
y
name
iconUrl
classSlug
deprecated
dependsOnSlugs
section {
  id
  name
}
  }

fragment D4BuildSlotFragment on D4BuildSlot {
__typename
id
name
slug
aspectBonuses
deprecated
  }

fragment D4StatFragment on D4Stat {
__typename
id
name
slug
buildSlotsSlugs
classesSlugs
isUniqueItemStat
deprecated
  }

fragment D4StatImplicitFragment on D4StatImplicit {
__typename
id
name
slug
buildSlotsSlugs
classesSlugs
isUniqueItemStat
deprecated
  }

fragment D4StatTemperingFragment on D4StatTempering {
__typename
id
name
slug
description
buildSlotsSlugs
classesSlugs
isUniqueItemStat
deprecated
  }

fragment D4TransfiguredStatFragment on D4TransfiguredStat {
__typename
id
name
slug
description
buildSlotsSlugs
classesSlugs
isUniqueItemStat
deprecated
  }

fragment D4MercenaryFragment on D4Mercenary {
__typename
id
slug
iconUrl
name
title
deprecated
  }

fragment D4MercenarySkillFragment on D4MercenarySkill {
__typename
id
slug
nodeTypeSlug
iconUrl
outs
depends
description
attackDescription
resources {
  slug
  name
  value
}
mercenarySlug
mercenary {
  ...D4MercenaryFragment
}
name
tags
x
y
deprecated
  }

fragment D4MercenaryOpportunityFragment on D4Opportunity {
__typename
id
slug
iconUrl
name
deprecated
  }

fragment D4ChaosPerkFragment on D4ChaosPerk {
__typename
id
slug
name
class
description
iconUrl
rarity
deprecated
filters
  }

fragment D4BloodiedAffixFragment on D4BloodiedAffix {
__typename
id
slug
name
all
deprecated
  }

fragment D4DivineGiftsFragment on D4DivineGift {
__typename
id
slug
name
rarity
boss
rewards
purified
corrupted
location
deprecated
imageUrl
  }

fragment D4ElixirsAndIncensesFragment on D4Elixir {
__typename
id
slug
name
type
iconUrl
rarity
description
deprecated
  }

fragment D4SoulShardFragment on D4SoulShard {
__typename
id
slug
name
iconUrl
deprecated
description
classSlug
season
fragments {
  id
  slug
  name
  iconUrl
}
  }

fragment D4CharmFragment on D4Charm {
__typename
id
slug
name
iconUrl
deprecated
class {
  id
  name
}
rarity
set {
  id
  name
  bonuses {
    count
    value
  }
}
effects
  }

fragment D4SealFragment on D4Seal {
__typename
id
slug
name
iconUrl
deprecated
description
effect
rarity
  }

fragment D4WarplanTreeFragment on D4WarplanTree {
__typename
id
slug
iconUrl
name
maxPoints
deprecated
  }

fragment D4WarplanNodeFragment on D4WarplanNode {
__typename
id
slug
iconUrl
name
description
nodeTypeSlug
treeSlug
x
y
depends
disables
outs
deprecated
  }

fragment D4TriadSplintersFragment on D4TriadSplinter {
__typename
slug
id
name
iconUrl
description
deprecated
effect
requirement
  }

fragment D4TriadPowersFragment on D4TriadPower {
__typename
slug
id
name
iconUrl
description
deprecated
splinterSlug
type
unlock
  }`;

/** Every `$xxxFilter` variable declared by STATIC_DATA_QUERY, set to "all pages". */
export function allFilterVariables(query = STATIC_DATA_QUERY) {
  const vars = {};
  for (const m of query.matchAll(/\$([A-Za-z0-9_]+Filter)\s*:/g)) vars[m[1]] = { page: { all: true } };
  return vars;
}

export async function graphqlRequest(query, variables = {}, { operationName, fetchImpl = fetch } = {}) {
  const res = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'User-Agent': USER_AGENT,
      Origin: 'https://mobalytics.gg',
      Referer: 'https://mobalytics.gg/diablo-4',
    },
    body: JSON.stringify({ operationName, query, variables }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`GraphQL HTTP ${res.status}: ${text.slice(0, 300)}`);
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    throw new Error(`GraphQL returned non-JSON: ${text.slice(0, 300)}`);
  }
  if (json.errors?.length && !json.data) {
    throw new Error(`GraphQL errors: ${JSON.stringify(json.errors).slice(0, 1000)}`);
  }
  return json;
}

/** Returns { version, staticData, errors } where staticData is game.staticData of the response. */
export async function fetchStaticData(opts = {}) {
  const json = await graphqlRequest(STATIC_DATA_QUERY, allFilterVariables(), {
    operationName: 'Diablo4NgfStaticDataQuery',
    ...opts,
  });
  const staticData = json.data?.game?.staticData;
  if (!staticData) throw new Error('Response has no data.game.staticData');
  let version = staticData.meta?.version ?? null;
  if (!version) {
    try {
      const m = await graphqlRequest(STATIC_DATA_META_QUERY, {}, opts);
      version = m.data?.game?.staticData?.meta?.version ?? null;
    } catch {
      /* optional */
    }
  }
  return { version, staticData, errors: json.errors ?? [] };
}

// ---------------------------------------------------------------------------
// Normalization helpers
// ---------------------------------------------------------------------------

const list = (sd, key) => sd?.[key]?.data ?? [];
const nonEmpty = (v) => (v === '' || v === undefined ? null : v);
const joinLines = (arr) => (Array.isArray(arr) && arr.length ? arr.filter(Boolean).join('\n') : null);
const idOf = (o) => o?.id ?? o?.slug ?? null;

function bySlug(arr, fn) {
  const out = {};
  for (const item of arr) {
    const slug = item.slug ?? item.id;
    if (!slug) continue;
    const rec = fn(item);
    // Prefer non-deprecated records if a slug ever appears twice.
    if (out[slug] && !out[slug].deprecated && rec.deprecated) continue;
    out[slug] = rec;
  }
  return out;
}

/** Replace {value1}.. placeholders with the rank-1 (index 0) substitution value. */
function resolvePlaceholders(text, substitutions, rankIndex = 0) {
  if (!text || !substitutions?.length) return text ?? null;
  const map = Object.fromEntries(substitutions.map((s) => [s.key, s.values?.[rankIndex] ?? s.values?.[0]]));
  return text.replace(/\{(\w+)\}/g, (m, k) => (map[k] !== undefined && map[k] !== null ? String(map[k]) : m));
}

function normSkill(s) {
  const substitutions = s.substitutions?.length
    ? Object.fromEntries(s.substitutions.map((x) => [x.key, x.values]))
    : null;
  return {
    name: s.name,
    description: nonEmpty(s.description),
    descriptionRank1: resolvePlaceholders(nonEmpty(s.description), s.substitutions, 0),
    iconUrl: nonEmpty(s.iconUrl),
    class: s.classSlug ?? null,
    className: s.class?.name ?? null,
    type: s.type?.slug ?? s.type?.id ?? null, // basic | enhancement | upgrade | passive | key-passive ...
    typeName: s.type?.name ?? null,
    section: s.section?.id ?? null,
    sectionName: s.section?.name ?? null,
    tags: (s.tags ?? []).map((t) => t.name),
    maxRank: s.maxRank ?? null,
    requiredRank: s.requiredRank ?? null,
    enchantment: nonEmpty(s.enchantment),
    resources: s.resources?.length ? Object.fromEntries(s.resources.map((r) => [r.name, r.value])) : null,
    substitutions,
    weaponArsenalSlots: s.weaponArsenalSlots?.map((w) => w.id) ?? null,
    dependsOn: s.dependsOnSlugs ?? null,
    disables: s.disables?.map((d) => d.id) ?? null,
    x: s.x ?? null,
    y: s.y ?? null,
    deprecated: !!s.deprecated,
  };
}

function statRecord(s, kind) {
  const rec = {
    name: s.name,
    description: nonEmpty(s.description) ?? null,
    kind,
    kinds: [kind],
    buildSlots: s.buildSlotsSlugs ?? [],
    classes: s.classesSlugs ?? [],
    isUniqueItemStat: !!s.isUniqueItemStat,
    deprecated: !!s.deprecated,
  };
  if (kind === 'tempering' && rec.description) {
    // "Offensive: Summon Damage" -> category "Offensive", affix "Summon Damage"; name is the recipe.
    const m = rec.description.match(/^([^:]+):\s*(.+)$/s);
    rec.recipe = s.name;
    if (m) {
      rec.category = m[1].trim();
      rec.affix = m[2].trim();
    } else rec.affix = rec.description;
    rec.displayName = rec.affix;
  } else {
    rec.displayName = s.name;
  }
  return rec;
}

export function normalizeStaticData(sd, { classSlug = null } = {}) {
  const keepClass = (cls) => !classSlug || cls == null || cls === '' || cls === classSlug;
  const keepClasses = (arr) => !classSlug || !arr?.length || arr.includes(classSlug);
  const filt = (obj, pred) => Object.fromEntries(Object.entries(obj).filter(([, v]) => pred(v)));

  // --- stats (gear affixes, implicits, tempering, transfigured) ------------
  const stats = {};
  const statSources = [
    ['d4Stats', 'gear'],
    ['d4StatImplicit', 'implicit'],
    ['d4StatTempering', 'tempering'],
    ['d4TransfiguredStats', 'transfigured'],
  ];
  for (const [key, kind] of statSources) {
    for (const s of list(sd, key)) {
      const rec = statRecord(s, kind);
      const prev = stats[s.slug];
      if (!prev) {
        stats[s.slug] = rec;
        continue;
      }
      prev.kinds.push(kind);
      if (prev.name !== rec.name || prev.description !== rec.description) {
        (prev.byKind ??= {})[kind] = { name: rec.name, description: rec.description, displayName: rec.displayName };
      }
      prev.buildSlots = [...new Set([...prev.buildSlots, ...rec.buildSlots])];
      prev.classes = [...new Set([...prev.classes, ...rec.classes])];
      if (prev.deprecated && !rec.deprecated) prev.deprecated = false;
    }
  }

  // --- aspects ---------------------------------------------------------------
  const aspects = bySlug(list(sd, 'd4Aspects'), (a) => ({
    name: a.name,
    description: nonEmpty(a.description),
    iconUrl: nonEmpty(a.iconUrl),
    type: a.type?.id ?? null, // offensive | defensive | utility | resource | mobility
    typeName: a.type?.name ?? null,
    class: idOf(a.class),
    className: a.class?.name ?? null,
    dungeon: a.dungeon?.name ?? null,
    location: a.location?.name ?? null,
    deprecated: !!a.deprecated,
  }));

  // --- unique items -----------------------------------------------------------
  const uniques = bySlug(list(sd, 'd4UniqueItems'), (u) => ({
    name: u.name,
    description: nonEmpty(u.effect), // the unique power text
    flavorText: nonEmpty(u.description),
    iconUrl: nonEmpty(u.iconUrl),
    itemType: u.type?.id ?? null,
    itemTypeName: u.type?.name ?? null,
    class: idOf(u.class),
    className: u.class?.name ?? null,
    mainStats: u.mainStats ?? [],
    secondaryStats: u.secondaryStats ?? [],
    secondaryStatsSlugs: u.secondaryStatsSlugs ?? [],
    isMythic: !!u.mythic,
    isChaos: !!u.chaos,
    dropSource: nonEmpty(u.dropSource),
    deprecated: !!u.deprecated,
  }));

  // --- skills + tree layout ---------------------------------------------------
  const skills = bySlug(list(sd, 'd4Skills'), normSkill);
  const skillTree = {
    sections: bySlug(list(sd, 'd4SkillSections'), (s) => ({
      name: s.name,
      class: s.classSlug ?? s.class?.slug ?? null,
      index: s.index ?? null,
      requiredRank: s.requiredRank ?? null,
      iconUrl: nonEmpty(s.iconUrl),
      x: s.x ?? null,
      y: s.y ?? null,
      skills: (s.skills ?? []).map((k) => k.slug),
      deprecated: !!s.deprecated,
    })),
    connectors: bySlug(list(sd, 'd4Connectors'), (c) => ({
      name: c.name,
      class: c.classSlug ?? null,
      section: c.section?.id ?? null,
      dependsOn: c.dependsOnSlugs ?? null,
      iconUrl: nonEmpty(c.iconUrl),
      x: c.x ?? null,
      y: c.y ?? null,
      deprecated: !!c.deprecated,
    })),
  };

  // --- paragon -----------------------------------------------------------------
  const nodes = {};
  const boards = bySlug(list(sd, 'd4ParagonBoards'), (b) => {
    for (const n of b.nodes ?? []) {
      nodes[n.id] = {
        name: n.name,
        description: joinLines(n.effects),
        iconUrl: nonEmpty(n.iconUrlNormal),
        iconUrlActive: nonEmpty(n.iconUrlActive),
        type: n.type?.id ?? null, // normal-node | magic-node | rare-node | legendary-node | glyph-socket | gate-node ...
        typeName: n.type?.name ?? null,
        board: b.slug,
        x: n.x ?? null,
        y: n.y ?? null,
        effects: n.effects ?? [],
        bonusAmount: n.bonusAmount ?? null,
        requiredStats:
          n.requiredStats?.map((r) => ({ stat: r.type?.name ?? null, value: r.value, step: r.step })) ?? null,
        nodeStats: n.nodeStats?.map((r) => ({ stat: r.type?.name ?? null, value: r.value })) ?? null,
        requires: n.requires?.length ? n.requires : null,
        deprecated: !!b.deprecated,
      };
    }
    return {
      name: b.name,
      description: nonEmpty(b.description),
      iconUrl: nonEmpty(b.iconUrl),
      classes: (b.classes ?? []).map((c) => c.id),
      nodes: (b.nodes ?? []).map((n) => n.id),
      deprecated: !!b.deprecated,
    };
  });
  // d4ParagonNodes carries the same nodes (no x/y) plus stat type ids; merge in anything missing.
  for (const n of list(sd, 'd4ParagonNodes')) {
    const slug = n.slug ?? n.id;
    const prev = nodes[slug];
    const fromList = {
      name: n.name,
      description: joinLines(n.effects),
      iconUrl: nonEmpty(n.iconUrlNormal),
      type: n.type?.id ?? null,
      typeName: n.type?.name ?? null,
      effects: n.effects ?? [],
      bonusAmount: n.bonusAmount ?? null,
      requiredStats:
        n.requiredStats?.map((r) => ({ stat: r.type?.name ?? null, statId: r.type?.id ?? null, value: r.value, step: r.step })) ??
        null,
      nodeStats: n.nodeStats?.map((r) => ({ stat: r.type?.name ?? null, statId: r.type?.id ?? null, value: r.value })) ?? null,
      deprecated: !!n.deprecated,
    };
    if (!prev) {
      const m = slug.match(/^(.*)-x(\d+)-y(\d+)$/);
      nodes[slug] = { ...fromList, board: m?.[1] ?? null, x: m ? +m[2] : null, y: m ? +m[3] : null };
    } else {
      // keep board-derived x/y/board/iconUrlActive, take stat ids from the node list
      prev.requiredStats = fromList.requiredStats ?? prev.requiredStats;
      prev.nodeStats = fromList.nodeStats ?? prev.nodeStats;
      prev.deprecated = prev.deprecated && fromList.deprecated;
    }
  }
  const glyphs = bySlug(list(sd, 'd4ParagonGlyphs'), (g) => {
    const fill = (arr) =>
      joinLines(
        (arr ?? []).map((t) =>
          t.replace(/\{value\}/g, g.value ?? '{value}').replace(/\{legendaryValue\}/g, g.legendaryValue ?? '{legendaryValue}'),
        ),
      );
    return {
      name: g.name,
      description: [fill(g.bonus), fill(g.additionalBonus), fill(g.legendaryBonus)].filter(Boolean).join('\n') || null,
      iconUrl: nonEmpty(g.iconUrl),
      class: idOf(g.class),
      className: g.class?.name ?? null,
      rarity: g.rarity?.id ?? null,
      rarityName: g.rarity?.name ?? null,
      bonus: g.bonus ?? [],
      additionalBonus: g.additionalBonus ?? [],
      legendaryBonus: g.legendaryBonus ?? [],
      value: g.value ?? null,
      legendaryValue: g.legendaryValue ?? null,
      scaling: g.scaling ?? null,
      maxLevel: g.level ?? null,
      maxRadius: g.radius ?? null,
      affectedNodeType: g.affectedType?.id ?? null,
      requirements: g.requirementsStats?.map((r) => ({ stat: r.type?.id ?? null, statName: r.type?.name ?? null, value: r.value })) ?? [],
      radiusDistribution: g.radiusDistribution ?? null,
      deprecated: !!g.deprecated,
    };
  });

  // --- gems / runes ------------------------------------------------------------
  const gems = bySlug(list(sd, 'd4Gems'), (g) => {
    const bonuses = {};
    for (const b of g.bonuses ?? []) bonuses[b.slotSlug ?? b.slot?.id] = b.description;
    return {
      name: g.name,
      description:
        nonEmpty(g.description) ??
        (Object.entries(bonuses)
          .map(([slot, d]) => `${slot[0].toUpperCase()}${slot.slice(1)}: ${d}`)
          .join('\n') || null),
      iconUrl: nonEmpty(g.iconUrl),
      occult: !!g.occult,
      bonuses,
      deprecated: !!g.deprecated,
    };
  });
  const runes = bySlug(list(sd, 'd4Runes'), (r) => {
    let description = nonEmpty(r.bonus);
    if (r.type === 'Ritual' && r.gain) description = `${r.bonus} Gain ${r.gain} Offering.`;
    if (r.type === 'Invocation' && r.requires) description = `Requires ${r.requires} Offering: ${r.bonus}`;
    return {
      name: r.name,
      description,
      iconUrl: nonEmpty(r.iconUrl),
      type: r.type ?? null, // Ritual | Invocation
      rarity: r.rarity ?? null,
      gain: r.gain ?? null,
      bonus: nonEmpty(r.bonus),
      requires: nonEmpty(r.requires),
      cooldown: r.cooldown ?? null,
      overflow: nonEmpty(r.overflow),
      deprecated: !!r.deprecated,
    };
  });

  // --- charms / seals ------------------------------------------------------------
  const charms = bySlug(list(sd, 'd4Charms'), (c) => ({
    name: c.name,
    description:
      joinLines(c.effects) ??
      (c.set ? c.set.bonuses?.map((b) => `(${b.count}) ${b.value}`).join('\n') ?? null : null),
    iconUrl: nonEmpty(c.iconUrl),
    class: idOf(c.class),
    className: c.class?.name ?? null,
    rarity: c.rarity ?? null,
    effects: c.effects ?? [],
    set: c.set ? { slug: c.set.id, name: c.set.name, bonuses: c.set.bonuses ?? [] } : null,
    deprecated: !!c.deprecated,
  }));
  const seals = bySlug(list(sd, 'd4Seals'), (s) => ({
    name: s.name,
    description: nonEmpty(s.description) ?? nonEmpty(s.effect),
    effect: nonEmpty(s.effect),
    iconUrl: nonEmpty(s.iconUrl),
    rarity: s.rarity ?? null,
    deprecated: !!s.deprecated,
  }));

  // --- mercenaries ------------------------------------------------------------
  const mercenaries = {
    mercenaries: bySlug(list(sd, 'd4Mercenaries'), (m) => ({
      name: m.name,
      title: nonEmpty(m.title),
      fullName: m.title ? `${m.name}, ${m.title}` : m.name,
      iconUrl: nonEmpty(m.iconUrl),
      deprecated: !!m.deprecated,
    })),
    skills: bySlug(list(sd, 'd4MercenarySkills'), (s) => ({
      name: s.name,
      description: nonEmpty(s.description),
      attackDescription: nonEmpty(s.attackDescription),
      iconUrl: nonEmpty(s.iconUrl),
      mercenary: s.mercenarySlug ?? s.mercenary?.slug ?? null,
      nodeType: s.nodeTypeSlug ?? null,
      tags: s.tags ?? [],
      resources: s.resources?.length ? Object.fromEntries(s.resources.map((r) => [r.name, r.value])) : null,
      depends: s.depends ?? null,
      outs: s.outs ?? null,
      x: s.x ?? null,
      y: s.y ?? null,
      deprecated: !!s.deprecated,
    })),
    opportunities: bySlug(list(sd, 'reinforcementMercenaryOpportunities'), (o) => ({
      name: o.name,
      iconUrl: nonEmpty(o.iconUrl),
      deprecated: !!o.deprecated,
    })),
  };

  // --- misc / seasonal ------------------------------------------------------------
  const chaosPerks = bySlug(list(sd, 'd4ChaosPerks'), (p) => ({
    name: p.name,
    description: Array.isArray(p.description) ? joinLines(p.description) : nonEmpty(p.description),
    iconUrl: nonEmpty(p.iconUrl),
    class: p.class ?? null,
    rarity: p.rarity ?? null,
    filters: p.filters ?? [],
    deprecated: !!p.deprecated,
  }));
  const soulShards = bySlug(list(sd, 'd4SoulShards'), (s) => ({
    name: s.name,
    description: Array.isArray(s.description) ? joinLines(s.description) : nonEmpty(s.description),
    iconUrl: nonEmpty(s.iconUrl),
    class: s.classSlug ?? null,
    season: nonEmpty(s.season),
    fragments: (s.fragments ?? []).map((f) => ({ slug: f.slug, name: f.name, iconUrl: nonEmpty(f.iconUrl) })),
    deprecated: !!s.deprecated,
  }));
  const elixirs = bySlug(list(sd, 'd4Elixirs'), (e) => ({
    name: e.name,
    description: Array.isArray(e.description) ? joinLines(e.description) : nonEmpty(e.description),
    iconUrl: nonEmpty(e.iconUrl),
    type: e.type ?? null,
    rarity: e.rarity ?? null,
    deprecated: !!e.deprecated,
  }));
  const witchcraftPowers = bySlug(list(sd, 'd4WitchcraftPowers'), (w) => ({
    name: w.name,
    description: nonEmpty(w.description),
    iconUrl: nonEmpty(w.iconUrl),
    type: w.type ?? null,
    unique: !!w.unique,
    deprecated: !!w.deprecated,
  }));
  const bossPowers = bySlug(list(sd, 'd4BossPowers'), (b) => ({
    name: b.name,
    description: [nonEmpty(b.main), b.modifier ? `Modifier: ${b.modifier}` : null].filter(Boolean).join('\n') || null,
    main: nonEmpty(b.main),
    modifier: nonEmpty(b.modifier),
    iconUrl: nonEmpty(b.iconUrl),
    type: b.type ?? null,
    location: nonEmpty(b.location),
    deprecated: !!b.deprecated,
  }));
  const divineGifts = bySlug(list(sd, 'd4DivineGifts'), (g) => ({
    name: g.name,
    description: [g.purified ? `Purified: ${g.purified}` : null, g.corrupted ? `Corrupted: ${g.corrupted}` : null]
      .filter(Boolean)
      .join('\n') || null,
    iconUrl: nonEmpty(g.imageUrl),
    rarity: g.rarity ?? null,
    boss: g.boss ?? null,
    rewards: nonEmpty(g.rewards),
    purified: nonEmpty(g.purified),
    corrupted: nonEmpty(g.corrupted),
    location: nonEmpty(g.location),
    deprecated: !!g.deprecated,
  }));
  const bloodiedAffixes = bySlug(list(sd, 'd4BloodiedAffixes'), (b) => ({
    name: b.name,
    affixes: b.all ?? [],
    deprecated: !!b.deprecated,
  }));
  const warplans = {
    trees: bySlug(list(sd, 'd4WarplanTrees'), (t) => ({
      name: t.name,
      iconUrl: nonEmpty(t.iconUrl),
      maxPoints: t.maxPoints ?? null,
      deprecated: !!t.deprecated,
    })),
    nodes: bySlug(list(sd, 'd4WarplanNodes'), (n) => ({
      name: n.name,
      description: nonEmpty(n.description),
      iconUrl: nonEmpty(n.iconUrl),
      tree: n.treeSlug ?? null,
      nodeType: n.nodeTypeSlug ?? null,
      depends: n.depends ?? null,
      disables: n.disables ?? null,
      outs: n.outs ?? null,
      x: n.x ?? null,
      y: n.y ?? null,
      deprecated: !!n.deprecated,
    })),
  };
  const triad = {
    splinters: bySlug(list(sd, 'd4TriadSplinters'), (s) => ({
      name: s.name,
      description: nonEmpty(s.effect) ?? nonEmpty(s.description),
      flavorText: nonEmpty(s.description),
      requirement: nonEmpty(s.requirement),
      iconUrl: nonEmpty(s.iconUrl),
      deprecated: !!s.deprecated,
    })),
    powers: bySlug(list(sd, 'd4TriadPowers'), (p) => ({
      name: p.name,
      description: nonEmpty(p.description),
      iconUrl: nonEmpty(p.iconUrl),
      splinter: p.splinterSlug ?? null,
      type: p.type ?? null,
      unlock: nonEmpty(p.unlock),
      deprecated: !!p.deprecated,
    })),
  };
  const classes = bySlug(list(sd, 'd4Classes'), (c) => ({
    name: c.name,
    statWeights: { str: c.str, int: c.int, will: c.will, dex: c.dex },
    deprecated: !!c.deprecated,
  }));
  const buildSlots = bySlug(list(sd, 'd4BuildSlots'), (b) => ({
    name: b.name,
    aspectBonuses: b.aspectBonuses ?? [],
    deprecated: !!b.deprecated,
  }));

  let out = {
    stats,
    aspects,
    uniques,
    skills,
    'skill-tree': skillTree,
    paragon: { boards, glyphs, nodes },
    gems,
    runes,
    charms,
    seals,
    mercenaries,
    'chaos-perks': chaosPerks,
    'soul-shards': soulShards,
    elixirs,
    'witchcraft-powers': witchcraftPowers,
    'boss-powers': bossPowers,
    'divine-gifts': divineGifts,
    'bloodied-affixes': bloodiedAffixes,
    warplans,
    triad,
    classes,
    'build-slots': buildSlots,
  };

  if (classSlug) {
    out = {
      ...out,
      stats: filt(stats, (v) => keepClasses(v.classes)),
      aspects: filt(aspects, (v) => keepClass(v.class)),
      uniques: filt(uniques, (v) => keepClass(v.class)),
      skills: filt(skills, (v) => keepClass(v.class)),
      'skill-tree': {
        sections: filt(skillTree.sections, (v) => keepClass(v.class)),
        connectors: filt(skillTree.connectors, (v) => keepClass(v.class)),
      },
      paragon: (() => {
        const b = filt(boards, (v) => keepClasses(v.classes));
        return {
          boards: b,
          glyphs: filt(glyphs, (v) => keepClass(v.class)),
          nodes: filt(nodes, (v) => !v.board || !boards[v.board] || b[v.board]),
        };
      })(),
      charms: filt(charms, (v) => keepClass(v.class)),
      'soul-shards': filt(soulShards, (v) => keepClass(v.class)),
      'chaos-perks': filt(chaosPerks, (v) => keepClass(v.class)),
    };
  }
  return out;
}

/** Maps Mobalytics build `gameEntity.type` values to the output file holding them. */
export const ENTITY_TYPE_TO_FILE = {
  aspects: 'aspects',
  uniqueItems: 'uniques',
  chaosPerks: 'chaos-perks',
  charms: 'charms',
  seals: 'seals',
  triadPowers: 'triad#powers',
  gems: 'gems',
  runes: 'runes',
};

function countEntries(v) {
  if (!v || typeof v !== 'object') return 0;
  const vals = Object.values(v);
  // nested category ({ boards, glyphs, nodes }) vs flat slug map
  const nested = vals.length > 0 && vals.length <= 5 && vals.every((x) => x && typeof x === 'object' && !('name' in x));
  if (nested) return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, Object.keys(x).length]));
  return vals.length;
}

export async function writeStaticData(normalized, outDir, { version = null, classSlug = null, raw = null } = {}) {
  await mkdir(outDir, { recursive: true });
  const counts = {};
  for (const [name, data] of Object.entries(normalized)) {
    // Pretty-print small files; keep big ones (paragon, skills, stats) compact.
    let text = JSON.stringify(data, null, 1);
    if (text.length > 1_000_000) text = JSON.stringify(data);
    await writeFile(path.join(outDir, `${name}.json`), text + '\n');
    counts[name] = countEntries(data);
  }
  if (raw) await writeFile(path.join(outDir, 'raw.json'), JSON.stringify(raw));
  const meta = {
    fetchedAt: new Date().toISOString(),
    source: ENDPOINT,
    operation: 'Diablo4NgfStaticDataQuery',
    staticDataVersion: version,
    classFilter: classSlug ?? 'all',
    files: Object.keys(normalized).map((n) => `${n}.json`),
    entityTypeToFile: ENTITY_TYPE_TO_FILE,
    counts,
  };
  await writeFile(path.join(outDir, 'meta.json'), JSON.stringify(meta, null, 2) + '\n');
  return meta;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv) {
  const args = { out: null, classSlug: null, raw: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const val = () => (a.includes('=') ? a.split('=').slice(1).join('=') : argv[++i]);
    if (a.startsWith('--out')) args.out = val();
    else if (a.startsWith('--class')) args.classSlug = val();
    else if (a === '--raw') args.raw = true;
    else if (a === '-h' || a === '--help') args.help = true;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) {
    console.log('Usage: node scripts/fetch-mobalytics-static.mjs [--out <dir>] [--class <slug>] [--raw]');
    return;
  }
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  const outDir = path.resolve(args.out ?? path.join(repoRoot, 'data', 'static'));
  const t0 = Date.now();
  console.log(`Fetching Mobalytics D4 static data from ${ENDPOINT} ...`);
  const { version, staticData, errors } = await fetchStaticData();
  if (errors.length) console.warn(`GraphQL returned ${errors.length} partial error(s):`, JSON.stringify(errors).slice(0, 500));
  const nulls = Object.entries(staticData).filter(([k, v]) => k !== 'meta' && !v?.data).map(([k]) => k);
  if (nulls.length) console.warn('Lists with no data:', nulls.join(', '));
  const normalized = normalizeStaticData(staticData, { classSlug: args.classSlug });
  const meta = await writeStaticData(normalized, outDir, {
    version,
    classSlug: args.classSlug,
    raw: args.raw ? { data: { game: { staticData } } } : null,
  });
  console.log(`Static data version ${version}; wrote ${meta.files.length} files to ${outDir} in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
  for (const [k, v] of Object.entries(meta.counts)) console.log(`  ${k.padEnd(18)} ${typeof v === 'number' ? v : JSON.stringify(v)}`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
