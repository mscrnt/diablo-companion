// Diablo IV game-data extraction: the parsing half, with no filesystem or process of its own.
//
// Pipeline (all reads of the player's install are strictly read-only, done by the host through
// cascx.exe, see io.ts):
//   1. the host reads <game>/.build.info for the build version and hands it in
//   2. copy CoreTOC*, EncryptedSNOs and StringList-Text-enUS.dat out of CASC into the raw folder
//   3. copy the meta files of the SNO groups we care about (Affix, Item, Aspect, Paragon*, ...)
//   4. parse everything and write strings/*.json and the structured JSON files
//
// The output shapes are the ones data/gamedata/README.md documents, byte for byte, so the app's
// convert.ts and the generator scripts work the same whether the data came from the app or from
// the command-line runner.

import { iterCombinedMeta, gbidHash, MetaReader, readCoreToc, readEncryptedSnos, readReplacedSnos, type CoreToc, type Definitions, type SnoRef } from "./d4meta";
import { compact, pretty, readChunked, type BuildInfo, type CascResult, type GameDataIO, type StringLists } from "./io";

/** SNO groups whose meta files we copy out of CASC. */
export const META_GROUPS: Record<number, string> = {
  20: "GameBalance", 22: "LevelArea", 31: "Quest", 39: "SkillKit", 48: "World", 73: "Item", 74: "PlayerClass",
  80: "Subzone", 82: "MonsterFamily", 86: "WorldState", 92: "Territory", 96: "QuestChain", 98: "ItemType",
  99: "Achievement", 104: "Affix", 106: "ParagonNode", 107: "MonsterAffix", 108: "ParagonBoard",
  109: "SetItemBonus", 111: "ParagonGlyph", 112: "ParagonGlyphAffix", 116: "ItemRequirement", 119: "Jewelry",
  124: "ParagonThreshold", 128: "Aspect", 135: "DungeonAffix", 151: "CollectiblePower", 158: "Zone",
  162: "CommunityModifier", 170: "GenericSkillTree",
};
/** fUsableByClass / fAllowedForPlayerClass index order (verified: Barbarian aspects set index 2). */
const CLASSES = ["Sorcerer", "Druid", "Barbarian", "Rogue", "Necromancer", "Spiritborn", "Paladin", "Warlock"];

const BS = String.fromCharCode(92);
/** Stand-in for a string list the build does not have. */
const NOSTR: Record<string, string> = {};
/** The six files everything else is read through. */
const CORE_FILES = [
  "base:CoreTOC.dat", "base:CoreTOCReplacedSnosMapping.dat", "base:CoreTOCSharedPayloadsMapping.dat",
  "base:EncryptedSNOs.dat", "base:StringList-Text-enUS.dat", "base:StringList-Text-Global.dat",
];

// ------------------------------------------------------------------------------------------------
// text helpers

export const plain = (s: unknown): any =>
  s == null
    ? s
    : String(s)
        .replace(/\{if:[^}]*\}|\{else\}|\{\/if\}/g, "")
        .replace(/\{\/?(c_[A-Za-z0-9_]*|c|u|\/c_[A-Za-z0-9_]*|icon:[^}]*|bullet)\}/g, "")
        .replace(/\{\/c_[^}]*\}/g, "")
        .replace(/\[[^\]]*\]/g, "#")
        .replace(/\r\n/g, "\n")
        .trim();

/**
 * Substitute numeric placeholders inside [...] blocks when every token is known.
 *   Affix."Static Value N" -> staticValues[N];  {VALUE}, {VALUE1}, {VALUE2} -> vars
 * Format suffix "|1%|" = 1 decimal + percent, "|%x|" = percent (multiplicative), etc.
 */
export function resolveText(desc: string | null | undefined, staticValues: number[] = [], vars: Record<string, number> = {}): any {
  if (!desc) return desc;
  return desc.replace(/\[([^\]|]*)((?:\|[^\]|]*)*)\|?\]/g, (all, expr: string, fmt: string) => {
    let ok = true,
      used = false;
    let js = expr.replace(/Affix\."Static Value (\d+)"/g, (_m, i: string) => {
      used = true;
      const v = staticValues[+i];
      if (v === undefined) ok = false;
      return "(" + v + ")";
    });
    js = js.replace(/\{(VALUE\d?)\}/g, (_m, k: string) => {
      used = true;
      const v = vars[k];
      if (typeof v !== "number") ok = false;
      return "(" + v + ")";
    });
    if (!used || !ok || !/^[\d\s.+\-*/()]+$/.test(js)) return all;
    let v: number;
    try {
      v = evalArithmetic(js);
    } catch {
      return all;
    }
    if (typeof v !== "number" || !isFinite(v)) return all;
    const f = fmt || "";
    const dec = (f.match(/\|(\d)/) || [])[1];
    let s = dec !== undefined ? String(Number(v.toFixed(+dec))) : String(Math.round(v * 1000) / 1000);
    if (f.includes("%")) s += "%";
    return s;
  });
}
const resolveStatic = (desc: string | null | undefined, sv?: number[]) => (sv && sv.length ? resolveText(desc, sv) : desc);

