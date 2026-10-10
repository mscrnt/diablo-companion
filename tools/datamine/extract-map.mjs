#!/usr/bin/env node
// World-map points of interest for diablo-companion: data/gamedata/map.json
//
//   node tools/datamine/extract-map.mjs [--game "G:\Blizzard\Diablo IV"] [--data <dir>] [--skip-casc] [--copy-to <file>]
//
// Run tools/datamine/extract.mjs first: this script reuses its raw/ cache (CoreTOC, Subzone, Quest,
// World and GameBalance meta files) and its strings/*.json output. It adds the overworld MarkerSet
// meta files to raw/base/meta (read-only copy out of CASC via cascx.exe, like extract.mjs), then
// parses everything and writes map.json. See data/gamedata/README.md and docs/research/map-data.md.
//
// Where the positions come from (all in overworld world units; the overworld is the World SNO
// "Sanctuary_Eastern_Continent"):
//   - Global "global_markers" (GlobalWaypointData): one entry per map-relevant actor with its WORLD
//     transform, world, level area and subzones. Source of waypoints, Altars of Lilith (and the
//     other hidden-cache collectibles) and every dungeon / cellar entrance portal.
//   - Subzone layer MarkerSets ("<Subzone> (<layer>)"): positions are already in world space.
//     Scene MarkerSets ("<Scene> (Game)"): scene-local, placed at the scene chunk's position from
//     WorldDefinition.ptServerData[0].ptSceneChunks (all overworld chunks have identity rotation).
//     Source of Deckard's Journal pages and Helltide chest spawn locations.
//   - QuestDefinition.vecStartLocation (strongholds) and vecDevStartLocation (side quests, approx).

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readCoreToc, readEncryptedSnos, MetaReader, gbidHash, loadJson } from './lib/d4meta.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(name);
const GAME = opt('--game', process.env.D4_GAME_DIR || 'G:\\Blizzard\\Diablo IV');
const DATA = path.resolve(opt('--data', process.env.D4_DATA_DIR || path.join(ROOT, 'data', 'gamedata')));
const COPY_TO = opt('--copy-to', null);
const SKIP_CASC = flag('--skip-casc');
const D4DATA = path.join(ROOT, 'tools', 'vendor', 'd4data');
const D4DATA_DIR = fs.existsSync(path.join(D4DATA, 'definitions.json')) ? D4DATA
  : path.join(DATA, '..', '..', 'tools', 'vendor', 'd4data');          // worktree: fall back to the data checkout's vendor dir
const CASCX = [path.join(HERE, 'bin', 'cascx.exe'), path.join(DATA, '..', '..', 'tools', 'datamine', 'bin', 'cascx.exe')].find(p => fs.existsSync(p));
const RAW = path.join(DATA, 'raw');
const RAWB = path.join(RAW, 'base');
const BS = String.fromCharCode(92);
const log = (...a) => console.log('[map]', ...a);

const OVERWORLD = 'Sanctuary_Eastern_Continent';
// Region key (Zone SNO name) for subzone / territory name prefixes, used when no Subzone maps a territory.
const PREFIX_ZONE = { Scos: 'Scosglen', Step: 'Dry_Steppes', Frac: 'Fractured_Peaks', Kehj: 'Kehjistan', Hawe: 'Hawezar', Naha: 'Nahantu', Skov: 'Skovos' };
// gbidDungeonArchetype (GameBalance type 90) -> entry kind
const archetypeKind = (a) => !a ? 'portal'
  : a === 'SideDungeonDefault' ? 'dungeon'
  : /^WorldCellar/.test(a) ? 'cellar'
  : a === 'QuestDungeon' ? 'quest_dungeon'
  : a === 'CampaignDungeon' ? 'campaign_dungeon'
  : /^(BossDungeon|CapstoneBossDungeon)$/.test(a) ? 'boss_dungeon'
  : a === 'Undercity' ? 'undercity'
  : /^(S\d+_|Seasonal)/.test(a) ? 'seasonal'
  : 'activity';                     // ThePit, Tower, Slaughterhouse, TrainingGrounds, capstones, ...
