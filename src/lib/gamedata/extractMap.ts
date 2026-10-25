// World-map points of interest: map.json.
//
// Runs after extract(): it reuses that raw/ copy (CoreTOC, Subzone, Quest, World and GameBalance
// meta files) and its string lists. It adds the overworld MarkerSet meta files (another read-only
// copy out of CASC) and writes map.json. See data/gamedata/README.md and docs/research/map-data.md.
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

import { gbidHash, MetaReader, type CoreToc, type Definitions } from "./d4meta";
import { pretty, readChunked, type GameDataIO, type StringLists } from "./io";

const OVERWORLD = "Sanctuary_Eastern_Continent";
/** Region key (Zone SNO name) for subzone / territory name prefixes, used when no Subzone maps a territory. */
const PREFIX_ZONE: Record<string, string> = {
  Scos: "Scosglen", Step: "Dry_Steppes", Frac: "Fractured_Peaks", Kehj: "Kehjistan", Hawe: "Hawezar",
  Naha: "Nahantu", Skov: "Skovos",
};
/** gbidDungeonArchetype (GameBalance type 90) -> entry kind. */
const archetypeKind = (a: string | null) =>
  !a ? "portal"
    : a === "SideDungeonDefault" ? "dungeon"
      : /^WorldCellar/.test(a) ? "cellar"
        : a === "QuestDungeon" ? "quest_dungeon"
          : a === "CampaignDungeon" ? "campaign_dungeon"
            : /^(BossDungeon|CapstoneBossDungeon)$/.test(a) ? "boss_dungeon"
              : a === "Undercity" ? "undercity"
                : /^(S\d+_|Seasonal)/.test(a) ? "seasonal"
                  : "activity"; // ThePit, Tower, Slaughterhouse, TrainingGrounds, capstones, ...
/** Hidden-cache collectibles (GlobalMarkerActorHiddenCacheData) by actor name. */
const cacheKind = (actor: string | null) =>
  /^LilithShrine/.test(actor ?? "") ? "altar"
    : /^AkaratShrine/.test(actor ?? "") ? "tenet_of_akarat"
      : /CreationShrine/.test(actor ?? "") ? "chronicle_of_creation" : "hidden_cache";

const BS = String.fromCharCode(92);
const r1 = (v: number) => Math.round(v * 10) / 10;
const polyArea = (pts: { x: number; y: number }[]) => {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a += (pts[j].x + pts[i].x) * (pts[j].y - pts[i].y);
  return Math.abs(a / 2);
};
const inPoly = (x: number, y: number, pts: { x: number; y: number }[]) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if (a.y > y !== b.y > y && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) c = !c;
  }
  return c;
};

export interface ExtractMapOpts {
  io: GameDataIO;
  /** `.build.info` version, or null when the install is not readable any more */
  build: string | null;
  strings: StringLists;
  toc: CoreToc;
  definitions: Definitions;
  snoGroupNames: Record<number, string>;
  encryptedSnos: Record<number, unknown>;
  skipCasc?: boolean;
  keep?: (rel: string) => boolean;
}