/**
 * Evaluate one of the game's little arithmetic expressions. The template strings only ever contain
 * digits, `. + - * /` and brackets (the caller checks), so this is a tiny shunting-yard instead of
 * `Function(...)`: no code from a game file is ever executed.
 */
export function evalArithmetic(src: string): number {
  let i = 0;
  const ws = () => {
    while (i < src.length && /\s/.test(src[i])) i++;
  };
  const expr = (): number => {
    let v = term();
    for (ws(); i < src.length && (src[i] === "+" || src[i] === "-"); ws()) {
      const op = src[i++];
      const r = term();
      v = op === "+" ? v + r : v - r;
    }
    return v;
  };
  const term = (): number => {
    let v = unary();
    for (ws(); i < src.length && (src[i] === "*" || src[i] === "/"); ws()) {
      const op = src[i++];
      const r = unary();
      v = op === "*" ? v * r : v / r;
    }
    return v;
  };
  const unary = (): number => {
    ws();
    if (src[i] === "+") {
      i++;
      return unary();
    }
    if (src[i] === "-") {
      i++;
      return -unary();
    }
    if (src[i] === "(") {
      i++;
      const v = expr();
      ws();
      if (src[i] !== ")") throw new Error("expected )");
      i++;
      return v;
    }
    const m = /^\d*\.?\d+(?:[eE][+-]?\d+)?/.exec(src.slice(i));
    if (!m) throw new Error("expected a number at " + i);
    i += m[0].length;
    return Number(m[0]);
  };
  const v = expr();
  ws();
  if (i !== src.length) throw new Error("trailing input");
  return v;
}

/** How the string lists are grouped into strings/*.json. */
const CATS: [string, RegExp][] = [
  ["affixes", /^Affix_/],
  ["items", /^(Item|ItemType|SetItemBonus|Jewelry|RareNameStrings|ItemLabels?|ItemLabelGroups|ItemQuality|ItemSlots|ItemTags|ItemRequirements?|TalismanRarityNames|TooltipTags)(_|$)/],
  ["powers", /^(Power|CollectiblePower|CollectiblePowerCategories|GenericSkillTree|SkillKit|PowerKeywords|SkillTags?|SkillTagNames|SkillSlotCategories|SkillTree|SkillTreeUI|SkillRequirements|BuffTooltips|AttributeDescriptions|RequiredAttributes|PowerModifier|Talents|RogueSpecializations|DruidSpirit|SpiritbornMechanic|PaladinOath|WarlockMechanic|NecromancerArmy|WeaponExpertise|CodexOfPower|Blessings)(_|$)/],
  ["paragon", /^(ParagonNode|ParagonGlyph|ParagonGlyphAffix|ParagonBoard|ParagonThreshold|ParagonBoardUI|Glyph)(_|$)/],
  ["actors", /^(Actor|MonsterFamily|MonsterAffix|MonsterNames|MonsterTypes|MonsterFlavorOverrides|Mercenary|MercenaryUI)(_|$)/],
  ["world", /^(World|LevelArea|Territory|Zone|Zones|Subzone|DungeonAffix|DungeonAffixes|DungeonAffixDescriptions|DungeonAffixGB|WorldState|WorldTiers|DifficultyLevels|Events|KeyedDungeon|Dungeon|DGN|Raid|RaidDifficulty|PIT|Tower|TWR|ChallengeRiftUI|CommunityModifier|Map|DRLG|Reliquaries|Malignant|NBK|BrimstoneKeep|MJD|EGD|Capstone|CAP|Bounties|SummonBoss|Hall|KillStreak)(_|$)/],
  ["quests", /^(Quest|QuestChain|QuestLog|QuestRewards|GlobalQuestData|ObjectiveTracker|Journey|CampaignProgress)(_|$)/],
  ["achievements", /^(Achievement|AchievementsUI|Challenge|PlayerTitle|TrackedReward|TrackedRewards|PrestigeTitles|SeasonalLaurels|Reputation)(_|$)/],
  ["recipes", /^(Recipe|Crafter|CrafterTab|Crafting|CraftingMatCategories|RecipeIngredientDescriptions|HoradricCube|Horadric|Salvage)(_|$)/],
  ["seasons", /^(Season|Seasons|Seasonal|GenericSeason|S\d\d|X1|X2|SeasonRankingInfoPopup|EternalOnly|AnniversaryEvent|BonVoyage)(_|$)/],
  ["cosmetics", /^(StoreProduct|Emote|Emblem|Dye|MarkingShape|MarkingColor|HairColor|HairStyle|Makeup|EyeColor|FacialHair|portal|Store|Shop|Wardrobe|Mounts|TownPortalCosmetic)(_|$)/],
  ["conversations", /^(Conv|MovSub|MovSubCC|CinematicSummary|Lore)(_|$)/],
];

