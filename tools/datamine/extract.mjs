#!/usr/bin/env node
// Diablo IV game-data extraction for diablo-companion.
//
//   node tools/datamine/extract.mjs [--game "G:\Blizzard\Diablo IV"] [--skip-casc] [--update-defs] [--keep-raw]
//
// Pipeline (all reads from the game install are strictly read-only, via tools/datamine/bin/cascx.exe):
//   1. read <game>/.build.info for the build version
//   2. ensure cascx.exe (CascLib-based, read-only) and the d4data definitions are available
//   3. copy CoreTOC*, EncryptedSNOs and StringList-Text-enUS.dat out of CASC into data/gamedata/raw/
//   4. copy the meta files of the SNO groups we care about (Affix, Item, Aspect, Paragon*, ...) into raw/
//   5. parse everything and write data/gamedata/strings/*.json and the structured JSON files
//
// See data/gamedata/README.md for the output schemas.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  readCoreToc, readReplacedSnos, readEncryptedSnos, iterCombinedMeta, MetaReader, gbidHash, loadJson,
} from './lib/d4meta.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..', '..');
const VENDOR = path.join(ROOT, 'tools', 'vendor');
const D4DATA = path.join(VENDOR, 'd4data');
const CASCLIB = path.join(VENDOR, 'CascLib');
const CASCX = path.join(HERE, 'bin', 'cascx.exe');
const OUT = path.join(ROOT, 'data', 'gamedata');
const RAW = path.join(OUT, 'raw');
const RAWB = path.join(RAW, 'base');
const BS = String.fromCharCode(92);

// ------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const opt = (name, def) => { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : def; };
const flag = (name) => argv.includes(name);
const GAME = opt('--game', process.env.D4_GAME_DIR || 'G:\\Blizzard\\Diablo IV');
const SKIP_CASC = flag('--skip-casc');
const UPDATE_DEFS = flag('--update-defs');

const log = (...a) => console.log('[extract]', ...a);
const writeJson = (rel, obj) => {
  const p = path.join(OUT, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 1) + '\n');
  return p;
};

// SNO groups whose meta files we copy out of CASC
const META_GROUPS = {
  20: 'GameBalance', 22: 'LevelArea', 31: 'Quest', 39: 'SkillKit', 48: 'World', 73: 'Item', 74: 'PlayerClass',
  80: 'Subzone', 82: 'MonsterFamily', 86: 'WorldState', 92: 'Territory', 96: 'QuestChain', 98: 'ItemType',
  99: 'Achievement', 104: 'Affix', 106: 'ParagonNode', 107: 'MonsterAffix', 108: 'ParagonBoard',
  109: 'SetItemBonus', 111: 'ParagonGlyph', 112: 'ParagonGlyphAffix', 116: 'ItemRequirement', 119: 'Jewelry',
  124: 'ParagonThreshold', 128: 'Aspect', 135: 'DungeonAffix', 151: 'CollectiblePower', 158: 'Zone',
  162: 'CommunityModifier', 170: 'GenericSkillTree',
};
// fUsableByClass / fAllowedForPlayerClass index order (verified: Barbarian aspects set index 2)
const CLASSES = ['Sorcerer', 'Druid', 'Barbarian', 'Rogue', 'Necromancer', 'Spiritborn', 'Paladin', 'Warlock'];

// ------------------------------------------------------------------------------------------------
// 1. build info
function readBuildInfo() {
  const txt = fs.readFileSync(path.join(GAME, '.build.info'), 'utf8').trim().split(/\r?\n/);
  const cols = txt[0].split('|').map(c => c.split('!')[0]);
  const rows = txt.slice(1).map(l => Object.fromEntries(l.split('|').map((v, i) => [cols[i], v])));
  const row = rows.find(r => r.Active === '1') || rows[0];
  return { version: row.Version, buildKey: row['Build Key'], cdnKey: row['CDN Key'], branch: row.Branch, product: row.Product || 'fenris', tags: row.Tags };
}