// Hidden-cache collectibles (GlobalMarkerActorHiddenCacheData) by actor name
const cacheKind = (actor) => /^LilithShrine/.test(actor) ? 'altar'
  : /^AkaratShrine/.test(actor) ? 'tenet_of_akarat'
  : /CreationShrine/.test(actor) ? 'chronicle_of_creation' : 'hidden_cache';

// ------------------------------------------------------------------------------------------------
function readBuildInfo() {
  const txt = fs.readFileSync(path.join(GAME, '.build.info'), 'utf8').trim().split(/\r?\n/);
  const cols = txt[0].split('|').map(c => c.split('!')[0]);
  const rows = txt.slice(1).map(l => Object.fromEntries(l.split('|').map((v, i) => [cols[i], v])));
  const row = rows.find(r => r.Active === '1') || rows[0];
  return row.Version;
}

function cascxExtractList(listFile) {
  if (!CASCX) throw new Error('cascx.exe not found: run tools/datamine/extract.mjs once to build it');
  try {
    execFileSync(CASCX, [GAME, 'extract-list', RAW, listFile], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 28 });
    return 0;
  } catch (e) {
    const m = String(e.stderr || '').match(/matched=(\d+) extracted=(\d+) failed=(\d+)/);
    if (e.status === 3 && m) return +m[3];     // some files encrypted (TACT key not available)
    process.stderr.write(String(e.stderr || ''));
    throw e;
  }
}

const r1 = (v) => Math.round(v * 10) / 10;
const polyArea = (pts) => { let a = 0; for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y); return Math.abs(a / 2); };
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.y > y) !== (b.y > y) && x < (b.x - a.x) * (y - a.y) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