// ------------------------------------------------------------------------------------------------

/** Everything the later stages (map, the generated app tables) need from this one. */
export interface ExtractOutput {
  build: BuildInfo;
  /** rel path -> the document, as written */
  docs: Record<string, any>;
  /** every enUS string list by name, which the map stage and the generators read */
  strings: StringLists;
  toc: CoreToc;
  definitions: Definitions;
  snoGroupNames: Record<number, string>;
  /** snoId -> [group, key hash] for the files this build keeps encrypted */
  encryptedSnos: Record<number, unknown>;
  manifest: any;
  failures: string[];
}

export interface ExtractOpts {
  io: GameDataIO;
  build: BuildInfo;
  /** reuse the raw folder instead of copying out of CASC again */
  skipCasc?: boolean;
  /** false for a document the host does not want on disk (it is still returned in `docs`) */
  keep?: (rel: string) => boolean;
}

/** Load the bundled d4data files the reader needs. */
export async function loadDefinitions(io: GameDataIO) {
  const definitions = JSON.parse(await io.vendor("definitions.json")) as Definitions;
  const snoFileInfo = JSON.parse(await io.vendor("json/snoFileInfo.json")) as Record<string, [string, ...unknown[]]>;
  const snoGroupNames = Object.fromEntries(Object.entries(snoFileInfo).map(([k, v]) => [k, v[0]])) as unknown as Record<number, string>;
  const attributes: Record<number, string> = {};
  for (const v of Object.values(JSON.parse(await io.vendor("attributeList.json")) as Record<string, { eAttrib: number; name: string }>))
    attributes[v.eAttrib] = v.name;
  const definitionsBuild = (await io.vendor("buildVersion.txt")).trim();
  return { definitions, snoGroupNames, attributes, definitionsBuild };
}