// 2. tooling
function ensureTools() {
  if (!fs.existsSync(path.join(CASCLIB, 'src', 'CascLib.h'))) {
    log('cloning CascLib into', CASCLIB);
    execFileSync('git', ['clone', '--depth', '1', 'https://github.com/ladislav-zezula/CascLib.git', CASCLIB], { stdio: 'inherit' });
  }
  if (!fs.existsSync(CASCX)) {
    log('building cascx.exe (needs mingw-w64 gcc/g++ on PATH)');
    const objDir = path.join(HERE, 'cascx', 'obj');
    fs.mkdirSync(objDir, { recursive: true });
    fs.mkdirSync(path.dirname(CASCX), { recursive: true });
    const cfiles = ['zlib/adler32.c', 'zlib/crc32.c', 'zlib/deflate.c', 'zlib/trees.c', 'zlib/zutil.c', 'zlib/inffast.c',
      'zlib/inflate.c', 'zlib/inftrees.c', 'jenkins/lookup3.c'];
    const objs = [];
    for (const c of cfiles) {
      const o = path.join(objDir, path.basename(c, '.c') + '.o');
      execFileSync('gcc', ['-O2', '-c', '-DUNICODE', '-D_UNICODE', path.join(CASCLIB, 'src', c), '-o', o], { stdio: 'inherit' });
      objs.push(o);
    }
    execFileSync('g++', ['-O2', '-std=c++17', '-DUNICODE', '-D_UNICODE', '-D_CRT_SECURE_NO_WARNINGS', '-I' + CASCLIB,
      '-I' + path.join(CASCLIB, 'src'), '-w', path.join(HERE, 'cascx', 'cascx.cpp'), ...objs, '-o', CASCX, '-static',
      '-lws2_32', '-lwininet'], { stdio: 'inherit' });
  }
  const need = ['definitions.json', 'attributeList.json', 'json/snoFileInfo.json', 'json/snoGroups.json', 'LICENSE', 'buildVersion.txt'];
  for (const f of need) {
    const p = path.join(D4DATA, f);
    if (UPDATE_DEFS || !fs.existsSync(p)) {
      log('downloading d4data', f);
      fs.mkdirSync(path.dirname(p), { recursive: true });
      execFileSync('curl', ['-sSfL', '-o', p, 'https://raw.githubusercontent.com/DiabloTools/d4data/master/' + f], { stdio: 'inherit' });
    }
  }
}

function cascx(args) {
  try {
    execFileSync(CASCX, [GAME, ...args], { stdio: ['ignore', 'inherit', 'pipe'], maxBuffer: 1 << 28 });
    return { failed: 0 };
  } catch (e) {
    // exit code 3 = some files failed (normally encrypted files whose TACT key is not available)
    const err = String(e.stderr || '');
    const m = err.match(/matched=(\d+) extracted=(\d+) failed=(\d+)/);
    if (e.status === 3 && m) return { matched: +m[1], extracted: +m[2], failed: +m[3] };
    process.stderr.write(err);
    throw e;
  }
}

// 3./4. CASC extraction
// Empty a directory of OUR output (never the game dir). Files are removed; directories that some
// other process (indexer, editor, AV) keeps open are left in place instead of failing the run.
function cleanDir(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) { cleanDir(p); try { fs.rmdirSync(p); } catch { /* busy: keep empty dir */ } }
    else fs.rmSync(p, { force: true, maxRetries: 5, retryDelay: 200 });
  }
}

function extractFromCasc() {
  if (!path.resolve(RAW).startsWith(path.resolve(OUT))) throw new Error('refusing to clean ' + RAW);
  cleanDir(RAW);
  fs.mkdirSync(RAW, { recursive: true });
  log('copying core files out of CASC ...');
  const core = cascx(['extract', RAW, 'base:CoreTOC.dat', 'base:CoreTOCReplacedSnosMapping.dat', 'base:CoreTOCSharedPayloadsMapping.dat',
    'base:EncryptedSNOs.dat', 'base:StringList-Text-enUS.dat', 'base:StringList-Text-Global.dat']);
  if (core.failed) throw new Error('core file extraction failed');
  const toc = readCoreToc(fs.readFileSync(path.join(RAWB, 'CoreTOC.dat')));
  const list = [];
  for (const g of Object.keys(META_GROUPS)) for (const id of (toc.byGroup[g] || new Map()).keys()) list.push('base:meta' + BS + id);
  const listFile = path.join(RAW, 'meta-list.txt');
  fs.writeFileSync(listFile, list.join('\n'));
  log(`copying ${list.length} meta files out of CASC ...`);
  const r = cascx(['extract-list', RAW, listFile]);
  log(`meta copy done (${r.failed || 0} files skipped: encrypted / key not available)`);
  return { metaRequested: list.length, metaEncryptedSkipped: r.failed || 0 };
}

// ------------------------------------------------------------------------------------------------
// text helpers
const plain = (s) => s == null ? s : String(s)
  .replace(/\{if:[^}]*\}|\{else\}|\{\/if\}/g, '')
  .replace(/\{\/?(c_[A-Za-z0-9_]*|c|u|\/c_[A-Za-z0-9_]*|icon:[^}]*|bullet)\}/g, '')
  .replace(/\{\/c_[^}]*\}/g, '')
  .replace(/\[[^\]]*\]/g, '#')
  .replace(/\r\n/g, '\n').trim();