export async function extractMap({
  io, build, strings, toc, definitions, snoGroupNames, encryptedSnos, skipCasc = false, keep = () => true,
}: ExtractMapOpts): Promise<any> {
  const t0 = Date.now();
  const gbid: Record<number, Record<number, string>> = {};
  const mr = new MetaReader({ definitions, toc, snoGroupNames, encryptedSnos, gbid });
  const nameOf = (id: number) => (toc.byId.get(id) || ([] as unknown as [number, string]))[1];
  const snoByName = (g: number, name: string) => {
    for (const [id, n] of toc.byGroup[g] || []) if (n === name) return id;
    return null;
  };
  const failures: string[] = [];
  const metaPath = (id: number) => "base/meta/" + id;
  const parse = (id: number, buf: Uint8Array | null, asType: string | null = null) => {
    if (!buf) return null;
    try {
      return mr.parseMeta(buf, { asType });
    } catch (e) {
      failures.push(`${id} ${nameOf(id)}: ${(e as Error).message}`);
      return null;
    }
  };
  const meta = async (id: number | null, asType: string | null = null) => (id == null ? null : parse(id, await io.read(metaPath(id)), asType));

  // ---- strings (extract()'s output)
  const S: StringLists = strings;
  const sName = (prefix: string, id: string | null | undefined) => (id && S[prefix + "_" + id] && S[prefix + "_" + id].Name) || null;
  const clean = (s: unknown): any => (s == null ? s : String(s).replace(/\{[^}]*\}/g, "").split(/\r?\n/)[0].trim());

  // ---- GameBalance name tables (dungeon archetypes, spawn-location types, hidden caches)
  io.progress({ stage: "Reading the map's tables" });
  for await (const [[id], buf] of readChunked(io, [...(toc.byGroup[20] || [])], ([id]) => metaPath(id))) {
    const v = parse(id, buf);
    if (!v) continue;
    for (const e of (v.ptData && v.ptData[0] && v.ptData[0].tEntries) || []) {
      const n = e && e.tHeader && e.tHeader.szName;
      if (typeof n === "string" && n) (gbid[v.eGameBalanceType] ??= {})[gbidHash(n)] = n;
    }
  }
  const gbName = (x: any) => (x ? x.name || (gbid[x.group] && gbid[x.group][x.gbid]) || null : null);

  // ---- world, scene chunks, subzones
  const WORLD_SNO = snoByName(48, OVERWORLD);
  const world = await meta(WORLD_SNO);
  if (!world || !world.ptServerData || !world.ptServerData[0]) throw new Error("overworld World meta missing or without server data");
  const server = world.ptServerData[0];
  const chunks: any[] = server.ptSceneChunks || [];
  const chunkByScene = new Map<string, any>(chunks.map((c) => [c.snoname.name, c]));
  if (chunks.some((c) => c.transform.q.x || c.transform.q.y || c.transform.q.z))
    console.warn("[map] rotated scene chunks; scene-local markers ignore rotation");

  interface SubzoneInfo { sno: number; name: string; world: string; zone: string; territory: string; layers: number[] }
  const subzones = new Map<number, SubzoneInfo>();
  const subzoneByName = new Map<string, SubzoneInfo>();
  const subzoneOfLevelArea = new Map<number, SubzoneInfo>();
  const zoneOfTerritory = new Map<string, string>();
  for await (const [[id, name], buf] of readChunked(io, [...(toc.byGroup[80] || [])], ([id]) => metaPath(id))) {
    const v = parse(id, buf);
    if (!v) continue;
    const info: SubzoneInfo = {
      sno: id, name,
      world: v.snoPrimaryWorld && v.snoPrimaryWorld.name,
      zone: v.snoZoneParent && v.snoZoneParent.name,
      territory: v.snoTerritory && v.snoTerritory.name,
      layers: (v.arWorldMarkerSets || []).filter((e: any) => e.snoMarkerSet).map((e: any) => e.snoMarkerSet.sno),
    };
    subzones.set(id, info);
    subzoneByName.set(name, info);
    if (info.world === OVERWORLD) {
      for (const la of v.arLevelAreas || []) if (la && !subzoneOfLevelArea.has(la.sno)) subzoneOfLevelArea.set(la.sno, info);
      if (info.territory && info.zone && !zoneOfTerritory.has(info.territory)) zoneOfTerritory.set(info.territory, info.zone);
    }
  }
  const zoneFromPrefix = (n: string | null | undefined) => (n ? PREFIX_ZONE[String(n).split("_")[0]] || null : null);

  // territory polygons (World.arRegionBoundaries); prefer the smallest named polygon containing a point
  const regions = (world.arRegionBoundaries || [])
    .filter((r: any) => r.snoTerritory && r.arPoints && r.arPoints.length > 2)
    .map((r: any) => ({ id: r.snoTerritory.name, name: sName("Territory", r.snoTerritory.name), pts: r.arPoints, area: polyArea(r.arPoints) }))
    .sort((a: any, b: any) => a.area - b.area);
  const territoryAt = (x: number, y: number) =>
    regions.find((r: any) => r.name && inPoly(x, y, r.pts)) || regions.find((r: any) => inPoly(x, y, r.pts)) || null;

  // ---- overworld MarkerSets: subzone layers (world space) + scene "(Game)" sets (scene-local)
  const owSubzoneNames = new Set([...subzones.values()].filter((s) => s.world === OVERWORLD).map((s) => s.name));
  interface MarkerSet { sno: number; name: string; base: string; layer: string; chunk: any; markers?: any[] }
  const markerSets: MarkerSet[] = [];
  for (const [id, name] of toc.byGroup[24] || []) {
    const m = name.match(/^(.*?) \((.*)\)$/);
    if (!m) continue;
    if (owSubzoneNames.has(m[1])) markerSets.push({ sno: id, name, base: m[1], layer: m[2], chunk: null });
    else if (m[2] === "Game" && chunkByScene.has(m[1])) markerSets.push({ sno: id, name, base: m[1], layer: m[2], chunk: chunkByScene.get(m[1]) });
  }
  const globalSno = snoByName(21, "global_markers");
  const present = new Set(await io.list("base/meta"));
  const need = [globalSno, WORLD_SNO, ...markerSets.map((m) => m.sno)].filter((id) => id != null && !encryptedSnos[id] && !present.has(String(id))) as number[];
  if (need.length && !skipCasc) {
    io.progress({ stage: "Copying the map's data files", done: 0, total: need.length });
    await io.casc(need.map((id) => "base:meta" + BS + id), "list");
  }

  // ---- parse MarkerSets
  io.progress({ stage: "Reading the world map", done: 0, total: markerSets.length });
  const fb0 = mr.formatFallbacks, soft0 = mr.errors;
  const msBySno = new Map<number, MarkerSet>();
  let markerCount = 0;
  let seen = 0;
  for await (const [ms, buf] of readChunked(io, markerSets, (m) => metaPath(m.sno))) {
    if (++seen % 2000 === 0) io.progress({ stage: "Reading the world map", done: seen, total: markerSets.length });
    const v = parse(ms.sno, buf, "MarkerSetDefinition");
    if (!v) continue;
    ms.markers = v.tMarkerSet || [];
    markerCount += ms.markers!.length;
    msBySno.set(ms.sno, ms);
  }
  const markerFormatFallbacks = mr.formatFallbacks - fb0;
  const worldPos = (ms: MarkerSet, m: any) => {
    const p = m.transform.wp,
      o = ms.chunk ? ms.chunk.transform.wp : { x: 0, y: 0, z: 0 };
    return { x: p.x + o.x, y: p.y + o.y, z: p.z + o.z };
  };

  // ---- entries
  const entries: any[] = [];
  const add = (e: any) => {
    const t = territoryAt(e.x, e.y);
    const sub = e.subzone ? subzoneByName.get(e.subzone) : null;
    const region =
      (t && (zoneOfTerritory.get(t.id) || zoneFromPrefix(t.id))) ||
      (sub && sub.zone) ||
      zoneFromPrefix(e.subzone) ||
      zoneFromPrefix(String(e.key || "").replace(/^(CMP|Camp|QST)_/, "")) ||
      null;
    entries.push({
      kind: e.kind, name: e.name, key: e.key,
      region, regionName: region ? sName("Zone", region) : null,
      territory: t ? t.id : null, territoryName: t ? t.name : null,
      subzone: e.subzone || null, levelArea: e.levelArea || null, levelAreaName: e.levelArea ? sName("LevelArea", e.levelArea) : null,
      x: r1(e.x), y: r1(e.y), z: e.z == null ? null : r1(e.z), precision: e.precision || "exact",
      ...e.ids,
      ...(e.extra ? { extra: e.extra } : {}),
    });
  };

  // global markers
  const gm = await meta(globalSno);
  const globals: any[] = gm ? gm.ptContent.flatMap((c: any) => c.arGlobalMarkerActors || []) : [];
  let gmOther = 0;
  for (const g of globals) {
    if (!g.snoWorld || g.snoWorld.name !== OVERWORLD) {
      gmOther++;
      continue;
    }
    const p = g.tWorldTransform.wp;
    const actor = g.snoActor ? g.snoActor.name : null;
    const base = { x: p.x, y: p.y, z: p.z, levelArea: g.snoLevelArea && g.snoLevelArea.name, subzone: g.arSubzones && g.arSubzones[0] && g.arSubzones[0].name };
    const ids = { actor, actorSno: g.snoActor && g.snoActor.sno, markerSet: g.snoMarkerSet && g.snoMarkerSet.sno, source: "global_markers" };
    for (const d of g.ptData || []) {
      if (d.__type === "GlobalMarkerActorWaypointData") {
        add({ ...base, kind: "waypoint", name: sName("LevelArea", base.levelArea) || base.levelArea, key: base.levelArea, ids });
      } else if (d.__type === "GlobalMarkerActorHiddenCacheData") {
        const cache = gbName(d.gbidHiddenCache);
        add({
          ...base, kind: cacheKind(actor), name: clean(sName("Actor", actor)) || actor,
          key: cache || `${actor}@${Math.round(p.x)},${Math.round(p.y)}`, ids: { ...ids, hiddenCache: cache },
        });
      } else if (d.__type === "GlobalMarkerActorPortalData") {
        const arch = gbName(d.gbidDungeonArchetype);
        const dest = d.snoSpecifiedWorld && d.snoSpecifiedWorld.name;
        const destName = sName("World", dest);
        const secret = destName && /^\?+$/.test(destName.trim()); // e.g. the secret cow level portals ("???")
        add({
          ...base, kind: secret ? "secret" : archetypeKind(arch),
          name: (!secret && destName) || (d.snoPortalDestSubzone && d.snoPortalDestSubzone.name) || dest || actor,
          key: dest || actor,
          ids: { ...ids, destWorld: dest, destWorldSno: d.snoSpecifiedWorld && d.snoSpecifiedWorld.sno, destSubzone: d.snoPortalDestSubzone && d.snoPortalDestSubzone.name },
          extra: { archetype: arch, hiddenMapIcon: d.fHiddenMapIcon || undefined, objectiveQuest: d.snoPortalDestObjectiveQuest ? d.snoPortalDestObjectiveQuest.name : undefined },
        });
      }
    }
  }

  // Deckard's Journal (Season 15): part number = order of the marker handles in S15_DeckardsJourney_Hidden
  const journalPart = new Map<string, number>();
  const djq = await meta(snoByName(31, "S15_DeckardsJourney_Hidden"));
  if (djq) {
    let n = 0;
    const walk = (o: any) => {
      if (!o || typeof o !== "object") return;
      if (Array.isArray(o)) {
        o.forEach(walk);
        return;
      }
      if (o.tMarkerHandle && o.tMarkerHandle.snoMarkerSet) {
        const k = o.tMarkerHandle.snoMarkerSet.sno + "#" + o.tMarkerHandle.nID;
        if (!journalPart.has(k)) journalPart.set(k, ++n);
      }
      for (const v of Object.values(o)) walk(v);
    };
    walk(djq.arQuestPhases);
  }
  // Helltide chest spawn locations: spawn-location markers in "<Subzone> (UberSubzone)" layers
  for (const ms of msBySno.values()) {
    const helltide = /^ubersubzone$/i.test(ms.layer);
    for (const m of ms.markers!) {
      if (m.snoname && m.snoname.name === "S15_DeckardsJourney_JournalGizmo") {
        const part = journalPart.get(ms.sno + "#" + m.nID) || null;
        const item = part ? "S15_DeckardsJourney_Journal_" + String(part).padStart(2, "0") : null;
        const p = worldPos(ms, m);
        add({
          ...p, kind: "journal", name: (item && sName("Item", item)) || clean(sName("Actor", m.snoname.name)),
          key: item || `${ms.name}#${m.nID}`, subzone: ms.chunk ? null : ms.base,
          ids: { actor: m.snoname.name, actorSno: m.snoname.sno, markerSet: ms.sno, markerId: m.nID, item, itemSno: item ? snoByName(73, item) : null, source: "markerset" },
          extra: { part, partSource: part ? "S15_DeckardsJourney_Hidden callback order" : undefined },
        });
      }
      if (helltide && m.eType === 50)
        for (const b of m.ptBase || []) {
          const t = b.__type === "MarkerSpawnLocData" ? gbName(b.gbidSpawnLocType) : null;
          if (!t || !/^UberSubzone_Chest/.test(t) || /Guardian/.test(t)) continue;
          const p = worldPos(ms, m);
          add({
            ...p, kind: "helltide_chest", name: "Helltide chest spawn point", key: `${ms.name}#${m.nID}`, subzone: ms.base,
            ids: { markerSet: ms.sno, markerId: m.nID, source: "markerset" },
            extra: { spawnLocType: t, tier: (t.match(/_(t\d)$/) || [])[1] || t.replace(/^UberSubzone_Chest_?/, "") || null },
          });
        }
    }
  }

  // Quests: strongholds (exact start location) and side quests (designer start location, approximate)
  let sideNoPos = 0;
  const questEntries = [...(toc.byGroup[31] || [])].filter(([, name]) => /^(CMP|Camp)_/.test(name) || /^QST_/.test(name));
  for await (const [[id, name], buf] of readChunked(io, questEntries, ([id]) => metaPath(id))) {
    const isCamp = /^(CMP|Camp)_/.test(name);
    const v = parse(id, buf);
    if (!v) continue;
    const title = sName("Quest", name);
    if (!title || /^\[PH\]/.test(title)) continue;
    const la = v.snoLevelArea && v.snoLevelArea.name;
    const sub = v.snoLevelArea ? subzoneOfLevelArea.get(v.snoLevelArea.sno) : null;
    if (isCamp) {
      const p = v.vecStartLocation,
        w = v.snoWorldStartLocation;
      if (!w || w.name !== OVERWORLD || !p || (!p.x && !p.y)) continue;
      add({ ...p, kind: "stronghold", name: title, key: name, levelArea: la, subzone: sub && sub.name, ids: { quest: name, questSno: id, source: "quest.vecStartLocation" } });
    } else if (v.eQuestType === 0 && v.ePlayerQuestType === 0 && !v.fPrioritySideQuest) {
      const p = v.vecDevStartLocation,
        w = v.snoWorldDevStartLocation;
      if (!w || w.name !== OVERWORLD || !p || (!p.x && !p.y)) {
        sideNoPos++;
        continue;
      }
      add({ ...p, kind: "side_quest", name: title, key: name, levelArea: la, subzone: sub && sub.name, precision: "approx", ids: { quest: name, questSno: id, source: "quest.vecDevStartLocation" } });
    }
  }

  // ---- de-duplicate: same kind + key within 4 world units (the same actor placed in several phase layers)
  const out: any[] = [];
  const dedup = new Map<string, any[]>();
  for (const e of entries) {
    const k = e.kind + "|" + e.key;
    const list = dedup.get(k) || [];
    const dup = list.find((o) => Math.hypot(o.x - e.x, o.y - e.y) < 4);
    if (dup) {
      dup.layers = (dup.layers || 1) + 1;
      continue;
    }
    list.push(e);
    dedup.set(k, list);
    out.push(e);
  }
  const KIND_ORDER = ["waypoint", "altar", "tenet_of_akarat", "chronicle_of_creation", "hidden_cache", "journal", "stronghold", "dungeon", "cellar",
    "quest_dungeon", "campaign_dungeon", "boss_dungeon", "undercity", "seasonal", "activity", "secret", "portal", "side_quest", "helltide_chest"];
  out.sort(
    (a, b) =>
      KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind) ||
      String(a.region).localeCompare(String(b.region)) ||
      String(a.name).localeCompare(String(b.name)) ||
      a.x - b.x,
  );

  // ---- validation
  // (1) subzone-layer / scene markers vs. the world transforms in global_markers
  let vOk = 0,
    vBad = 0;
  for (const g of globals) {
    const ms = g.snoMarkerSet && msBySno.get(g.snoMarkerSet.sno);
    if (!ms || !g.snoActor || !g.snoWorld || g.snoWorld.name !== OVERWORLD) continue;
    const gw = g.tWorldTransform.wp;
    const c = ms.markers!.filter((m: any) => m.snoname && m.snoname.sno === g.snoActor.sno);
    if (!c.length) continue;
    const best = Math.min(
      ...c.map((m: any) => {
        const p = worldPos(ms, m);
        return Math.hypot(p.x - gw.x, p.y - gw.y, p.z - gw.z);
      }),
    );
    if (best < 0.05) vOk++;
    else vBad++;
  }
  // (2) zone-map projection: every global marker must fall inside its fog-of-war tile
  const zp = world.tZoneMapParams;
  const ART = 4096; // 64 x 96 = 6144 units per map side; x flZoneArtScale (2/3) = 4096 px
  const span = zp.nGridSystemZoneMapFieldWidth * world.flGridSize;
  const k = 1 / (span * Math.SQRT2);
  const cu = zp.vecZoneArtCenter.x / ART,
    cv = zp.vecZoneArtCenter.y / ART;
  const toUV = (x: number, y: number) => ({ u: cu + (y - x) * k, v: cv + (x + y) * k });
  const fow = new Map<number, any>((zp.arFogOfWar || []).filter((f: any) => f.snoFoW).map((f: any) => [f.snoFoW.sno, f]));
  let fIn = 0,
    fAll = 0;
  for (const g of globals) {
    if (!g.snoWorld || g.snoWorld.name !== OVERWORLD || !g.snoFogOfWar) continue;
    const f = fow.get(g.snoFogOfWar.sno);
    if (!f) continue;
    const { u, v } = toUV(g.tWorldTransform.wp.x, g.tWorldTransform.wp.y);
    fAll++;
    if (u >= f.vecWorldOffset.x && u <= f.vecWorldOffset.x + f.vecWorldSize.x && v >= f.vecWorldOffset.y && v <= f.vecWorldOffset.y + f.vecWorldSize.y) fIn++;
  }
  for (const e of out) {
    const { u, v } = toUV(e.x, e.y);
    e.u = Math.round(u * 1e5) / 1e5;
    e.v = Math.round(v * 1e5) / 1e5;
  }
  // (3) altar region (from the territory polygon) vs. the region in its hidden-cache name (LostCache_<Prefix>_...)
  const altars = out.filter((e) => e.kind === "altar");
  const altarAgree = altars.filter((e) => e.hiddenCache && zoneFromPrefix(e.hiddenCache.replace(/^LostCache_/, "")) === e.region).length;
  // (4) waypoints cluster by region: nearest region centroid is the waypoint's own region
  const wps = out.filter((e) => e.kind === "waypoint" && e.region);
  const cent: Record<string, { x: number; y: number; n: number }> = {};
  for (const e of wps) {
    const c = (cent[e.region] ??= { x: 0, y: 0, n: 0 });
    c.x += e.x;
    c.y += e.y;
    c.n++;
  }
  for (const c of Object.values(cent)) {
    c.x /= c.n;
    c.y /= c.n;
  }
  const wpOutliers = wps
    .filter((e) => Object.entries(cent).sort((a, b) => Math.hypot(a[1].x - e.x, a[1].y - e.y) - Math.hypot(b[1].x - e.x, b[1].y - e.y))[0][0] !== e.region)
    .map((e) => `${e.name} (${e.region})`);

  const counts: Record<string, Record<string, number>> = {};
  for (const e of out) {
    (counts[e.kind] ??= { total: 0 }).total++;
    counts[e.kind][e.region || "unknown"] = (counts[e.kind][e.region || "unknown"] || 0) + 1;
  }
  const doc = {
    build,
    generated: new Date().toISOString(),
    source: "Global global_markers + overworld MarkerSets (subzone layers, scene Game sets) + Quest start locations",
    world: { sno: WORLD_SNO, id: OVERWORLD, gridSize: world.flGridSize, sceneChunks: chunks.length, bounds: { minX: server.flMinX, minY: server.flMinY, maxX: server.flMaxX, maxY: server.flMaxY } },
    projection: {
      note: "World X/Y -> zone-map UV (0..1 over the square map art). Derived from WorldDefinition.tZoneMapParams; u/v are included per entry. Screen orientation of the in-game map is not verified: register with an affine fit (waypoints).",
      formula: "u = artCenter.x/artSize + (y - x) / (span*sqrt2);  v = artCenter.y/artSize + (x + y) / (span*sqrt2)",
      span, artSize: ART, artScale: zp.flZoneArtScale, artCenter: zp.vecZoneArtCenter, zoomBreakpoints: zp.arZoomBreakpoints,
      validation: `${fIn}/${fAll} global markers fall inside their fog-of-war tile (arFogOfWar vecWorldOffset/vecWorldSize)`,
    },
    regions: Object.fromEntries(Object.values(PREFIX_ZONE).map((z) => [z, sName("Zone", z)])),
    counts,
    // territory outlines (World.arRegionBoundaries), usable to draw a vector base map without game art
    territories: regions.map((r: any) => ({ id: r.id, name: r.name, region: zoneOfTerritory.get(r.id) || zoneFromPrefix(r.id), points: r.pts.map((p: any) => [r1(p.x), r1(p.y)]) })),
    validation: {
      markerVsGlobal: `${vOk} markers match their global_markers world transform (<0.05 units), ${vBad} differ (actor nested in a prefab / other instance)`,
      markerSets: markerSets.length, markersParsed: markerCount, markerFormatFallbacks, readerSoftErrors: mr.errors - soft0,
      markerSetNote: markerFormatFallbacks
        ? "MarkerSet format hash of this build is newer than definitions.json; parsed with the older MarkerSetDefinition (cross-checked above)"
        : undefined,
      altarRegionVsCacheName: `${altarAgree}/${altars.length}`,
      waypointRegionCentroids: Object.fromEntries(Object.entries(cent).map(([k2, c]) => [k2, { x: r1(c.x), y: r1(c.y), n: c.n }])),
      waypointOutliers: wpOutliers,
      globalMarkers: globals.length, globalMarkersOtherWorlds: gmOther, sideQuestsWithoutPosition: sideNoPos, parseErrors: failures.length,
    },
    entries: out,
  };
  if (keep("map.json")) await io.write("map.json", pretty(doc));
  if (failures.length && keep("map-parse-errors.txt")) await io.write("map-parse-errors.txt", failures.join("\n") + "\n");
  io.progress({ stage: `Map ready (${out.length} places, ${Math.round((Date.now() - t0) / 1000)} s)` });
  return doc;
}