export async function extract({ io, build, skipCasc = false, keep = () => true }: ExtractOpts): Promise<ExtractOutput> {
  const t0 = Date.now();
  const docs: Record<string, any> = {};
  const writeJson = async (rel: string, obj: any) => {
    docs[rel] = obj;
    if (keep(rel)) await io.write(rel, pretty(obj));
  };

  io.progress({ stage: "Reading the game's data tables" });
  const { definitions, snoGroupNames, attributes, definitionsBuild } = await loadDefinitions(io);

  // ---- copy what we need out of CASC
  let cascStats: Record<string, number> = {};
  if (!skipCasc) {
    io.progress({ stage: "Opening the game files" });
    await io.cleanRaw();
    const core: CascResult = await io.casc(CORE_FILES, "mask");
    if (core.failed) throw new Error("core file extraction failed");
    const toc0 = readCoreToc((await mustRead(io, "base/CoreTOC.dat"))!);
    const list: string[] = [];
    for (const g of Object.keys(META_GROUPS).map(Number)) for (const id of (toc0.byGroup[g] || new Map()).keys()) list.push("base:meta" + BS + id);
    io.progress({ stage: "Copying the game's data files", done: 0, total: list.length });
    const r = await io.casc(list, "list");
    cascStats = { metaRequested: list.length, metaEncryptedSkipped: r.failed || 0 };
  }

  const toc = readCoreToc((await mustRead(io, "base/CoreTOC.dat"))!);
  const replacedSnos = readReplacedSnos((await mustRead(io, "base/CoreTOCReplacedSnosMapping.dat"))!);
  const encryptedSnos = readEncryptedSnos((await mustRead(io, "base/EncryptedSNOs.dat"))!);
  const gbid: Record<number, Record<number, string>> = {};
  const mr = new MetaReader({ definitions, attributes, toc, snoGroupNames, replacedSnos, encryptedSnos, gbid });
  const nameOf = (id: number) => (toc.byId.get(id) || ([] as unknown as [number, string]))[1];
  const failures: string[] = [];

  const metaPath = (id: number) => "base/meta/" + id;
  const parse = (id: number, buf: Uint8Array | null) => {
    if (!buf) return null;
    try {
      return mr.parseMeta(buf);
    } catch (e) {
      failures.push(`${id} ${nameOf(id)}: ${(e as Error).message}`);
      return null;
    }
  };
  const groupEntries = (g: number): [number, string][] => [...(toc.byGroup[g] || new Map()).entries()].filter(([, n]) => n !== "Axe Bad Data");
  /** A whole group, read in batches so only a few file bodies are alive at a time. */
  async function* groupMetas(g: number): AsyncGenerator<[number, string, any]> {
    const entries = groupEntries(g);
    for await (const [[id, name], buf] of readChunked(io, entries, ([id]) => metaPath(id))) yield [id, name, parse(id, buf)];
  }

  // ---- GameBalance -> GBID name tables (needed to name affix families, skill tags, ...)
  io.progress({ stage: "Reading the game's balance tables" });
  const gbTables: Record<number, { files: string[]; names: Record<number, string> }> = {};
  for await (const [, name, v] of groupMetas(20)) {
    if (!v) continue;
    const t = v.eGameBalanceType;
    const entries = (v.ptData && v.ptData[0] && v.ptData[0].tEntries) || [];
    (gbTables[t] ??= { files: [], names: {} }).files.push(name);
    for (const e of entries) {
      const n = e && e.tHeader && e.tHeader.szName;
      if (typeof n === "string" && n) {
        (gbid[t] ??= {})[gbidHash(n)] = n;
        gbTables[t].names[gbidHash(n)] = n;
      }
      // DataAttributes table (type 84) defines data-driven attributes (negative eAttribute ids)
      if (t === 84 && typeof n === "string" && e.nDataAttribKey !== undefined) attributes[e.nDataAttribKey | 0] = n;
    }
  }
  const gbName = (x: any) => (x ? x.name || (gbid[x.group] && gbid[x.group][x.gbid]) || null : null);

  // ---- StringLists
  io.progress({ stage: "Reading the game's text" });
  const stl: StringLists = {};
  let stringCount = 0;
  let sinceTick = 0;
  for (const [sno, buf] of iterCombinedMeta((await mustRead(io, "base/StringList-Text-enUS.dat"))!, 42)) {
    const name = nameOf(sno) || String(sno);
    try {
      const v = mr.parseMeta(buf, { standalone: false, group: 42 });
      const o: Record<string, string> = {};
      for (const e of v.arStrings || []) {
        o[e.szLabel] = e.szText;
        stringCount++;
      }
      stl[name] = o;
    } catch (e) {
      failures.push(`StringList ${sno} ${name}: ${(e as Error).message}`);
    }
    if (++sinceTick >= 2000) {
      sinceTick = 0;
      await io.tick();
    }
  }
  const S = (prefix: string, id: string): Record<string, string> | null => stl[prefix + "_" + id] || null;
  /** The same, but an absent list reads as empty (how the extractor has always treated it). */
  const Sx = (prefix: string, id: string): Record<string, string> => stl[prefix + "_" + id] || NOSTR;

  // group string lists into files
  const stringFiles: Record<string, StringLists> = {};
  for (const [name, labels] of Object.entries(stl)) {
    const cat = (CATS.find(([, re]) => re.test(name)) || ["ui"])[0] as string;
    (stringFiles[cat] ??= {})[name] = labels;
  }
  await io.clean("strings");
  const stringFileStats: Record<string, { stringLists: number; strings: number; bytes: number }> = {};
  const enc = new TextEncoder();
  for (const [cat, obj] of Object.entries(stringFiles)) {
    const sorted = Object.fromEntries(Object.keys(obj).sort().map((k) => [k, obj[k]]));
    const rel = "strings/" + cat + ".json";
    const text = compact(sorted);
    docs[rel] = sorted;
    if (keep(rel)) await io.write(rel, text);
    stringFileStats[cat] = {
      stringLists: Object.keys(obj).length,
      strings: Object.values(obj).reduce((a, o) => a + Object.keys(o).length, 0),
      bytes: enc.encode(text).length,
    };
    await io.tick();
  }

  // ---- helpers for structured output
  const ref = (x: SnoRef | null | undefined) => (x ? { sno: x.sno, id: x.name } : null);
  const classesOf = (arr: unknown): string[] => {
    if (!Array.isArray(arr)) return [];
    const on = arr.map((v, i) => (v ? CLASSES[i] : null)).filter(Boolean) as string[];
    return on.length === CLASSES.length ? ["All"] : on;
  };
  const AD = stl.AttributeDescriptions || NOSTR;
  const attrList = (arr: any[] | undefined) =>
    (arr || []).map((a) => {
      const t = a.tAttribute || a;
      const out: Record<string, any> = { attribute: t.eAttribute_name || t.eAttribute };
      if (t.nParam !== undefined && t.nParam !== -1) {
        out.param = t.nParam;
        const pe = toc.byId.get(t.nParam);
        if (pe) {
          out.paramName = pe[1];
          const ps = pe[0] === 29 ? stl["Power_" + pe[1]] : null;
          if (ps && ((ps as any).name || ps.Name)) out.paramDisplayName = (ps as any).name || ps.Name;
        }
      }
      if (t.szAttributeFormula && t.szAttributeFormula !== "0" && t.szAttributeFormula !== "") out.formula = t.szAttributeFormula;
      if (t.gbidFormula) out.formulaTable = gbName(t.gbidFormula) || t.gbidFormula.gbid;
      const cands: string[] = [];
      if (out.paramName) cands.push(out.attribute + "#" + out.paramName);
      if (out.param !== undefined) cands.push(out.attribute + "#" + out.param);
      cands.push(out.attribute);
      const lab = cands.find((c) => AD[c] !== undefined);
      if (out.formula !== undefined && /^-?[\d.]+$/.test(out.formula)) out.value = Number(out.formula);
      if (lab) {
        out.text = AD[lab];
        out.textPlain = plain(AD[lab]);
        if (out.value !== undefined) {
          const r = resolveText(AD[lab], [], { VALUE: out.value, VALUE2: out.value });
          if (r !== AD[lab]) out.textResolved = plain(r.replace(/\{VALUE1\}/g, out.paramDisplayName || out.paramName || "{VALUE1}"));
        }
      }
      return out;
    });
  const envelope = (what: string, entries: any[], extra: Record<string, any> = {}) => ({
    build: build.version,
    generated: new Date().toISOString(),
    source: what,
    count: entries.length,
    ...extra,
    entries,
  });

  // ---- Affixes
  io.progress({ stage: "Reading affixes" });
  const affixes: any[] = [];
  const affixById = new Map<number, any>();
  for await (const [id, name, v] of groupMetas(104)) {
    const s = Sx("Affix", name);
    const e: Record<string, any> = { sno: id, id: name };
    if (s.Name) e.name = s.Name;
    if (s.Name_Prefix) e.namePrefix = s.Name_Prefix;
    if (s.Name_Suffix) e.nameSuffix = s.Name_Suffix;
    if (s.Desc) {
      e.desc = s.Desc;
      e.descPlain = plain(resolveStatic(s.Desc, v && v.arStaticValues));
    }
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
    const other = Object.fromEntries(Object.entries(s).filter(([k]) => !["Name", "Name_Prefix", "Name_Suffix", "Desc"].includes(k)));
    if (Object.keys(other).length) e.strings = other;
    affixes.push(e);
    affixById.set(id, e);
  }
  await writeJson("affixes.json", envelope("Affix (.aff) + StringList Affix_*", affixes));

  // ---- Aspects
  io.progress({ stage: "Reading aspects" });
  const aspects: any[] = [];
  for await (const [id, name, v] of groupMetas(128)) {
    const a = v && v.snoAffix ? affixById.get(v.snoAffix.sno) : null;
    const s = Sx("Aspect", name);
    aspects.push({
      sno: id, id: name,
      name: s.Name || (a && (a.name || a.nameSuffix)) || null,
      affix: v && v.snoAffix ? { sno: v.snoAffix.sno, id: v.snoAffix.name } : null,
      desc: a ? a.desc || null : null,
      descResolved: a ? a.descResolved || a.desc || null : null,
      descPlain: a ? a.descPlain || null : null,
      classes: a ? a.classes : [],
      category: a ? a.category : null,
      attributes: a ? a.attributes : [],
      staticValues: a ? a.staticValues : [],
      maxLegendaryRanks: a ? a.maxLegendaryRanks : null,
      encrypted: !v && !!encryptedSnos[id] ? true : undefined,
    });
  }
  await writeJson("aspects.json", envelope("Aspect (.asp) -> Affix (.aff) + StringList Affix_*", aspects));

  // ---- Items (index), uniques, gems/runes, charms
  io.progress({ stage: "Reading items" });
  const items: any[] = [], uniques: any[] = [], gems: any[] = [], runes: any[] = [], charms: any[] = [], elixirs: any[] = [];
  const itemTypes: Record<string, string | null> = {};
  for (const [, name] of groupEntries(98)) itemTypes[name] = (Sx("ItemType", name)).Name || null;
  const affixBrief = (r: SnoRef | null | undefined) => {
    if (!r) return null;
    const a = affixById.get(r.sno);
    const o: Record<string, any> = { sno: r.sno, id: r.name };
    if (a) {
      for (const k of ["name", "namePrefix", "nameSuffix", "desc", "descResolved", "descPlain"]) if (a[k]) o[k] = a[k];
      if (!a.desc) {
        const t = (a.attributes || []).filter((x: any) => x.text).map((x: any) => x.text);
        if (t.length) o.attributeText = t;
      }
    }
    return o;
  };
  for await (const [id, name, v] of groupMetas(73)) {
    const s = Sx("Item", name);
    if (!v && !s.Name) continue;
    const it = v && v.snoItemType ? v.snoItemType.name : null;
    const base = {
      sno: id, id: name, name: s.Name || null, itemType: it, itemTypeName: it ? itemTypes[it] || null : null,
      magicType: v ? v.eMagicType : null,
    };
    if (s.Name)
      items.push({
        ...base,
        placeholder: /^\[PH\]/.test(s.Name) || undefined,
        classes: v ? classesOf(v.fUsableByClass) : [],
        seasonItem: v ? !!v.bSeasonItem : undefined,
        encrypted: !v && !!encryptedSnos[id] ? true : undefined,
      });
    if (!v) continue;
    const isUnique = /_Unique_/i.test(name) && !/^(zzOld|Talisman_Charm_Unique|QST_|PTR_)/i.test(name) && !/^\[PH\]/.test(s.Name || "");
    if (isUnique && s.Name) {
      const forced = (v.arForcedAffixes || []).map(affixBrief).filter(Boolean);
      const inherent = (v.arInherentAffixes || []).map(affixBrief).filter(Boolean);
      uniques.push({
        ...base, flavor: s.Flavor || null, classes: classesOf(v.fUsableByClass),
        mythic: v.eMagicType === 4, seasonVariant: (name.match(/^(S\d\d)_/) || [])[1] || undefined,
        baseItem: ref(v.snoBaseItem), uniquePower: forced.find((a: any) => a.id === name || a.desc) || null,
        forcedAffixes: forced, inherentAffixes: inherent,
        charmVersion: (v.arItemEquipmentCollision || []).filter((x: any) => x && /Talisman|Charm/i.test(x.name)).map(ref),
        strings: s,
      });
    }
    if (/^Gem_/i.test(name) && s.Name) {
      gems.push({
        ...base, flavor: s.Flavor || null, strings: s,
        socketedEffects: (v.ptSocketedEffects || []).map((se: any) => ({
          target: ["weapon", "armor", "jewelry"][se.eSocketTarget] ?? se.eSocketTarget,
          attributes: attrList(se.ptAttributes),
        })),
        forcedAffix: affixBrief(v.snoGemForcedAffix),
      });
    }
    if (/^Rune_/i.test(name) && s.Name) {
      runes.push({
        ...base, runeDescription: s.RuneDescription || null, runeDescriptionPlain: plain(s.RuneDescription),
        runewordPrefix: s.RunewordPhrasePrefix || null,
        kind: /Condition/i.test(name) ? "ritual" : /Effect/i.test(name) ? "invocation" : null,
        rarity: v.eRuneRarity, runicPower: v.dwRunicPowerAmount, power: ref(v.snoRunePower), strings: s,
      });
    }
    if ((/Talisman|Charm|Seal/i.test(name) || (v.eCharmRarity !== undefined && v.eCharmRarity !== -1 && v.eCharmRarity !== 0)) && s.Name && !/^QST_|^DGN_/i.test(name)) {
      charms.push({
        ...base, flavor: s.Flavor || null, charmRarity: v.eCharmRarity, classes: classesOf(v.fUsableByClass),
        setBonus: ref(v.snoSetItemBonus),
        setBonusName: v.snoSetItemBonus ? (Sx("SetItemBonus", v.snoSetItemBonus.name)).Name || null : null,
        forcedAffixes: (v.arForcedAffixes || []).map(affixBrief).filter(Boolean),
        inherentAffixes: (v.arInherentAffixes || []).map(affixBrief).filter(Boolean),
        strings: s,
      });
    }
    if (/Elixir|Incense|Potion/i.test(name) && s.Name && !/^QST_/i.test(name)) elixirs.push({ ...base, strings: s });
  }
  await writeJson("items.json", envelope("Item (.itm) + StringList Item_*", items, { itemTypes }));
  await writeJson("uniques.json", envelope("Item (.itm) *_Unique_* + forced/inherent Affix", uniques));
  await writeJson("gems_runes.json", { build: build.version, generated: new Date().toISOString(), gems, runes });

  // set bonuses (talisman/charm sets)
  const setBonuses: any[] = [];
  for await (const [id, name, v] of groupMetas(109)) {
    const s = Sx("SetItemBonus", name);
    const tiers = v ? (v.ptTiers || []).map((t: any) => ({ pieces: t.nRequired, affix: affixBrief(t.snoAffix) })) : [];
    setBonuses.push({
      sno: id, id: name, name: s.Name || null,
      classHint: (name.match(/_(Barb|Druid|Necro|Rogue|Sorc|Spirit|Pala|Warlock)/) || [])[1] || null,
      tiers, strings: s,
    });
  }
  await writeJson("charms.json", { build: build.version, generated: new Date().toISOString(), charms, setBonuses });

  // ---- Paragon
  io.progress({ stage: "Reading the paragon boards" });
  const nodes: any[] = [], boards: any[] = [], glyphs: any[] = [], glyphAffixes: any[] = [], thresholds: any[] = [];
  for await (const [id, name, v] of groupMetas(106)) {
    const s = Sx("ParagonNode", name);
    nodes.push({
      sno: id, id: name, name: s.Name || null, desc: s.Desc || null, strings: s,
      rarity: v ? v.eRarityOverride : null, gate: v ? !!v.bIsGate : null, socket: v ? !!v.bHasSocket : null,
      attributes: v ? attrList(v.ptAttributes) : [], bonusAttributeIndices: v ? v.ptBonusAttributeIndices : [],
      thresholds: v ? (v.arThresholdSelector || []).map(ref) : [], passivePower: v ? ref(v.snoPassivePower) : null,
      skillTags: v ? (v.arSkillTags || []).map(gbName).filter(Boolean) : [],
    });
  }
  for await (const [id, name, v] of groupMetas(108)) {
    const s = Sx("ParagonBoard", name);
    const w = v ? v.nWidth : 0;
    const grid: (string | null)[][] = [];
    if (v && w) for (let i = 0; i < v.arEntries.length; i += w) grid.push(v.arEntries.slice(i, i + w).map((x: any) => (x ? x.name : null)));
    const cls = (name.match(/Paragon_(Barb|Druid|Necro|Rogue|Sorc|Spirit|Paladin|Pala|Warlock|Lock)/i) || [])[1];
    boards.push({
      sno: id, id: name, name: s.Name || null, classHint: cls || null, width: w, height: grid.length, grid,
      nodeSnos: v ? [...new Set((v.arEntries || []).filter(Boolean).map((x: any) => x.sno))] : [],
    });
  }
  for await (const [id, name, v] of groupMetas(112)) {
    const s = Sx("ParagonGlyphAffix", name);
    glyphAffixes.push({ sno: id, id: name, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s, data: v || null });
  }
  const gaById = new Map(glyphAffixes.map((g) => [g.sno, g]));
  for await (const [id, name, v] of groupMetas(111)) {
    const s = Sx("ParagonGlyph", name);
    glyphs.push({
      sno: id, id: name, name: s.Name || null, strings: s, rarity: v ? v.eRarity : null,
      classes: v ? classesOf(v.fUsableByClass) : [],
      affixes: v ? (v.arAffixes || []).filter(Boolean).map((a: any) => ({ sno: a.sno, id: a.name, desc: gaById.get(a.sno)?.desc || null })) : [],
    });
  }
  for await (const [id, name, v] of groupMetas(124)) thresholds.push({ sno: id, id: name, strings: S("ParagonThreshold", name), data: v });
  await writeJson("paragon.json", {
    build: build.version, generated: new Date().toISOString(),
    counts: { boards: boards.length, nodes: nodes.length, glyphs: glyphs.length, glyphAffixes: glyphAffixes.length },
    boards, nodes, glyphs, glyphAffixes, thresholds,
  });

  // ---- World: zones, territories, worlds/dungeons, level areas, subzones, events, bosses
  io.progress({ stage: "Reading zones and dungeons" });
  const named = (g: number, prefix: string) =>
    groupEntries(g)
      .map(([id, name]) => {
        const s = S(prefix, name);
        return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || undefined, strings: Object.keys(s).length > 2 ? s : undefined } : null;
      })
      .filter(Boolean) as any[];
  const worlds = named(48, "World").map((w) => ({ ...w, dungeon: /^DGN_/i.test(w.id) || undefined }));
  const quests = groupEntries(31).map(([id, name]) => ({ id, name, s: S("Quest", name) })).filter((q) => q.s && q.s.Name);
  const eventType = (n: string) =>
    /WorldBoss/i.test(n) ? "world_boss" : /Legion/i.test(n) ? "legion" : /Helltide/i.test(n) ? "helltide"
      : /^WE_/i.test(n) ? "world_event" : /^DE_/i.test(n) ? "dynamic_event" : /^LE_/i.test(n) ? "local_event" : /Bounty/i.test(n) ? "bounty"
        : /ZoneEvent/i.test(n) ? "zone_event" : null;
  const events = quests.map((q) => ({ sno: q.id, id: q.name, name: q.s!.Name, type: eventType(q.name) })).filter((e) => e.type);
  const dungeonAffixes = groupEntries(135)
    .map(([id, name]) => {
      const s = S("DungeonAffix", name);
      return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s } : null;
    })
    .filter(Boolean) as any[];
  await writeJson("world.json", {
    build: build.version, generated: new Date().toISOString(),
    zones: named(158, "Zone"), territories: named(92, "Territory"), subzones: named(80, "Subzone"),
    worlds, dungeons: worlds.filter((w) => w.dungeon), levelAreas: named(22, "LevelArea"),
    events, dungeonAffixes, communityModifiers: named(162, "CommunityModifier"),
    worldStates: named(86, "WorldState"),
  });

  // ---- Monsters / bosses
  io.progress({ stage: "Reading monsters and bosses" });
  const actorNames: any[] = [];
  for (const [name, s] of Object.entries(stl)) {
    if (!name.startsWith("Actor_") || !s.Name) continue;
    const aid = name.slice(6);
    let sno: number | null = null;
    for (const [i, n] of toc.byGroup[1] || new Map()) if (n === aid) { sno = i; break; }
    actorNames.push({
      sno, id: aid, name: s.Name, flavorName: s.FlavorName || undefined,
      boss: /boss/i.test(aid) || undefined, worldBoss: (/^WorldBoss_/i.test(aid) && !!s.FlavorName) || undefined,
    });
  }
  const monsterAffixes = groupEntries(107)
    .map(([id, name]) => {
      const s = S("MonsterAffix", name);
      return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || undefined, strings: s } : null;
    })
    .filter(Boolean) as any[];
  const monsterFamilies = named(82, "MonsterFamily");
  const gbMonsterNames = Object.values(gbTables[7]?.names || {});
  await writeJson("monsters.json", {
    build: build.version, generated: new Date().toISOString(),
    bosses: actorNames.filter((a) => a.boss || a.worldBoss), actors: actorNames, monsterFamilies, monsterAffixes,
    monsterNameTable: gbMonsterNames,
  });

  // ---- Seasonal powers, skills index
  const collectiblePowers = groupEntries(151)
    .map(([id, name]) => {
      const s = S("CollectiblePower", name);
      return s ? { sno: id, id: name, name: s.Name || null, desc: s.Desc || null, descPlain: plain(s.Desc), strings: s } : null;
    })
    .filter(Boolean) as any[];
  const powers: any[] = [];
  for (const [name, s] of Object.entries(stl)) {
    if (!name.startsWith("Power_") || (!(s as any).name && !s.Name)) continue;
    const pid = name.slice(6);
    let sno: number | null = null;
    for (const [i, n] of toc.byGroup[29] || new Map()) if (n === pid) { sno = i; break; }
    powers.push({ sno, id: pid, name: (s as any).name || s.Name, desc: (s as any).desc || s.Desc || null, strings: s });
  }
  await writeJson("powers.json", { build: build.version, generated: new Date().toISOString(), skills: powers, seasonalPowers: collectiblePowers });

  // ---- GBID tables useful to the app
  const pick = (t: number) => Object.values(gbTables[t]?.names || {}).sort();
  await writeJson("gbid.json", {
    build: build.version,
    note: "GameBalance name tables (eGameBalanceType -> names). Hash = djb2(lowercase(name)).",
    tables: Object.fromEntries(Object.entries(gbTables).map(([t, v]) => [t, { files: v.files, count: Object.keys(v.names).length }])),
    affixFamilies: pick(18), skillTags: pick(56), itemFamilies: pick(122), affixTags: pick(125), currencies: pick(59),
    talismanItemTags: pick(104), difficultyTiers: pick(88), keyedDungeonTypes: pick(78),
  });

  // ---- manifest
  const manifest = {
    build, definitionsBuild,
    generated: new Date().toISOString(), seconds: Math.round((Date.now() - t0) / 1000),
    casc: cascStats, rawBytes: await io.rawBytes(),
    counts: {
      stringLists: Object.keys(stl).length, strings: stringCount, affixes: affixes.length, aspects: aspects.length,
      items: items.length, uniques: uniques.length, gems: gems.length, runes: runes.length, charms: charms.length,
      setBonuses: setBonuses.length, paragonBoards: boards.length, paragonNodes: nodes.length, glyphs: glyphs.length,
      glyphAffixes: glyphAffixes.length, worlds: worlds.length, dungeons: worlds.filter((w) => w.dungeon).length,
      events: events.length, dungeonAffixes: dungeonAffixes.length, actorsNamed: actorNames.length,
      bosses: actorNames.filter((a) => a.boss || a.worldBoss).length, skills: powers.length,
      seasonalPowers: collectiblePowers.length,
    },
    stringFiles: stringFileStats, parseErrors: failures.length, readerSoftErrors: mr.errors,
    encryptedSnosInBuild: Object.keys(encryptedSnos).length,
  };
  await writeJson("manifest.json", manifest);
  if (failures.length && keep("parse-errors.txt")) await io.write("parse-errors.txt", failures.join("\n") + "\n");

  return { build, docs, strings: stl, toc, definitions, snoGroupNames, encryptedSnos, manifest, failures };
}

async function mustRead(io: GameDataIO, rel: string) {
  const b = await io.read(rel);
  if (!b) throw new Error(`missing ${rel} in the game data copy`);
  return b;
}