// Substitute numeric placeholders inside [...] blocks when every token is known.
//   Affix."Static Value N" -> staticValues[N];  {VALUE}, {VALUE1}, {VALUE2} -> vars
// Format suffix "|1%|" = 1 decimal + percent, "|%x|" = percent (multiplicative), etc.
function resolveText(desc, staticValues = [], vars = {}) {
  if (!desc) return desc;
  return desc.replace(/\[([^\]|]*)((?:\|[^\]|]*)*)\|?\]/g, (all, expr, fmt) => {
    let ok = true, used = false;
    let js = expr.replace(/Affix\."Static Value (\d+)"/g, (_, i) => {
      used = true; const v = staticValues[+i]; if (v === undefined) ok = false; return '(' + v + ')';
    });
    js = js.replace(/\{(VALUE\d?)\}/g, (_, k) => { used = true; const v = vars[k]; if (typeof v !== 'number') ok = false; return '(' + v + ')'; });
    if (!used || !ok || !/^[\d\s.+\-*/()]+$/.test(js)) return all;
    let v; try { v = Function('"use strict";return (' + js + ')')(); } catch { return all; }
    if (typeof v !== 'number' || !isFinite(v)) return all;
    const f = fmt || '';
    const dec = (f.match(/\|(\d)/) || [])[1];
    let s = dec !== undefined ? String(Number(v.toFixed(+dec))) : String(Math.round(v * 1000) / 1000);
    if (f.includes('%')) s += '%';
    return s;
  });
}
const resolveStatic = (desc, sv) => (sv && sv.length) ? resolveText(desc, sv) : desc;