// ------------------------------------------------------------------------------------------------
function main() {
  const t0 = Date.now();
  if (!fs.existsSync(path.join(RAWB, 'CoreTOC.dat'))) throw new Error(`no raw cache at ${RAW}: run tools/datamine/extract.mjs first (or pass --data)`);
  const build = fs.existsSync(path.join(GAME, '.build.info')) ? readBuildInfo() : null;
  const manifest = fs.existsSync(path.join(DATA, 'manifest.json')) ? loadJson(path.join(DATA, 'manifest.json')) : {};
  const definitions = loadJson(path.join(D4DATA_DIR, 'definitions.json'));
  const snoFileInfo = loadJson(path.join(D4DATA_DIR, 'json', 'snoFileInfo.json'));
  const groupNames = Object.fromEntries(Object.entries(snoFileInfo).map(([k, v]) => [k, v[0]]));
  const toc = readCoreToc(fs.readFileSync(path.join(RAWB, 'CoreTOC.dat')));
  const encryptedSnos = readEncryptedSnos(fs.readFileSync(path.join(RAWB, 'EncryptedSNOs.dat')));
  const gbid = {};
  const mr = new MetaReader({ definitions, toc, snoGroupNames: groupNames, encryptedSnos, gbid });
  const nameOf = (id) => (toc.byId.get(id) || [])[1];
  const snoByName = (g, name) => { for (const [id, n] of toc.byGroup[g] || []) if (n === name) return id; return null; };
  const failures = [];
  const metaFile = (id) => path.join(RAWB, 'meta', String(id));
  const meta = (id, asType = null) => {
    const p = metaFile(id);
    if (!fs.existsSync(p)) return null;
    try { return mr.parseMeta(fs.readFileSync(p), { asType }); } catch (e) { failures.push(`${id} ${nameOf(id)}: ${e.message}`); return null; }
  };

  // ---- strings (output of extract.mjs)
  const S = {};
  for (const f of fs.readdirSync(path.join(DATA, 'strings'))) Object.assign(S, loadJson(path.join(DATA, 'strings', f)));
  const sName = (prefix, id) => (id && S[prefix + '_' + id] && S[prefix + '_' + id].Name) || null;
  const clean = (s) => s == null ? s : String(s).replace(/\{[^}]*\}/g, '').split(/\r?\n/)[0].trim();

  // ---- GameBalance name tables (dungeon archetypes, spawn-location types, hidden caches)
  for (const [id] of toc.byGroup[20] || []) {
    const v = meta(id); if (!v) continue;
    for (const e of (v.ptData && v.ptData[0] && v.ptData[0].tEntries) || []) {
      const n = e && e.tHeader && e.tHeader.szName;
      if (typeof n === 'string' && n) (gbid[v.eGameBalanceType] ||= {})[gbidHash(n)] = n;
    }
  }
  const gbName = (x) => x ? (x.name || (gbid[x.group] && gbid[x.group][x.gbid]) || null) : null;

  // ---- world, scene chunks, subzones
  const WORLD_SNO = snoByName(48, OVERWORLD);
  const world = meta(WORLD_SNO);
  if (!world || !world.ptServerData || !world.ptServerData[0]) throw new Error('overworld World meta missing or without server data');
  const server = world.ptServerData[0];
  const chunks = server.ptSceneChunks || [];
  const chunkByScene = new Map(chunks.map(c => [c.snoname.name, c]));
  if (chunks.some(c => c.transform.q.x || c.transform.q.y || c.transform.q.z)) log('WARNING: rotated scene chunks; scene-local markers ignore rotation');

  const subzones = new Map();             // sno -> info
  const subzoneByName = new Map();
  const subzoneOfLevelArea = new Map();
  const zoneOfTerritory = new Map();
  for (const [id, name] of toc.byGroup[80] || []) {
    const v = meta(id); if (!v) continue;
    const info = { sno: id, name, world: v.snoPrimaryWorld && v.snoPrimaryWorld.name, zone: v.snoZoneParent && v.snoZoneParent.name, territory: v.snoTerritory && v.snoTerritory.name, layers: (v.arWorldMarkerSets || []).filter(e => e.snoMarkerSet).map(e => e.snoMarkerSet.sno) };
    subzones.set(id, info); subzoneByName.set(name, info);
    if (info.world === OVERWORLD) {
      for (const la of v.arLevelAreas || []) if (la && !subzoneOfLevelArea.has(la.sno)) subzoneOfLevelArea.set(la.sno, info);
      if (info.territory && info.zone && !zoneOfTerritory.has(info.territory)) zoneOfTerritory.set(info.territory, info.zone);
    }
  }
  const zoneFromPrefix = (n) => n ? PREFIX_ZONE[String(n).split('_')[0]] || null : null;

  // territory polygons (World.arRegionBoundaries); prefer the smallest named polygon containing a point
  const regions = (world.arRegionBoundaries || []).filter(r => r.snoTerritory && r.arPoints && r.arPoints.length > 2)
    .map(r => ({ id: r.snoTerritory.name, name: sName('Territory', r.snoTerritory.name), pts: r.arPoints, area: polyArea(r.arPoints) }))
    .sort((a, b) => a.area - b.area);
  const territoryAt = (x, y) => regions.find(r => r.name && inPoly(x, y, r.pts)) || regions.find(r => inPoly(x, y, r.pts)) || null;

  // ---- overworld MarkerSets: subzone layers (world space) + scene "(Game)" sets (scene-local)
  const owSubzoneNames = new Set([...subzones.values()].filter(s => s.world === OVERWORLD).map(s => s.name));
  const markerSets = [];                  // { sno, name, base, layer, chunk }
  for (const [id, name] of toc.byGroup[24] || []) {
    const m = name.match(/^(.*?) \((.*)\)$/); if (!m) continue;
    if (owSubzoneNames.has(m[1])) markerSets.push({ sno: id, name, base: m[1], layer: m[2], chunk: null });
    else if (m[2] === 'Game' && chunkByScene.has(m[1])) markerSets.push({ sno: id, name, base: m[1], layer: m[2], chunk: chunkByScene.get(m[1]) });
  }
  const globalSno = snoByName(21, 'global_markers');
  const need = [globalSno, WORLD_SNO, ...markerSets.map(m => m.sno)].filter(id => id != null && !encryptedSnos[id] && !fs.existsSync(metaFile(id)));
  if (need.length && !SKIP_CASC) {
    const listFile = path.join(RAW, 'map-meta-list.txt');
    fs.writeFileSync(listFile, need.map(id => 'base:meta' + BS + id).join('\n'));
    log(`copying ${need.length} meta files out of CASC ...`);
    const skipped = cascxExtractList(listFile);
    if (skipped) log(`${skipped} files skipped (encrypted)`);
  } else if (need.length) log(`--skip-casc: ${need.length} meta files missing from the raw cache`);

  // ---- parse MarkerSets
  log(`parsing ${markerSets.length} overworld marker sets ...`);
  const fb0 = mr.formatFallbacks, soft0 = mr.errors;
  const msBySno = new Map();
  let markerCount = 0;
  for (const ms of markerSets) {
    const v = meta(ms.sno, 'MarkerSetDefinition'); if (!v) continue;
    ms.markers = v.tMarkerSet || []; markerCount += ms.markers.length;
    msBySno.set(ms.sno, ms);
  }
  const markerFormatFallbacks = mr.formatFallbacks - fb0;
  const worldPos = (ms, m) => {
    const p = m.transform.wp, o = ms.chunk ? ms.chunk.transform.wp : { x: 0, y: 0, z: 0 };
    return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
  };

  // ---- entries
  const entries = [];
  const add = (e) => {
    const t = territoryAt(e.x, e.y);
    const sub = e.subzone ? subzoneByName.get(e.subzone) : null;
    const region = (t && (zoneOfTerritory.get(t.id) || zoneFromPrefix(t.id))) || (sub && sub.zone) || zoneFromPrefix(e.subzone)
      || zoneFromPrefix(String(e.key || '').replace(/^(CMP|Camp|QST)_/, '')) || null;
    entries.push({
      kind: e.kind, name: e.name, key: e.key,
      region, regionName: region ? sName('Zone', region) : null,
      territory: t ? t.id : null, territoryName: t ? t.name : null,
      subzone: e.subzone || null, levelArea: e.levelArea || null, levelAreaName: e.levelArea ? sName('LevelArea', e.levelArea) : null,
      x: r1(e.x), y: r1(e.y), z: e.z == null ? null : r1(e.z), precision: e.precision || 'exact',
      ...e.ids, ...(e.extra ? { extra: e.extra } : {}),
    });
  };

  // global markers
  const gm = meta(globalSno);
  const globals = gm ? gm.ptContent.flatMap(c => c.arGlobalMarkerActors || []) : [];
  let gmOther = 0;
  for (const g of globals) {
    if (!g.snoWorld || g.snoWorld.name !== OVERWORLD) { gmOther++; continue; }
    const p = g.tWorldTransform.wp;
    const actor = g.snoActor ? g.snoActor.name : null;
    const base = { x: p.x, y: p.y, z: p.z, levelArea: g.snoLevelArea && g.snoLevelArea.name, subzone: g.arSubzones && g.arSubzones[0] && g.arSubzones[0].name };
    const ids = { actor, actorSno: g.snoActor && g.snoActor.sno, markerSet: g.snoMarkerSet && g.snoMarkerSet.sno, source: 'global_markers' };
    for (const d of g.ptData || []) {
      if (d.__type === 'GlobalMarkerActorWaypointData') {
        add({ ...base, kind: 'waypoint', name: sName('LevelArea', base.levelArea) || base.levelArea, key: base.levelArea, ids });
      } else if (d.__type === 'GlobalMarkerActorHiddenCacheData') {
        const cache = gbName(d.gbidHiddenCache);
        add({ ...base, kind: cacheKind(actor), name: clean(sName('Actor', actor)) || actor, key: cache || `${actor}@${Math.round(p.x)},${Math.round(p.y)}`, ids: { ...ids, hiddenCache: cache } });
      } else if (d.__type === 'GlobalMarkerActorPortalData') {
        const arch = gbName(d.gbidDungeonArchetype);
        const dest = d.snoSpecifiedWorld && d.snoSpecifiedWorld.name;
        const destName = sName('World', dest);
        const secret = destName && /^\?+$/.test(destName.trim());          // e.g. the secret cow level portals ("???")
        add({ ...base, kind: secret ? 'secret' : archetypeKind(arch), name: (!secret && destName) || (d.snoPortalDestSubzone && d.snoPortalDestSubzone.name) || dest || actor, key: dest || actor,
          ids: { ...ids, destWorld: dest, destWorldSno: d.snoSpecifiedWorld && d.snoSpecifiedWorld.sno, destSubzone: d.snoPortalDestSubzone && d.snoPortalDestSubzone.name },
          extra: { archetype: arch, hiddenMapIcon: d.fHiddenMapIcon || undefined, objectiveQuest: d.snoPortalDestObjectiveQuest ? d.snoPortalDestObjectiveQuest.name : undefined } });
      }
    }
  }

  // Deckard's Journal (Season 15): part number = order of the marker handles in S15_DeckardsJourney_Hidden
  const journalPart = new Map();
  const djq = meta(snoByName(31, 'S15_DeckardsJourney_Hidden'));
  if (djq) {
    let n = 0;
    const walk = (o) => {
      if (!o || typeof o !== 'object') return;
      if (Array.isArray(o)) { o.forEach(walk); return; }
      if (o.tMarkerHandle && o.tMarkerHandle.snoMarkerSet) { const k = o.tMarkerHandle.snoMarkerSet.sno + '#' + o.tMarkerHandle.nID; if (!journalPart.has(k)) journalPart.set(k, ++n); }
      for (const v of Object.values(o)) walk(v);
    };
    walk(djq.arQuestPhases);
  }
  // Helltide chest spawn locations: spawn-location markers in "<Subzone> (UberSubzone)" layers
  for (const ms of msBySno.values()) {
    const helltide = /^ubersubzone$/i.test(ms.layer);
    for (const m of ms.markers) {
      if (m.snoname && m.snoname.name === 'S15_DeckardsJourney_JournalGizmo') {
        const part = journalPart.get(ms.sno + '#' + m.nID) || null;
        const item = part ? 'S15_DeckardsJourney_Journal_' + String(part).padStart(2, '0') : null;
        const p = worldPos(ms, m);
        add({ ...p, kind: 'journal', name: (item && sName('Item', item)) || clean(sName('Actor', m.snoname.name)), key: item || `${ms.name}#${m.nID}`, subzone: ms.chunk ? null : ms.base,
          ids: { actor: m.snoname.name, actorSno: m.snoname.sno, markerSet: ms.sno, markerId: m.nID, item, itemSno: item ? snoByName(73, item) : null, source: 'markerset' },
          extra: { part, partSource: part ? 'S15_DeckardsJourney_Hidden callback order' : undefined } });
      }
      if (helltide && m.eType === 50) for (const b of m.ptBase || []) {
        const t = b.__type === 'MarkerSpawnLocData' ? gbName(b.gbidSpawnLocType) : null;
        if (!t || !/^UberSubzone_Chest/.test(t) || /Guardian/.test(t)) continue;
        const p = worldPos(ms, m);
        add({ ...p, kind: 'helltide_chest', name: 'Helltide chest spawn point', key: `${ms.name}#${m.nID}`, subzone: ms.base,
          ids: { markerSet: ms.sno, markerId: m.nID, source: 'markerset' }, extra: { spawnLocType: t, tier: (t.match(/_(t\d)$/) || [])[1] || t.replace(/^UberSubzone_Chest_?/, '') || null } });
      }
    }
  }

  // Quests: strongholds (exact start location) and side quests (designer start location, approximate)
  let sideNoPos = 0;
  for (const [id, name] of toc.byGroup[31] || []) {
    const isCamp = /^(CMP|Camp)_/.test(name);
    if (!isCamp && !/^QST_/.test(name)) continue;
    const v = meta(id); if (!v) continue;
    const title = sName('Quest', name);
    if (!title || /^\[PH\]/.test(title)) continue;
    const la = v.snoLevelArea && v.snoLevelArea.name;
    const sub = v.snoLevelArea ? subzoneOfLevelArea.get(v.snoLevelArea.sno) : null;
    if (isCamp) {
      const p = v.vecStartLocation, w = v.snoWorldStartLocation;
      if (!w || w.name !== OVERWORLD || !p || (!p.x && !p.y)) continue;
      add({ ...p, kind: 'stronghold', name: title, key: name, levelArea: la, subzone: sub && sub.name, ids: { quest: name, questSno: id, source: 'quest.vecStartLocation' } });
    } else if (v.eQuestType === 0 && v.ePlayerQuestType === 0 && !v.fPrioritySideQuest) {
      const p = v.vecDevStartLocation, w = v.snoWorldDevStartLocation;
      if (!w || w.name !== OVERWORLD || !p || (!p.x && !p.y)) { sideNoPos++; continue; }
      add({ ...p, kind: 'side_quest', name: title, key: name, levelArea: la, subzone: sub && sub.name, precision: 'approx', ids: { quest: name, questSno: id, source: 'quest.vecDevStartLocation' } });
    }
  }

  // ---- de-duplicate: same kind + key within 4 world units (the same actor placed in several phase layers)
  const out = [];
  const seen = new Map();
  for (const e of entries) {
    const k = e.kind + '|' + e.key;
    const list = seen.get(k) || [];
    const dup = list.find(o => Math.hypot(o.x - e.x, o.y - e.y) < 4);
    if (dup) { dup.layers = (dup.layers || 1) + 1; continue; }
    list.push(e); seen.set(k, list); out.push(e);
  }
  const KIND_ORDER = ['waypoint', 'altar', 'tenet_of_akarat', 'chronicle_of_creation', 'hidden_cache', 'journal', 'stronghold', 'dungeon', 'cellar',
    'quest_dungeon', 'campaign_dungeon', 'boss_dungeon', 'undercity', 'seasonal', 'activity', 'secret', 'portal', 'side_quest', 'helltide_chest'];
  out.sort((a, b) => (KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind)) || String(a.region).localeCompare(String(b.region)) || String(a.name).localeCompare(String(b.name)) || a.x - b.x);

  // ---- validation
  // (1) subzone-layer / scene markers vs. the world transforms in global_markers
  let vOk = 0, vBad = 0;
  for (const g of globals) {
    const ms = g.snoMarkerSet && msBySno.get(g.snoMarkerSet.sno);
    if (!ms || !g.snoActor || !g.snoWorld || g.snoWorld.name !== OVERWORLD) continue;
    const gw = g.tWorldTransform.wp;
    const c = ms.markers.filter(m => m.snoname && m.snoname.sno === g.snoActor.sno);
    if (!c.length) continue;
    const best = Math.min(...c.map(m => { const p = worldPos(ms, m); return Math.hypot(p.x - gw.x, p.y - gw.y, p.z - gw.z); }));
    if (best < 0.05) vOk++; else vBad++;
  }
  // (2) zone-map projection: every global marker must fall inside its fog-of-war tile
  const zp = world.tZoneMapParams;
  const ART = 4096;                                    // 64 x 96 = 6144 units per map side; x flZoneArtScale (2/3) = 4096 px
  const span = zp.nGridSystemZoneMapFieldWidth * world.flGridSize;
  const k = 1 / (span * Math.SQRT2);
  const cu = zp.vecZoneArtCenter.x / ART, cv = zp.vecZoneArtCenter.y / ART;
  const toUV = (x, y) => ({ u: cu + (y - x) * k, v: cv + (x + y) * k });
  const fow = new Map((zp.arFogOfWar || []).filter(f => f.snoFoW).map(f => [f.snoFoW.sno, f]));
  let fIn = 0, fAll = 0;
  for (const g of globals) {
    if (!g.snoWorld || g.snoWorld.name !== OVERWORLD || !g.snoFogOfWar) continue;
    const f = fow.get(g.snoFogOfWar.sno); if (!f) continue;
    const { u, v } = toUV(g.tWorldTransform.wp.x, g.tWorldTransform.wp.y); fAll++;
    if (u >= f.vecWorldOffset.x && u <= f.vecWorldOffset.x + f.vecWorldSize.x && v >= f.vecWorldOffset.y && v <= f.vecWorldOffset.y + f.vecWorldSize.y) fIn++;
  }
  for (const e of out) { const { u, v } = toUV(e.x, e.y); e.u = Math.round(u * 1e5) / 1e5; e.v = Math.round(v * 1e5) / 1e5; }
  // (3) altar region (from the territory polygon) vs. the region in its hidden-cache name (LostCache_<Prefix>_...)
  const altars = out.filter(e => e.kind === 'altar');
  const altarAgree = altars.filter(e => e.hiddenCache && zoneFromPrefix(e.hiddenCache.replace(/^LostCache_/, '')) === e.region).length;
  // (4) waypoints cluster by region: nearest region centroid is the waypoint's own region
  const wps = out.filter(e => e.kind === 'waypoint' && e.region);
  const cent = {};
  for (const e of wps) { const c = (cent[e.region] ||= { x: 0, y: 0, n: 0 }); c.x += e.x; c.y += e.y; c.n++; }
  for (const c of Object.values(cent)) { c.x /= c.n; c.y /= c.n; }
  const wpOutliers = wps.filter(e => Object.entries(cent).sort((a, b) => Math.hypot(a[1].x - e.x, a[1].y - e.y) - Math.hypot(b[1].x - e.x, b[1].y - e.y))[0][0] !== e.region).map(e => `${e.name} (${e.region})`);

  const counts = {};
  for (const e of out) { (counts[e.kind] ||= { total: 0 }).total++; counts[e.kind][e.region || 'unknown'] = (counts[e.kind][e.region || 'unknown'] || 0) + 1; }
  const doc = {
    build: build || (manifest.build && manifest.build.version) || null,
    generated: new Date().toISOString(),
    source: 'Global global_markers + overworld MarkerSets (subzone layers, scene Game sets) + Quest start locations',
    world: { sno: WORLD_SNO, id: OVERWORLD, gridSize: world.flGridSize, sceneChunks: chunks.length, bounds: { minX: server.flMinX, minY: server.flMinY, maxX: server.flMaxX, maxY: server.flMaxY } },
    projection: {
      note: 'World X/Y -> zone-map UV (0..1 over the square map art). Derived from WorldDefinition.tZoneMapParams; u/v are included per entry. Screen orientation of the in-game map is not verified: register with an affine fit (waypoints).',
      formula: 'u = artCenter.x/artSize + (y - x) / (span*sqrt2);  v = artCenter.y/artSize + (x + y) / (span*sqrt2)',
      span, artSize: ART, artScale: zp.flZoneArtScale, artCenter: zp.vecZoneArtCenter, zoomBreakpoints: zp.arZoomBreakpoints,
      validation: `${fIn}/${fAll} global markers fall inside their fog-of-war tile (arFogOfWar vecWorldOffset/vecWorldSize)`,
    },
    regions: Object.fromEntries(Object.values(PREFIX_ZONE).map(z => [z, sName('Zone', z)])),
    counts,
    // territory outlines (World.arRegionBoundaries), usable to draw a vector base map without game art
    territories: regions.map(r => ({ id: r.id, name: r.name, region: zoneOfTerritory.get(r.id) || zoneFromPrefix(r.id), points: r.pts.map(p => [r1(p.x), r1(p.y)]) })),
    validation: {
      markerVsGlobal: `${vOk} markers match their global_markers world transform (<0.05 units), ${vBad} differ (actor nested in a prefab / other instance)`,
      markerSets: markerSets.length, markersParsed: markerCount, markerFormatFallbacks, readerSoftErrors: mr.errors - soft0,
      markerSetNote: markerFormatFallbacks ? 'MarkerSet format hash of this build is newer than definitions.json; parsed with the older MarkerSetDefinition (cross-checked above)' : undefined,
      altarRegionVsCacheName: `${altarAgree}/${altars.length}`,
      waypointRegionCentroids: Object.fromEntries(Object.entries(cent).map(([k, c]) => [k, { x: r1(c.x), y: r1(c.y), n: c.n }])),
      waypointOutliers: wpOutliers,
      globalMarkers: globals.length, globalMarkersOtherWorlds: gmOther, sideQuestsWithoutPosition: sideNoPos, parseErrors: failures.length,
    },
    entries: out,
  };
  const outFile = path.join(DATA, 'map.json');
  fs.writeFileSync(outFile, JSON.stringify(doc, null, 1) + '\n');
  if (COPY_TO) { fs.mkdirSync(path.dirname(path.resolve(COPY_TO)), { recursive: true }); fs.copyFileSync(outFile, path.resolve(COPY_TO)); }
  if (failures.length) fs.writeFileSync(path.join(DATA, 'map-parse-errors.txt'), failures.join('\n') + '\n');
  log(`wrote ${outFile} (${out.length} entries) in ${Math.round((Date.now() - t0) / 1000)} s`);
  for (const [kind, c] of Object.entries(counts)) log(kind.padEnd(22), JSON.stringify(c));
  log('validation', JSON.stringify(doc.validation));
  log('projection', doc.projection.validation);
}

main();
