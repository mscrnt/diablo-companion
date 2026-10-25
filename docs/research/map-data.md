# World-map coordinates from the game data (spike)

Status: **shipping**. Verified on builds 3.2.2.73764 and 3.2.3.73883, game files read-only (CASC copy
via `cascx.exe`). The game does not need to be running. No map art or textures are read or shipped.
We only ship coordinates.

- Extractor: `src/lib/gamedata/extractMap.ts` writes `map.json` (1,668 entries plus 90 territory outlines),
  as part of the reader the app runs on the player's own install and `tools/datamine/extract.mjs` runs from a terminal.
- Slim app copy: `src/lib/gamedata/gen.ts` `genMapPois()` (1,414 POIs, 142 KB), built in the same read.
- Schema: `data/gamedata/README.md`, section `map.json`.

## Result

All positions are in overworld world units (World SNO 69068 `Sanctuary_Eastern_Continent`). Region is the Zone.

| kind | Scosglen | Fractured Peaks | Dry Steppes | Kehjistan | Hawezar | Nahantu | Skovos | total |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| waypoint | 8 | 7 | 8 | 6 | 6 | 6 | 9 | 50 |
| altar (Altar of Lilith) | 34 | 28 | 33 | 31 | 34 |  |  | **160** |
| tenet_of_akarat |  |  |  |  |  | 30 |  | 30 |
| chronicle_of_creation |  |  |  |  |  |  | 30 | 30 |
| journal (S15 Deckard's Journal) | 3 | 2 | 1 | 3 | 1 |  |  | **10** |
| stronghold | 3 | 3 | 3 | 3 | 3 | 3 | 3 | 21 |
| dungeon | 25 | 23 | 21 | 23 | 23 | 20 | 12 | 147 |
| cellar | 24 | 27 | 23 | 28 | 30 | 32 | 20 | 184 |
| quest_dungeon | 6 | 12 | 15 | 10 | 15 | 18 | 37 | 113 |
| campaign_dungeon | 7 | 8 | 7 | 2 | 9 | 12 | 26 | 71 |
| boss_dungeon |  | 2 | 1 | 6 | 2 | 2 | 1 | 14 |
| undercity |  |  |  |  |  | 9 | 9 | 18 |
| seasonal (S15 rifts etc.) | 5 | 4 | 1 | 20 | 6 |  |  | 36 |
| activity / secret / portal | 4 | 4 | 1 | 12 | 2 | 3 | 8 | 34 |
| side_quest (approx.) | 43 | 39 | 33 | 40 | 48 | 43 | 44 | 290 |
| helltide_chest (spawn points) | 63 | 45 | 76 | 79 | 56 | 55 | 86 | 460 |

Compared with the known counts:
- **Altars: 160** (28 to 34 per region), as expected.
- **Journals: 10/10**, each in the place the fan list names (see below).
- **Strongholds: 21.** That is the 15 base-game strongholds (3 per region, including Crusaders' Monument, whose quest is `Camp_Hawe_CrusadersMont`, not `CMP_`), plus 3 in Nahantu and 3 in Skovos.

Nahantu and Skovos have no Altars of Lilith. Their hidden-cache collectibles are "Tenet of Akarat" (Nahantu) and "Chronicles of Creation" (Skovos), 30 each.

## Data structures and transforms

### 1. `Global` SNO `global_markers` (group 21, id 332242): the main source
`GlobalDefinition.ptContent[0]` is a `GlobalWaypointData`. It holds `arGlobalMarkerActors[]` (3,260 entries, 3,117 of them in the overworld). Each `GlobalMarkerActor` has:

| field | meaning |
|---|---|
| `snoWorld`, `tWorldTransform` (`PRTransform { q: quat, wp: vec3 }`) | **world-space** position, already composed by the game's tools |
| `snoActor`, `eActorType`, `eGizmoType` | what is placed |
| `snoLevelArea`, `arSubzones[]`, `snoFogOfWar` | where it is |
| `snoMarkerSet`, `szMarkerName`, `dwMarkerPathID` | where the source marker lives |
| `ptData[]` (polymorphic) | `GlobalMarkerActorWaypointData` (waypoint), `GlobalMarkerActorHiddenCacheData { gbidHiddenCache }` (altars and other collectibles), `GlobalMarkerActorPortalData { snoSpecifiedWorld, snoPortalDestSubzone, gbidDungeonArchetype, fHiddenMapIcon, ... }` (dungeon and cellar entrances), `GlobalMarkerActorPortalDestData` (arrival points) |

This is the list the game uses for map icons, so no transform composition is needed for:
- **Waypoints.** The name is the `LevelArea_<id>` string, for example "Kyovashad".
- **Altars and other hidden caches.** Each has a unique `gbidHiddenCache` (GameBalance type 28), for example `LostCache_Scos_Downs_01`. That is a ready-made stable key for a collectibles tracker.
- **Dungeon and cellar entrances.** The kind comes from `gbidDungeonArchetype` (GameBalance type 90): `SideDungeonDefault` is a dungeon, `WorldCellar*` is a cellar, then `QuestDungeon`, `CampaignDungeon`, `BossDungeon`, `Undercity`, `S15_*` and so on. The name is `World_<destination world>`, for example "Oldstones" or "Arid Tunnel".

### 2. MarkerSets (group 24): journals and Helltide chest spawn points
`MarkerSetDefinition.tMarkerSet[]` is `Marker { nID, eType, transform: PRTransform, snoname: DT_SNO_NAME, vecScale, ptBase: polymorphic[] }`. `ptBase` holds `MarkerActorData` (actor placements), `MarkerSpawnLocData { gbidSpawnLocType }` (`eType` 50, spawn locations), `MarkerPrefabData` (nested MarkerSet prefab), `MarkerEncounterData`, and others.

Two kinds of marker set are relevant. Both were verified against the world transforms in `global_markers`:
- **Subzone layers, `"<Subzone> (<layer>)"`** (2,196 for the 100 overworld subzones). Their marker positions are **already in world space**. Together with the scene sets, 1,766 of 1,818 actors that also appear in `global_markers` match to less than 0.05 units. `SubzoneDefinition.arWorldMarkerSets` lists most layers but not all: the S15 layers, such as `Kehj_Gea_Kul (S15_DeckardsJourney)`, are only referenced from quest data. The extractor therefore selects layers by name.
- **Scene sets, `"<Scene> (Game)"`** (1,219). Their positions are **scene-local**. World = `SceneChunk.transform.wp + marker.wp`, where the chunks come from `WorldDefinition.ptServerData[0].ptSceneChunks`: 1,220 scenes on a 96-unit grid, all with identity rotation. This was verified on every global marker that comes from a scene set (6/6 exact).
- The 52 mismatches above are actors that sit inside a nested prefab (`MarkerPrefabData`, a marker whose `snoname` is another MarkerSet) or in a different phase copy. Prefab nesting is **not** resolved. Nothing we export needs it.

**Format-hash caveat.** In build 3.2.2 the MarkerSet format hash (`0xbac788ed`) has no match in the d4data definitions for 3.2.1 (`MarkerSetDefinition` there is `0x6f3b560e`; `Actor` changed too). `MetaReader.parseMeta` now takes `asType`, which falls back to the older layout only when the hash is unknown. Results across all 3,415 overworld marker sets:
- 168,980 markers parsed with 0 reader soft errors
- 1,766 transforms match exactly against `global_markers`
- every Deckard's Journal and altar lands where expected

So the change is outside the fields we read. Re-check after `--update-defs` once d4data publishes 3.2.2 definitions.

### 3. Quests (group 31): strongholds and side quests
`QuestDefinition` has `vecStartLocation` and `snoWorldStartLocation` (with `tMarkerHandleStartLocation`), plus a designer `vecDevStartLocation` and `snoWorldDevStartLocation`.
- **Strongholds:** quests named `CMP_*` or `Camp_*` with a `Quest_<id>.Name` and an overworld `vecStartLocation`. The position is exact.
- **Side quests:** `eQuestType 0`, `ePlayerQuestType 0`, `fPrioritySideQuest false`, with an overworld `vecDevStartLocation`. That gives 290, plus 24 without a position. This is the **designer start location, not the NPC itself**, so these entries carry `precision: "approx"`. Spot checks put it in the right place: "A Pound of Flesh" is at the Onyx Watchtower, "Corroding Mettle" at Ked Bardu, "A Sodden Pact" on the Abandoned Coast near Marowen.

### 4. Region, territory, level area
- **Territory:** the smallest named polygon in `WorldDefinition.arRegionBoundaries` (90 `TerritoryRegionBoundary { snoTerritory, arPoints }`) that contains the point, for example `Scosglen_Downs` "The Downs".
- **Region:** the territory's Zone, through `SubzoneDefinition { snoTerritory, snoZoneParent }`. If that fails, the subzone, or the name prefix (Scos, Frac, Step, Kehj, Hawe, Naha, Skov).
- The territory outlines are exported in `map.json.territories`. They are enough to draw a vector base map without any game art.

## Sanity checks

- **Altars:** 160/160 have a region (from the territory polygon) that agrees with the region in their own cache name (`LostCache_<Region>_...`). These are two independent sources.
- **Waypoints:** the per-region centroids sit where the regions are on the map: Scosglen (-1755,-652), Fractured Peaks (-1320,191), Dry Steppes (-775,-630), Kehjistan (167,-398), Hawezar (-749,720), Nahantu (856,281), Skovos (2588,-704). Only 3 of 50 waypoints are closer to another region's centroid, and all are genuine border or island spots: Jirandai (east edge of the Steppes), Kichuk (Nahantu's gate to Hawezar) and Bovine Sanctum (the cow-level island, zone Skovos, outside every territory polygon).
- **Journals.** Part numbers come from the order of the 10 "interact with marker" callbacks in quest `S15_DeckardsJourney_Hidden`. The conversation and item SNOs are numbered 01..10, but the quest does not link a marker to a number explicitly. The order matches the fan list exactly, and every location matches:

| part | world x, y | territory | nearest waypoint | fan-site location |
|---:|---|---|---|---|
| 1 | 718.5, -465.7 | Southern Expanse | Gea Kul (680,-418), 61 u | Gea Kul |
| 2 | 113.8, -510.5 | Caldeum | Imperial Library (103,-518), 13 u | Imperial Library, Caldeum |
| 3 | -566.4, 47.1 | Scouring Sands | Tarsarak | a ridge in the Kehjistan desert |
| 4 | -853.3, 358.6 | Dismal Foothills | Wejinhani (-839,358), 14 u | Wejinhani |
| 5 | -1172.2, 129.2 | Desolate Highlands | Nevesk (-1000,133) | Lorath's cabin, southern Taiga |
| 6 | -869.7, -437.7 | Jakha Basin | Hidden Overlook (-935,-380) | Jakha Basin, Dry Steppes |
| 7 | -1691.3, -1266.2 | Northshore | Marowen (-1734,-1199), 80 u | Marowen |
| 8 | -1987.0, -789.0 | Wailing Hills | Braestaig (-1857,-816) | Dead Valley, the Hills |
| 9 | -1877.6, -312.9 | The Downs | Under the Fat Goose Inn | Oldstones, the Downs |
| 10 | -1419.8, 468.6 | Gale Valley | Yelesna (-1378,556) | Illusion Woods, Gale Valley |

- **Strongholds:** the quest start positions are next to their waypoints: Nostrava (-1115,-15) and waypoint (-1111,-12); Vyeresz (-504,892) and (-480,894); Altar of Ruin (-38,-720) and (-32,-697).
- **Projection:** see below. 3,109/3,109 markers fall inside their fog-of-war tile.

**Confidence:**
- High for global-marker kinds (waypoints, altars, collectibles, dungeon and cellar entrances), journals and strongholds. These are the game's own world transforms, cross-checked two ways.
- Medium for side quests, which are approximate by design.
- Helltide chests are spawn **candidates**, not live spawns. The server picks a subset each Helltide.

## Map projection (world to the zone-map UI)

From `WorldDefinition.tZoneMapParams` and `flGridSize`:
- `flZoneArtScale` = 2/3
- `vecZoneArtCenter` = (2560, 2212)
- `nGridSystemZoneMapFieldWidth/Height` = 64, with `flGridSize` = 96, so the map square spans 64 × 96 = **6144 world units**
- 6144 × 2/3 = **4096 px** of map art

The map is the world rotated 45°:

```
u = 2560/4096 + (y - x) / (6144·√2)      v = 2212/4096 + (x + y) / (6144·√2)      (0..1 over the map art)
```

**Validation.** `tZoneMapParams.arFogOfWar[]` (430 entries) gives each fog-of-war texture's `vecWorldOffset` and `vecWorldSize` in the same 0..1 space. For every overworld global marker that names a fog-of-war tile, its (u, v) falls inside that tile: **3,109 / 3,109**. A free affine fit converges to the same thing: 45.0° rotation and 6,150 / 6,133 units per map side. `u` and `v` are written per entry in `map.json`.

**Settled (in-game captures, `src/lib/mappins.ts`):** the map UI draws the art unrotated and unmirrored: screen-right is +u, screen-down is +v, screen px = s·(u, v) + t. The zoom levels are discrete; at 1440p s ≈ 2793, 4530, 8490 and about 13450 and 20300 (s / image height 1.94, 3.15, 5.90, 9.34, 14.1). The note below is the pre-capture reasoning.

**Overlay notes (from in-game sessions, `src/lib/mappins.ts`):**
- **Viewport.** The map fills the game image between the dark nav bar (top 5.8 % of the height) and the hint bar (bottom 5.6 %). A dark neutral-grey side panel sits on the right edge, collapsed about 0.07 of the height wide from 15 % to 85 % of the height, with a round red collapse tab sticking out of it at mid height (46 % to 57 %). Dark map art is brown or red, so the panel can be told apart by colour. HUD boxes drawn over the map: the season header, the seasonal progress bar and the event panel.
- **Closest zoom.** At 14.1 only one to three waypoints are in view, too few to register from scratch. Since the zoom levels are discrete, a zoomed-in view shrunk by the ladder ratio is a patch of the earlier zoomed-out view: masked normalised cross-correlation (FFT) finds it, and the waypoints and dungeon icons in view confirm it. On the test session (zooming from 1.94 straight to 14.1 and panning around), 23 of 26 closest-zoom frames register, all correct. The rest are an empty stretch of sea and frames mid zoom animation.
- **Found altars.** Found altars get an icon (a grey glyph with a black outline, centred about 3 px above the spot at 720 p). Tenets and Chronicles get a narrow grey statue. Unfound ones show nothing. Zoomed out to 1.94 they are tiny dots.
- **Is the map still open?** The nav bar's labels and its red active-tab highlight make a stable signature. It changes when another tab is picked or the menu closes, and also in a dark scene that passes a simple "dark rows" test.

**Not settled: screen orientation.** Geography says screen-right is about +(x+y) (that is, +v) and screen-up is about +(y−x) (+u). Scosglen comes out west, Fractured Peaks north, Hawezar north-east and Kehjistan south-east. The map UI may therefore draw the art rotated or flipped relative to texture UV. The overlay should not assume it: an affine fit against detected waypoints absorbs it.

No map texture was read. The `snoMagMaxBoxMap` texture SNO is named in the data, but its meta is not under `base:meta` and we don't need it.

## What didn't work or isn't covered

- **Prefab nesting** (`MarkerPrefabData`, about 7.4k markers that reference other MarkerSets) is not followed, so props and actors that exist only inside prefabs are missing. No exported kind depends on it. Following it means a recursive copy of the referenced MarkerSets, composing `parent.wp + rotate(parent.q, scale ⊙ child.wp)`.
- **Exact side-quest giver NPCs.** Quest data names the start via a designer location and phase callbacks (interact-with-marker handles into the quest's own layer), not via a "giver" field. Resolving the first callback's marker handle would pin the NPC for many quests. That is the next refinement.
- **Live state.** Season gating (`snoCampaignEnableCondition` on the S15 layers), phasing conditions and which Helltide chest spawns are active are runtime or server state.
- **Other worlds** (Hell, Undercity, Mercenary hideout, S03 hub, Tristram (S15); 143 global markers) are skipped. Their coordinates are in their own world space.
- **Events, world-boss arenas, bounty pins** (`Bounty_Pin`, 552 markers) are not exported yet. All are available the same way.

## Next steps

**(a) Pinning on the in-game map**
1. Capture a waypoint-icon template from our own screenshots. We can't ship game textures. Detect icons on the open map with template matching at the current zoom.
2. Fit world (or u, v) to screen with RANSAC over 3 or more detected waypoints. A similarity transform (scale, rotation, translation, optional mirror) should be enough, since the map is an orthographic view. Use the region centroids to seed which waypoints are visible. 50 waypoints over 7 regions give plenty of anchors at every zoom level.
3. Project `map-pois.json` through the fit. Collectibles keep stable ids for the tracker: `LostCache_*` and `HiddenCache_*` caches, `S15_DeckardsJourney_Journal_NN`, and quest or world ids.

**(b) Full map page**
- Use `map.json.territories` (90 outlines) plus region colours as the vector base map. Place POIs by (u, v) or by world coordinates rotated 45°.
- Add filters per kind, tracker checkboxes keyed by `id`, and region and territory labels (`territoryName`).
- Optional: follow prefabs, resolve exact side-quest NPCs, and add events, world bosses and bounty pins.