// ------------------------------------------------------------------------------------------------
function main() {
  const t0 = Date.now();
  const build = readBuildInfo();
  log('game build', build.version, 'at', GAME);
  ensureTools();
  let cascStats = {};
  if (!SKIP_CASC) cascStats = extractFromCasc();
  else log('--skip-casc: reusing', RAW);

  const definitions = loadJson(path.join(D4DATA, 'definitions.json'));
  const snoFileInfo = loadJson(path.join(D4DATA, 'json', 'snoFileInfo.json'));
  const groupNames = Object.fromEntries(Object.entries(snoFileInfo).map(([k, v]) => [k, v[0]]));
  const attributes = {};
  for (const v of Object.values(loadJson(path.join(D4DATA, 'attributeList.json')))) attributes[v.eAttrib] = v.name;
  const toc = readCoreToc(fs.readFileSync(path.join(RAWB, 'CoreTOC.dat')));
  const replacedSnos = readReplacedSnos(fs.readFileSync(path.join(RAWB, 'CoreTOCReplacedSnosMapping.dat')));
  const encryptedSnos = readEncryptedSnos(fs.readFileSync(path.join(RAWB, 'EncryptedSNOs.dat')));
  const gbid = {};
  const mr = new MetaReader({ definitions, attributes, toc, snoGroupNames: groupNames, replacedSnos, encryptedSnos, gbid });
  const nameOf = (id) => (toc.byId.get(id) || [])[1];
  const failures = [];

  const metaCache = new Map();
  const meta = (id) => {
    if (metaCache.has(id)) return metaCache.get(id);
    const p = path.join(RAWB, 'meta', String(id));
    let v = null;
    if (fs.existsSync(p)) { try { v = mr.parseMeta(fs.readFileSync(p)); } catch (e) { failures.push(`${id} ${nameOf(id)}: ${e.message}`); } }
    metaCache.set(id, v);
    return v;
  };
  const groupEntries = (g) => [...(toc.byGroup[g] || new Map()).entries()].filter(([, n]) => n !== 'Axe Bad Data');

  // ---- GameBalance -> GBID name tables (needed to name affix families, skill tags, ...)
  log('parsing GameBalance tables ...');
  const gbTables = {};
  for (const [id, name] of groupEntries(20)) {
    const v = meta(id); if (!v) continue;
    const t = v.eGameBalanceType;
    const entries = (v.ptData && v.ptData[0] && v.ptData[0].tEntries) || [];
    (gbTables[t] ||= { files: [], names: {} }).files.push(name);
    for (const e of entries) {
      const n = e && e.tHeader && e.tHeader.szName;
      if (typeof n === 'string' && n) { (gbid[t] ||= {})[gbidHash(n)] = n; gbTables[t].names[gbidHash(n)] = n; }
      // DataAttributes table (type 84) defines data-driven attributes (negative eAttribute ids)
      if (t === 84 && typeof n === 'string' && e.nDataAttribKey !== undefined) attributes[e.nDataAttribKey | 0] = n;
    }
  }
  metaCache.clear();     // re-parse later files with GBID names available
  const gbName = (x) => x ? (x.name || (gbid[x.group] && gbid[x.group][x.gbid]) || null) : null;

  // ---- StringLists
  log('parsing enUS StringLists ...');
  const stl = {};            // stlName -> {label: text}
  const stlSno = {};
  let stringCount = 0;
  for (const [sno, buf] of iterCombinedMeta(fs.readFileSync(path.join(RAWB, 'StringList-Text-enUS.dat')), 42)) {
    const name = nameOf(sno) || String(sno);
    try {
      const v = mr.parseMeta(buf, { standalone: false, group: 42 });
      const o = {};
      for (const e of v.arStrings || []) { o[e.szLabel] = e.szText; stringCount++; }
      stl[name] = o; stlSno[name] = sno;
    } catch (e) { failures.push(`StringList ${sno} ${name}: ${e.message}`); }
  }
  const S = (prefix, id) => stl[prefix + '_' + id] || null;

  // group string lists into files
  const CATS = [
    ['affixes', /^Affix_/],
    ['items', /^(Item|ItemType|SetItemBonus|Jewelry|RareNameStrings|ItemLabels?|ItemLabelGroups|ItemQuality|ItemSlots|ItemTags|ItemRequirements?|TalismanRarityNames|TooltipTags)(_|$)/],
    ['powers', /^(Power|CollectiblePower|CollectiblePowerCategories|GenericSkillTree|SkillKit|PowerKeywords|SkillTags?|SkillTagNames|SkillSlotCategories|SkillTree|SkillTreeUI|SkillRequirements|BuffTooltips|AttributeDescriptions|RequiredAttributes|PowerModifier|Talents|RogueSpecializations|DruidSpirit|SpiritbornMechanic|PaladinOath|WarlockMechanic|NecromancerArmy|WeaponExpertise|CodexOfPower|Blessings)(_|$)/],
    ['paragon', /^(ParagonNode|ParagonGlyph|ParagonGlyphAffix|ParagonBoard|ParagonThreshold|ParagonBoardUI|Glyph)(_|$)/],
    ['actors', /^(Actor|MonsterFamily|MonsterAffix|MonsterNames|MonsterTypes|MonsterFlavorOverrides|Mercenary|MercenaryUI)(_|$)/],
    ['world', /^(World|LevelArea|Territory|Zone|Zones|Subzone|DungeonAffix|DungeonAffixes|DungeonAffixDescriptions|DungeonAffixGB|WorldState|WorldTiers|DifficultyLevels|Events|KeyedDungeon|Dungeon|DGN|Raid|RaidDifficulty|PIT|Tower|TWR|ChallengeRiftUI|CommunityModifier|Map|DRLG|Reliquaries|Malignant|NBK|BrimstoneKeep|MJD|EGD|Capstone|CAP|Bounties|SummonBoss|Hall|KillStreak)(_|$)/],
    ['quests', /^(Quest|QuestChain|QuestLog|QuestRewards|GlobalQuestData|ObjectiveTracker|Journey|CampaignProgress)(_|$)/],
    ['achievements', /^(Achievement|AchievementsUI|Challenge|PlayerTitle|TrackedReward|TrackedRewards|PrestigeTitles|SeasonalLaurels|Reputation)(_|$)/],
    ['recipes', /^(Recipe|Crafter|CrafterTab|Crafting|CraftingMatCategories|RecipeIngredientDescriptions|HoradricCube|Horadric|Salvage)(_|$)/],
    ['seasons', /^(Season|Seasons|Seasonal|GenericSeason|S\d\d|X1|X2|SeasonRankingInfoPopup|EternalOnly|AnniversaryEvent|BonVoyage)(_|$)/],
    ['cosmetics', /^(StoreProduct|Emote|Emblem|Dye|MarkingShape|MarkingColor|HairColor|HairStyle|Makeup|EyeColor|FacialHair|portal|Store|Shop|Wardrobe|Mounts|TownPortalCosmetic)(_|$)/],
    ['conversations', /^(Conv|MovSub|MovSubCC|CinematicSummary|Lore)(_|$)/],
  ];
  const stringFiles = {};
  for (const [name, labels] of Object.entries(stl)) {
    const cat = (CATS.find(([, re]) => re.test(name)) || ['ui'])[0];
    (stringFiles[cat] ||= {})[name] = labels;
  }
  cleanDir(path.join(OUT, 'strings'));
  const stringFileStats = {};
  for (const [cat, obj] of Object.entries(stringFiles)) {
    const sorted = Object.fromEntries(Object.keys(obj).sort().map(k => [k, obj[k]]));
    const p = path.join(OUT, 'strings', cat + '.json');
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, JSON.stringify(sorted) + '\n');
    stringFileStats[cat] = { stringLists: Object.keys(obj).length, strings: Object.values(obj).reduce((a, o) => a + Object.keys(o).length, 0), bytes: fs.statSync(p).size };
  }
  log(`strings: ${Object.keys(stl).length} lists, ${stringCount} strings`);

  // ---- helpers for structured output
  const ref = (x) => x ? { sno: x.sno, id: x.name } : null;
  const classesOf = (arr) => {
    if (!Array.isArray(arr)) return [];
    const on = arr.map((v, i) => v ? CLASSES[i] : null).filter(Boolean);
    return on.length === CLASSES.length ? ['All'] : on;
  };
  const AD = stl.AttributeDescriptions || {};
  const attrList = (arr) => (arr || []).map(a => {
    const t = a.tAttribute || a;
    const out = { attribute: t.eAttribute_name || t.eAttribute };
    if (t.nParam !== undefined && t.nParam !== -1) {
      out.param = t.nParam;
      const pe = toc.byId.get(t.nParam);
      if (pe) {
        out.paramName = pe[1];
        const ps = pe[0] === 29 ? stl['Power_' + pe[1]] : null;
        if (ps && (ps.name || ps.Name)) out.paramDisplayName = ps.name || ps.Name;
      }
    }
    if (t.szAttributeFormula && t.szAttributeFormula !== '0' && t.szAttributeFormula !== '') out.formula = t.szAttributeFormula;
    if (t.gbidFormula) out.formulaTable = gbName(t.gbidFormula) || t.gbidFormula.gbid;
    const cands = [];
    if (out.paramName) cands.push(out.attribute + '#' + out.paramName);
    if (out.param !== undefined) cands.push(out.attribute + '#' + out.param);
    cands.push(out.attribute);
    const lab = cands.find(c => AD[c] !== undefined);
    if (out.formula !== undefined && /^-?[\d.]+$/.test(out.formula)) out.value = Number(out.formula);
    if (lab) {
      out.text = AD[lab]; out.textPlain = plain(AD[lab]);
      if (out.value !== undefined) {
        const r = resolveText(AD[lab], [], { VALUE: out.value, VALUE2: out.value });
        if (r !== AD[lab]) out.textResolved = plain(r.replace(/\{VALUE1\}/g, out.paramDisplayName || out.paramName || '{VALUE1}'));
      }
    }
    return out;
  });
  const envelope = (what, entries, extra = {}) => ({ build: build.version, generated: new Date().toISOString(), source: what, count: entries.length, ...extra, entries });

  // ---- Affixes
  log('affixes ...');
  const affixes = [];
  const affixById = new Map();
  for (const [id, name] of groupEntries(104)) {
    const v = meta(id);
    const s = S('Affix', name) || {};
    const e = { sno: id, id: name };
    if (s.Name) e.name = s.Name;
    if (s.Name_Prefix) e.namePrefix = s.Name_Prefix;
    if (s.Name_Suffix) e.nameSuffix = s.Name_Suffix;
    if (s.Desc) { e.desc = s.Desc; e.descPlain = plain(resolveStatic(s.Desc, v && v.arStaticValues)); }
    if (v) {
      if (s.Desc && v.arStaticValues && v.arStaticValues.length) e.descResolved = resolveStatic(s.Desc, v.arStaticValues);
      Object.assign(e, {
        magicType: v.eMagicType, affixType: v.eAffixType, category: v.eCategory,
        itemPower: [v.nItemPowerMin, v.nItemPowerMax],
        classes: classesOf(v.fAllowedForPlayerClass),
        family: gbName(v.gbidAffixFamily),
        itemLabels: v.arAllowedItemLabels || [],
        attributes: attrList(v.ptItemAffixAttributes),
        staticValues: v.arStaticValues || [],
        maxLegendaryRanks: v.arMaxLegendaryRanks,
        passivePower: ref(v.snoPassivePower),
        skillTags: (v.arAffixSkillTags || []).map(gbName).filter(Boolean),
        affixTags: (v.arAffixTags || []).map(gbName).filter(Boolean),
        itemTags: (v.arItemTags || []).map(gbName).filter(Boolean),
        tempered: !!v.bIsTemperedAffix,
        sealTag: gbName(v.gbidSealAffixNameTag),
      });
    } else e.encrypted = !!encryptedSnos[id];
    const other = Object.fromEntries(Object.entries(s).filter(([k]) => !['Name', 'Name_Prefix', 'Name_Suffix', 'Desc'].includes(k)));
    if (Object.keys(other).length) e.strings = other;
    affixes.push(e); affixById.set(id, e);
  }
  writeJson('affixes.json', envelope('Affix (.aff) + StringList Affix_*', affixes));

  // ---- Aspects
  log('aspects ...');
  const aspects = [];
  for (const [id, name] of groupEntries(128)) {
    const v = meta(id);
    const a = v && v.snoAffix ? affixById.get(v.snoAffix.sno) : null;
    const s = S('Aspect', name) || {};
    aspects.push({
      sno: id, id: name,
      name: s.Name || (a && (a.name || a.nameSuffix)) || null,
      affix: v && v.snoAffix ? { sno: v.snoAffix.sno, id: v.snoAffix.name } : null,
      desc: a ? a.desc || null : null,
      descResolved: a ? (a.descResolved || a.desc || null) : null,
      descPlain: a ? a.descPlain || null : null,
      classes: a ? a.classes : [],
      category: a ? a.category : null,
      attributes: a ? a.attributes : [],
      staticValues: a ? a.staticValues : [],
      maxLegendaryRanks: a ? a.maxLegendaryRanks : null,
      encrypted: !v && !!encryptedSnos[id] ? true : undefined,
    });
  }
  writeJson('aspects.json', envelope('Aspect (.asp) -> Affix (.aff) + StringList Affix_*', aspects));

  // ---- Items (index), uniques, gems/runes, charms
  log('items ...');
  const items = [], uniques = [], gems = [], runes = [], charms = [], elixirs = [];
  const itemTypes = {};
  for (const [id, name] of groupEntries(98)) itemTypes[name] = (S('ItemType', name) || {}).Name || null;
  const affixBrief = (r) => {
    if (!r) return null;
    const a = affixById.get(r.sno);
    const o = { sno: r.sno, id: r.name };
    if (a) {
      for (const k of ['name', 'namePrefix', 'nameSuffix', 'desc', 'descResolved', 'descPlain']) if (a[k]) o[k] = a[k];
      if (!a.desc) { const t = (a.attributes || []).filter(x => x.text).map(x => x.text); if (t.length) o.attributeText = t; }
    }
    return o;
  };
  for (const [id, name] of groupEntries(73)) {
    const v = meta(id);
    const s = S('Item', name) || {};
    if (!v && !s.Name) continue;
    const it = v && v.snoItemType ? v.snoItemType.name : null;
    const base = {
      sno: id, id: name, name: s.Name || null, itemType: it, itemTypeName: it ? itemTypes[it] || null : null,
      magicType: v ? v.eMagicType : null,
    };
    if (s.Name) items.push({ ...base, placeholder: /^\[PH\]/.test(s.Name) || undefined, classes: v ? classesOf(v.fUsableByClass) : [], seasonItem: v ? !!v.bSeasonItem : undefined, encrypted: !v && !!encryptedSnos[id] ? true : undefined });
    if (!v) continue;
    const isUnique = /_Unique_/i.test(name) && !/^(zzOld|Talisman_Charm_Unique|QST_|PTR_)/i.test(name) && !/^\[PH\]/.test(s.Name || '');
    if (isUnique && s.Name) {
      const forced = (v.arForcedAffixes || []).map(affixBrief).filter(Boolean);
      const inherent = (v.arInherentAffixes || []).map(affixBrief).filter(Boolean);
      uniques.push({
        ...base, flavor: s.Flavor || null, classes: classesOf(v.fUsableByClass),
        mythic: v.eMagicType === 4, seasonVariant: (name.match(/^(S\d\d)_/) || [])[1] || undefined,
        baseItem: ref(v.snoBaseItem), uniquePower: forced.find(a => a.id === name || a.desc) || null,
        forcedAffixes: forced, inherentAffixes: inherent,
        charmVersion: (v.arItemEquipmentCollision || []).filter(x => x && /Talisman|Charm/i.test(x.name)).map(ref),
        strings: s,
      });
    }
    if (/^Gem_/i.test(name) && s.Name) {
      gems.push({ ...base, flavor: s.Flavor || null, strings: s, socketedEffects: (v.ptSocketedEffects || []).map(se => ({
        target: ['weapon', 'armor', 'jewelry'][se.eSocketTarget] ?? se.eSocketTarget,
        attributes: attrList(se.ptAttributes),
      })), forcedAffix: affixBrief(v.snoGemForcedAffix) });
    }
    if (/^Rune_/i.test(name) && s.Name) {
      runes.push({ ...base, runeDescription: s.RuneDescription || null, runeDescriptionPlain: plain(s.RuneDescription), runewordPrefix: s.RunewordPhrasePrefix || null,
        kind: /Condition/i.test(name) ? 'ritual' : /Effect/i.test(name) ? 'invocation' : null,
        rarity: v.eRuneRarity, runicPower: v.dwRunicPowerAmount, power: ref(v.snoRunePower), strings: s });
    }
    if ((/Talisman|Charm|Seal/i.test(name) || (v.eCharmRarity !== undefined && v.eCharmRarity !== -1 && v.eCharmRarity !== 0)) && s.Name && !/^QST_|^DGN_/i.test(name)) {
      charms.push({ ...base, flavor: s.Flavor || null, charmRarity: v.eCharmRarity, classes: classesOf(v.fUsableByClass),
        setBonus: ref(v.snoSetItemBonus), setBonusName: v.snoSetItemBonus ? (S('SetItemBonus', v.snoSetItemBonus.name) || {}).Name || null : null,
        forcedAffixes: (v.arForcedAffixes || []).map(affixBrief).filter(Boolean), inherentAffixes: (v.arInherentAffixes || []).map(affixBrief).filter(Boolean), strings: s });
    }
    if (/Elixir|Incense|Potion/i.test(name) && s.Name && !/^QST_/i.test(name)) elixirs.push({ ...base, strings: s });
  }
  writeJson('items.json', envelope('Item (.itm) + StringList Item_*', items, { itemTypes }));
  writeJson('uniques.json', envelope('Item (.itm) *_Unique_* + forced/inherent Affix', uniques));
  writeJson('gems_runes.json', { build: build.version, generated: new Date().toISOString(), gems, runes });
  log(`items ${items.length}, uniques ${uniques.length}, gems ${gems.length}, runes ${runes.length}, charms ${charms.length}`);

  // set bonuses (talisman/charm sets)
  const setBonuses = [];
  for (const [id, name] of groupEntries(109)) {
    const v = meta(id); const s = S('SetItemBonus', name) || {};
    const tiers = v ? (v.ptTiers || []).map(t => ({ pieces: t.nRequired, affix: affixBrief(t.snoAffix) })) : [];
    setBonuses.push({ sno: id, id: name, name: s.Name || null, classHint: (name.match(/_(Barb|Druid|Necro|Rogue|Sorc|Spirit|Pala|Warlock)/) || [])[1] || null, tiers, strings: s });
  }
  writeJson('charms.json', { build: build.version, generated: new Date().toISOString(), charms, setBonuses });

  // ---- Paragon
  log('paragon ...');
  const nodes = [], boards = [], glyphs = [], glyphAffixes = [], thresholds = [];
  for (const [id, name] of groupEntries(106)) {
    const v = meta(id); const s = S('ParagonNode', name) || {};
    nodes.push({ sno: id, id: name, name: s.Name || null, desc: s.Desc || null, strings: s,
      rarity: v ? v.eRarityOverride : null, gate: v ? !!v.bIsGate : null, socket: v ? !!v.bHasSocket : null,
      attributes: v ? attrList(v.ptAttributes) : [], bonusAttributeIndices: v ? v.ptBonusAttributeIndices : [],
      thresholds: v ? (v.arThresholdSelector || []).map(ref) : [], passivePower: v ? ref(v.snoPassivePower) : null,
      skillTags: v ? (v.arSkillTags || []).map(gbName).filter(Boolean) : [] });
  }
  for (const [id, name] of groupEntries(108)) {
    const v = meta(id); const s = S('ParagonBoard', name) || {};
    const w = v ? v.nWidth : 0; const grid = [];
    if (v && w) for (let i = 0; i < v.arEntries.length; i += w) grid.push(v.arEntries.slice(i, i + w).map(x => x ? x.name : null));
    const cls = (name.match(/Paragon_(Barb|Druid|Necro|Rogue|Sorc|Spirit|Paladin|Pala|Warlock|Lock)/i) || [])[1];
    boards.push({ sno: id, id: name, name: s.Name || null, classHint: cls || null, width: w, height: grid.length, grid,
      nodeSnos: v ? [...new Set((v.arEntries || []).filter(Boolean).map(x => x.sno))] : [] });
  }
  for (const [id, name] of groupEntries(112)) {
    const v = meta(id); const s = S('ParagonGlyphAffix', name) || {};
    glyphAffixes.push({ sno: id, id: name, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s, data: v || null });
  }
  const gaById = new Map(glyphAffixes.map(g => [g.sno, g]));
  for (const [id, name] of groupEntries(111)) {
    const v = meta(id); const s = S('ParagonGlyph', name) || {};
    glyphs.push({ sno: id, id: name, name: s.Name || null, strings: s, rarity: v ? v.eRarity : null,
      classes: v ? classesOf(v.fUsableByClass) : [],
      affixes: v ? (v.arAffixes || []).filter(Boolean).map(a => ({ sno: a.sno, id: a.name, desc: (gaById.get(a.sno) || {}).desc || null })) : [] });
  }
  for (const [id, name] of groupEntries(124)) thresholds.push({ sno: id, id: name, strings: S('ParagonThreshold', name), data: meta(id) });
  writeJson('paragon.json', { build: build.version, generated: new Date().toISOString(), counts: { boards: boards.length, nodes: nodes.length, glyphs: glyphs.length, glyphAffixes: glyphAffixes.length }, boards, nodes, glyphs, glyphAffixes, thresholds });

  // ---- World: zones, territories, worlds/dungeons, level areas, subzones, events, bosses
  log('world ...');
  const named = (g, prefix) => groupEntries(g).map(([id, name]) => { const s = S(prefix, name); return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || undefined, strings: Object.keys(s).length > 2 ? s : undefined } : null; }).filter(Boolean);
  const worlds = named(48, 'World').map(w => ({ ...w, dungeon: /^DGN_/i.test(w.id) || undefined }));
  const quests = groupEntries(31).map(([id, name]) => ({ id, name, s: S('Quest', name) })).filter(q => q.s && q.s.Name);
  const eventType = (n) => /WorldBoss/i.test(n) ? 'world_boss' : /Legion/i.test(n) ? 'legion' : /Helltide/i.test(n) ? 'helltide'
    : /^WE_/i.test(n) ? 'world_event' : /^DE_/i.test(n) ? 'dynamic_event' : /^LE_/i.test(n) ? 'local_event' : /Bounty/i.test(n) ? 'bounty'
    : /ZoneEvent/i.test(n) ? 'zone_event' : null;
  const events = quests.map(q => ({ sno: q.id, id: q.name, name: q.s.Name, type: eventType(q.name) })).filter(e => e.type);
  const dungeonAffixes = groupEntries(135).map(([id, name]) => { const s = S('DungeonAffix', name); return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s } : null; }).filter(Boolean);
  writeJson('world.json', {
    build: build.version, generated: new Date().toISOString(),
    zones: named(158, 'Zone'), territories: named(92, 'Territory'), subzones: named(80, 'Subzone'),
    worlds, dungeons: worlds.filter(w => w.dungeon), levelAreas: named(22, 'LevelArea'),
    events, dungeonAffixes, communityModifiers: named(162, 'CommunityModifier'),
    worldStates: named(86, 'WorldState'),
  });

  // ---- Monsters / bosses
  log('monsters ...');
  const actorNames = [];
  for (const [name, s] of Object.entries(stl)) {
    if (!name.startsWith('Actor_') || !s.Name) continue;
    const aid = name.slice(6);
    let sno = null; for (const [i, n] of (toc.byGroup[1] || new Map())) if (n === aid) { sno = i; break; }
    actorNames.push({ sno, id: aid, name: s.Name, flavorName: s.FlavorName || undefined,
      boss: /boss/i.test(aid) || undefined, worldBoss: (/^WorldBoss_/i.test(aid) && !!s.FlavorName) || undefined });
  }
  const monsterAffixes = groupEntries(107).map(([id, name]) => { const s = S('MonsterAffix', name); return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || undefined, strings: s } : null; }).filter(Boolean);
  const monsterFamilies = named(82, 'MonsterFamily');
  const gbMonsterNames = Object.values((gbTables[7] || {}).names || {});
  writeJson('monsters.json', { build: build.version, generated: new Date().toISOString(),
    bosses: actorNames.filter(a => a.boss || a.worldBoss), actors: actorNames, monsterFamilies, monsterAffixes, monsterNameTable: gbMonsterNames });

  // ---- Seasonal powers, skills index
  const collectiblePowers = groupEntries(151).map(([id, name]) => { const s = S('CollectiblePower', name); return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s } : null; }).filter(Boolean);
  const powers = [];
  for (const [name, s] of Object.entries(stl)) {
    if (!name.startsWith('Power_') || !s.name && !s.Name) continue;
    const pid = name.slice(6);
    let sno = null; for (const [i, n] of (toc.byGroup[29] || new Map())) if (n === pid) { sno = i; break; }
    powers.push({ sno, id: pid, name: s.name || s.Name, desc: s.desc || s.Desc || null, strings: s });
  }
  writeJson('powers.json', { build: build.version, generated: new Date().toISOString(), skills: powers, seasonalPowers: collectiblePowers });

  // ---- GBID tables useful to the app
  const pick = (t) => Object.values((gbTables[t] || {}).names || {}).sort();
  writeJson('gbid.json', { build: build.version, note: 'GameBalance name tables (eGameBalanceType -> names). Hash = djb2(lowercase(name)).',
    tables: Object.fromEntries(Object.entries(gbTables).map(([t, v]) => [t, { files: v.files, count: Object.keys(v.names).length }])),
    affixFamilies: pick(18), skillTags: pick(56), itemFamilies: pick(122), affixTags: pick(125), currencies: pick(59),
    talismanItemTags: pick(104), difficultyTiers: pick(88), keyedDungeonTypes: pick(78) });

  // ---- manifest
  const dirSize = (d) => fs.existsSync(d) ? fs.readdirSync(d, { withFileTypes: true }).reduce((a, e) => a + (e.isDirectory() ? dirSize(path.join(d, e.name)) : fs.statSync(path.join(d, e.name)).size), 0) : 0;
  const manifest = {
    build, definitionsBuild: fs.readFileSync(path.join(D4DATA, 'buildVersion.txt'), 'utf8').trim(),
    generated: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    casc: cascStats, rawBytes: dirSize(RAW),
    counts: {
      stringLists: Object.keys(stl).length, strings: stringCount, affixes: affixes.length, aspects: aspects.length,
      items: items.length, uniques: uniques.length, gems: gems.length, runes: runes.length, charms: charms.length,
      setBonuses: setBonuses.length, paragonBoards: boards.length, paragonNodes: nodes.length, glyphs: glyphs.length,
      glyphAffixes: glyphAffixes.length, worlds: worlds.length, dungeons: worlds.filter(w => w.dungeon).length,
      events: events.length, dungeonAffixes: dungeonAffixes.length, actorsNamed: actorNames.length,
      bosses: actorNames.filter(a => a.boss || a.worldBoss).length, skills: powers.length, seasonalPowers: collectiblePowers.length,
    },
    stringFiles: stringFileStats, parseErrors: failures.length, readerSoftErrors: mr.errors,
    encryptedSnosInBuild: Object.keys(encryptedSnos).length,
  };
  writeJson('manifest.json', manifest);
  if (failures.length) fs.writeFileSync(path.join(OUT, 'parse-errors.txt'), failures.join('\n') + '\n');
  log('done in', manifest.seconds, 's', JSON.stringify(manifest.counts));
}

main();
