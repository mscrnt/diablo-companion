# Mobalytics Desktop: how its Diablo 4 support works (investigated 2026-10-09)

Read-only look at the user's installed Mobalytics desktop app, version 1.956.234 (logs show it auto-updated to 1.956.260). Nothing in the install or data folders was changed. No credentials, tokens, cookies or account data were read or copied. All unpacking happened in the session scratchpad.

## TL;DR

- **App type:** **ow-electron**, Overwolf's Electron fork (Electron 42.7.1). Overwolf packages `gep` and `overlay`. It is **not** a classic Overwolf extension. The D4 UI itself is **not bundled**: both windows load the live website, `https://mobalytics.gg/diablo-4` (main window) and `https://mobalytics.gg/diablo-4/overlay/overlay` (overlay window).
- **How it reads game state:** it does **not** use Overwolf GEP for D4. GEP has no D4 features; it is used only to detect when the game starts and exits and to get its pid. Game state comes from **screen OCR**:
  1. A DLL (`moba-cap-client.dll`) is **injected into `Diablo IV.exe`**. It hooks `IDXGISwapChain::Present`/`Present1` and D3D12 `ExecuteCommandLists`, and shares the backbuffer through shared memory/texture.
  2. A native Node addon (`ocr_native.node`, C++/WinRT) runs **Windows.Media.Ocr** on the **whole game frame at native resolution, every 500 ms**. It has a D4-only `maximizeColor` preprocessing option.
  3. Each frame becomes `{width,height,lines:[{text,x,y,w,h}]}`. A frame is dropped if its joined text matches the previous frame.
  4. Frames are stored in `%APPDATA%\Mobalytics\game-events.db` (SQLite, last 10,000 rows) and **uploaded to `https://mobalytics.gg/api/game-data-events`** when the user is signed in.
  5. **The item matching happens on Mobalytics' servers.** The server compares the OCR'd tooltips with the user's "tracked build". Results come back as a `Diablo4BuildTrackerPayload` "signal": a Firestore doc is listened to, then the app runs a GraphQL `SignalsQuery`. The overlay then shows an "Autotracker Notification" (slot, unique/aspect, affixes total/recognized/matched).
- **D4 features:** build/guide/tier-list/loot-filter browsing (website content), "track a build" plus the **Autotracker** (the user hovers equipped items and it checks build items off automatically), and an in-game overlay that holds only the autotracker notifications and a settings widget. The main window can also auto-show when the game launches and move to a second monitor. **No event timers** (world boss, helltide, legion) anywhere in the D4 code.
- **Data:** no D4 game data ships with the app. Everything comes from the public GraphQL API `https://mobalytics.gg/api/diablo4/v4/graphql/query`, which needs no auth for static data and documents. `v1`, the path our `src/lib/mobalytics.ts` uses, still works too.
- **Most useful takeaways for us:**
  - Our current approach (Windows.Media.Ocr plus our own parsing) is the same OCR engine Mobalytics uses.
  - Their `staticDataV2` query with `page:{all:true}` returns every stat, aspect and unique in one request, including `buildSlotsSlugs`/`classesSlugs` per stat. That is a ready-made dictionary for matching OCR text to affixes.
  - **Do not copy the DLL injection.** It is an anti-cheat risk; use Windows.Graphics.Capture or GDI instead.

---

## 1. Location and layout

| What | Path |
|---|---|
| Install | `C:\Users\Kenneth\AppData\Local\Programs\mobalytics-desktop\` (`Mobalytics.exe`, `owutility.dll`, `resources\app.asar` 577 MB) |
| Updater cache | `C:\Users\Kenneth\AppData\Local\mobalytics-desktop-updater\` (feed `https://desktop-app.mobalytics.gg/production/`) |
| User data | `C:\Users\Kenneth\AppData\Roaming\Mobalytics\` (`manifest.json`, `game-events.db`, `logs\`, Chromium profile dirs) |
| Game manifest (bundled) | `resources\data\game-manifest\manifest.json` (same content as `%APPDATA%\Mobalytics\manifest.json`; remote copy at `https://cdn.mobalytics.gg/desktop/prod/manifest.json`, which sits behind a Cloudflare challenge for curl) |
| OCR addon | `resources\data\plugins\ocr\ocr_native.node` (PDB path `C:\mobalytics\win-native-ocr\...`, built with cppwinrt `Windows.Media.Ocr`, `Windows.Graphics.Imaging`, D3D11) |
| Frame grabber | `resources\data\plugins\moba-cap\1.0.0\{moba-injector.exe, moba-cap-client.dll, moba-cap.exe}` |
| Main-process code | `app.asar` → `build/*.js` (webpack, not obfuscated). Key files: `src_common_controllers_game-controller_game-controller_impl_ts.js` (NGF game controllers incl. OCR), `src_common_controllers_game-event-upload-controller_*.js`, `src_common_services_user-delivery-service_*.js`, `src_bootstrap_main_ts-*.js` (`env.raw.ts`) |

`package.json`: `"main": "build/bootstrap.js"`, `"overwolf": {"packages": ["gep","overlay"], "uid": "epdibagheagiopaemmlfabecaedlkajdjfonhffd"}`. Dependencies include `@apollo/client`, `graphql-request`, `ffi-rs` (Win32 calls), `level`, `unleash-proxy-client` (feature flags at `https://edge.mobalytics.gg/api/frontend`), `@sentry/electron` and mixpanel.

## 2. D4 manifest entry (verbatim, from `manifest.json`)

```json
{"gameIds":[22700],"game":"diablo-4","hotkeys":{},"mainWindow":"MOBA_WEB_DIABLO",
 "features":{
   "GAME_START_WINDOW_FLOW":{"enable":true},
   "GAME_START_SHOW_BUILDS":{"enable":true},
   "IN_GAME_OVERLAY":{"enable":true,"windowKey":"MOBA_OVERLAY_DIABLO"},
   "GAME_WINDOW_OCR":{"enable":true,"options":{"maximizeColor":true}}},
 "windows":{
   "MOBA_WEB_DIABLO":{"type":"MAIN","URL":"diablo-4","resizable":true,"min_size":{"width":1400,"height":700},"size":{"width":1540,"height":800}},
   "MOBA_OVERLAY_DIABLO":{"type":"OVERLAY","URL":"diablo-4/overlay/overlay","resizable":false,"passthrough":true,"min_size":{"width":100,"height":100},"size":{"width":1540,"height":800}}},
 "version":"0.0.3"}
```

- `22700` is the Overwolf game ID for Diablo IV. `URL` is joined to `APP_ORIGIN=https://mobalytics.gg`.
- The same `NGF` ("new game framework") controllers also serve PoE 2, Deadlock and Borderlands 4. Each manifest feature maps to a controller class:
  - `GAME_START_WINDOW_FLOW` → `NGFWindowControllerImpl`
  - `GAME_START_SHOW_BUILDS` → `NGFShowBuildsControllerImpl`
  - `GAME_WINDOW_OCR` → `NGFGameWindowOCRControllerImpl`
  - `IN_GAME_OVERLAY` → `NGFOverlayControllerImpl`

### What each feature does
- **GAME_START_WINDOW_FLOW:** when the game launches, it finds the game's HWND by pid and puts the app window behind the game. With two or more monitors it moves the app window to the monitor the game is not on. Window size rule: 1280 px wide, 1513 px at 1920 width, or 65% of width above 1920; height `min(80% of height, 1550)`.
- **GAME_START_SHOW_BUILDS:** on launch it opens the main window at one of these, in order:
  1. the currently tracked build (setting `TRACKING_BUILD`)
  2. the last viewed build (`LAST_VIEWED_BUILD`)
  3. the user's favorite builds
- **IN_GAME_OVERLAY:** a transparent, click-through Overwolf overlay window sized to the game's resolution. Its contents are defined by a server-side "OL document". The default embedded in `main.*.js` contains:
  - **Toggle hotkey:** `overlay-toggle`, keyCode 17 = **Ctrl**, `passthrough:true`. It makes the overlay interactive while the game still receives the key.
  - **Settings widget:** anchored `MIDDLE_LEFT`, toggled with `D` (keyCode 68). Controls: overlay scale, opacity, widget visibility, hotkeys.
  - **Autotracker Notifications widget** (`Diablo4DocumentOlWidgetEquipmentNotificationV1`): anchored `BOTTOM_RIGHT`, `viewportInset:10`, movable while the overlay is active.
  - Widget properties: `displayMode`, `interactiveMode`, `movableByUser`, `hotKeys[]`.
  - Logs confirm `NGF OL hotkey registered ... overlay-toggle keyCode 17 ctrl:true` and `Overlay was injected ... Diablo IV.exe`.
- **GAME_WINDOW_OCR:** described in section 3.

## 3. How game state is detected: injected capture plus Windows OCR

### Game detection
- The Overwolf GEP `game-detected` event gives `{classId:22700, pid, fullPath, commandLine}`.
- If the game runs elevated and the app does not, it shows "need to run as admin".
- `getFeatures(22700)` returns nothing; the log never shows "available features" for D4. **There are no GEP game events or info updates for D4.**

### Capture pipeline (from code, binary strings and the user's logs)
1. **Injection.** `moba-injector.exe <pid> <moba-cap-client.dll>` runs unelevated. It waits for the "Diablo IV" window and attaches the DLL. It re-checks every 4 s through the named event `moba-cap-client-ready-<pid>` and re-injects if needed.
2. **Hooks.** Inside the game the DLL logs `hook dx11`, `hooked IDXGISwapChain::Present`, `hooked IDXGISwapChain1::Present1` and `d3d12: hooked ExecuteCommandLists from the game's device`. It then shares frames through the shared-memory block `mobalytics-overlay-33193088-...` (uses Detours sections).
3. **OCR.** `ocr_native.node` exposes `new OCRGameCapture({game, maximizeColor})`, then `.startCapture(pid, {lang:'en-US', period:500, onFrame(frame, ms), onError})`.
   - It opens the shared D3D11 texture and runs `Windows.Media.Ocr.OcrEngine` on a worker thread.
   - Error codes: `WINDOW_NOT_FOUND`, `ELEVATION_MISMATCH`, `DISPLAY_AFFINITY_EXCLUDED`, `CAPTURE_ACCESS_DENIED`, `NO_OCR_ENGINE`, `DEVICE_INIT_FAILED`, `OCR_ENGINE_UNAVAILABLE`.
   - It also contains Windows.Graphics.Capture-style strings ("pre-22000: no API to hide the capture border"), so a WGC path probably exists as a fallback.
4. **Cost.** On the user's 5120x1440 screen, **~228 ms average OCR per frame**, from `diablo-4.log` "7500 frames processed, avg time: 228".
5. **Dedupe.** A frame is dropped if `lines.map(l=>l.text).join('\n')` equals the previous frame's.
6. **Event dispatch.** Each new frame becomes a `GAME_DATA_EVENT {uuid, timestamp, game:'diablo-4', type:'OCR', payload:{width,height,lines:[{text,x,y,w,h}]}}`.

### Upload of OCR text
The `GameEventUploadController` inserts every event into SQLite table `GameDataEvents(UUID, game, type, timestamp, payload BLOB (deflate JSON), status)`. It caps the table at the newest rows and POSTs each event right away, plus batch retries on a timer, to:

```
POST https://mobalytics.gg/api/game-data-events
Content-Type: application/json
User-Agent: mobalytics-ow-electron
Authorization: <user's auth token — only when signed in>
{"events":[{"uuid":"…","game":"diablo-4","type":"OCR","timestamp":1759600000000,"sentAt":1759600000100,
  "payload":{"width":5120,"height":1440,"lines":[{"text":"+125 Intelligence","x":3501,"y":474,"w":186,"h":25}, …]}}]}
```

On this machine the DB holds 10,000 `diablo-4/OCR` rows, all marked uploaded (status 2), averaging ~24 lines per frame (max 104).

Example tooltip lines from those rows. Only the structure was checked; these are generic game text, not account data:
- `"2,805 Armor (03.2% Toughness)"`
- `"+117 Intelligence (-8)"`: the comparison delta is part of the same OCR line.
- `"+3,045 Lightning Resistance"`
- `"+220 Life Regeneration"`

Boxes are in physical game pixels.

### Server-side matching and the signal back
- The client never parses tooltips itself. The server returns results through the notifications service (`NOTIFICATION_GQL_HTTP_URL = https://mobalytics.gg/api/battlepass/v1/graphql/query`).
- `StartListeningMutation` returns base64 Firestore connection details. The app listens to a Firestore doc; when `LastSignalAt` changes, it runs:

```graphql
query SignalsQuery($since: DateTime) { notifications { id signals(since: $since) { items { id createdAt payload { __typename
  ... on Diablo4BuildTrackerPayload { build { name class slot { name id } uniqueItem { name slug } aspect { name slug }
        affixes { total recognized matched { slug type } } } } } } } } }
```

- The web overlay shows this as a toast with item icon, item type, affixes and matched/total counts. It also has a "Report Autotracker Error" button.
- UI copy: *"Hover over your equipped items to update your status."* and *"Turn on In-Game Detection to autotrack the equipment in your build."*
- Matched entity types: `stats, statImplicit, statTempering, transfiguredStats, gems, runes, aspects`.
- **Item tooltips are handled only this way:** OCR the hovered tooltip, match on the server against the build, notify. There is no local tooltip overlay or price check.

## 4. Endpoints

All are POST GraphQL unless noted. "Public" means it answered without auth from curl during this session.

| URL | Auth | Purpose |
|---|---|---|
| `https://mobalytics.gg/api/diablo4/v4/graphql/query` (also `/v1/`) | public reads; auth for tracking/mutations | All D4 data: static game data, build/guide/tier-list/loot-filter docs, tracking |
| `https://mobalytics.gg/api/game-data-events` | auth | Upload of OCR frames (see above) |
| `https://mobalytics.gg/api/battlepass/v1/graphql/query` | auth | Notifications and signals (`StartListeningMutation`, `SignalsQuery`, `AckSignalsMutation`, `MarkSeenMutation`) |
| `https://account.mobalytics.gg/api/graphql/v1/query`, `https://api.mobalytics.gg` | auth | Account/login (not examined further) |
| `https://edge.mobalytics.gg/api/frontend` | client key | Unleash feature flags (e.g. `DIABLO_4_ARPG_HELPER_ENABLED`, `DIABLO_4_BUILD_TRACKING_ENABLED_ONLY_FOR_PREMIUM`) |
| `GET https://mobalytics.gg/diablo-4/fe/api/service-version` | public | Web build version check |
| `GET https://cdn.mobalytics.gg/assets/diablo-4/...` | public | Images. Seen paths: `images/skills/<slug>.png`, `icons/skills/<slug>.webp`, `images/runes/<slug>.png`, `images/class-mechanics/<class>/<slug>`. Resizer: `https://cdn.mobalytics.gg/cdn-cgi/image/format=auto,width=96/assets/diablo-4/...` |
| `GET https://desktop-app.mobalytics.gg/production/latest.yml` | public | electron-updater feed |

### D4 GraphQL operations found in the web bundles
The bundles are `https://mobalytics.gg/diablo-4/static/js/*.js` (`main.*.js`, `diablo-4-app.*.chunk.js`).

- **Static data**
  - `Diablo4NgfStaticDataMetaQuery`: `game: diablo4 { staticData: staticDataV2 { meta: d4Skills { version } } }`. Returned `v0.0.169` today, so it works as a cheap cache key.
  - `Diablo4NgfStaticDataQuery`: one query for `d4Skills, d4Aspects, d4UniqueItems, d4Runes, d4Gems, d4WitchcraftPowers, d4BossPowers, d4ParagonBoards/Glyphs/Nodes, d4Classes, d4SkillSections, d4Connectors, d4BuildSlots, d4Stats, d4StatImplicit, d4StatTempering, d4TransfiguredStats, d4Mercenaries, d4MercenarySkills, d4Opportunities, d4ChaosPerks, d4BloodiedAffixes, d4DivineGifts, d4Elixirs, d4SoulShards, d4Charms, d4Seals, d4WarplanTrees/Nodes, d4TriadSplinters, d4TriadPowers`.
    - Each takes `filter: {page:{all:true}}`. **Without it, pages default to 10 items.**
    - Verified counts: **1727 stats, 777 aspects, 831 uniques** (these include `deprecated` entries).
  - Useful fragments:
    - `D4StatFragment { id name slug buildSlotsSlugs classesSlugs isUniqueItemStat deprecated }`
    - `D4AspectFragment { slug id name iconUrl description type{id name} dungeon{id name} location{id name} class{id name iconUrl} deprecated }`
    - `D4UniqItemFragment { id slug name iconUrl description type{id name} class{id name} effect mainStats secondaryStats secondaryStatsSlugs deprecated chaos mythic dropSource }`
    - `D4BuildSlotFragment { id name slug aspectBonuses deprecated }`
- **Documents**
  - `Diablo4UgDocumentsQuery(input:{type, name?, tags?, featuredStatuses?}, page:{limit, cursor?})` → `userGeneratedDocuments { documents pageInfo{cursor hasMoreItems total} }`. Verified public: `type:"builds"` returned total 23,244.
  - `userGeneratedDocumentTypes` → `builds, guides, tier-lists, loot-filters, news`.
  - Other document queries: `Diablo4UgNormalDocumentBySlugQuery` / `...ByIdQuery`, `Diablo4UgFeaturedDocumentQuery`, `Diablo4WikiDocumentsTierListQuery(page,input)`, `Diablo4StDocumentQuery(input:{slug})` (struct pages, incl. the overlay "OL" doc), `Diablo4ProfilePageQuery`.
- **Tracking (auth)**
  - `Diablo4UgDocumentBuildTrackMutation(input:{documentId, variantId})` and `Diablo4UgDocumentBuildUntrackMutation`.
  - `Diablo4UgDocumentUpdateCharacterStateMutation(input: Diablo4TrackingUpdateCharacterStateInput)` (manual check-offs).
  - `Diablo4TrackedDocumentsQuery`, `Diablo4UgDocumentMatchingInfoQuery`.
  - All return `NgfMatchingInfo { autoSyncInterval autoTrackingDisabled items{…children} nextItems matchingTarget{key} variantId }`, where each `NgfMatchableEntity` is `{ id slug name isNext matchRate matched type targetName targetSlug lastMatchedTime autoTrackingDisabled }`.
- **Loot filter widget** (`Diablo4DocumentUgWidgetLootFilterV1`): the build document's `data.lootFilter` is a **code string of up to 200,000 chars**. The UI has a button that copies it to the clipboard for D4's in-game loot-filter import. `loot-filters` is also its own document type.

Sample public request (verified):
```
POST https://mobalytics.gg/api/diablo4/v4/graphql/query
{"query":"query($f:D4StatsFilter){ game: diablo4 { staticData: staticDataV2 { d4Stats(filter:$f){ data { id name slug buildSlotsSlugs classesSlugs isUniqueItemStat deprecated } } } } }",
 "variables":{"f":{"page":{"all":true}}}}
```

## 5. Overwolf GEP

- The manifest declares the `gep` package, but for D4 it only does **launch/exit detection**: `getFeatures(22700)` returns an empty list and no `new-game-event` / `new-info-update` events are used.
- The Overwolf `overlay` package draws the click-through in-game overlay window.
- None of this is available to a Tauri app, and we lose nothing: there is no D4 game-event data to miss.

## 6. Bundled data worth reusing

**None for D4.** `build/common/windows/moba-web-root/lang-ng/<locale>/diablo-4.latest.json` holds only UI translation strings for the site, not game data. All D4 data is fetched live from GraphQL.

The things worth reusing are **API shapes**:
- `staticDataV2` for stats, aspects, uniques, runes, gems, paragon and so on, with slugs, `buildSlotsSlugs` and `classesSlugs`
- CDN image paths
- the default overlay layout and hotkey design

## 7. Recommendations for our app (`D:\Projects\diablo-companion`)

1. **Keep local Windows.Media.Ocr (`src-tauri/src/ocr.rs`).** It is the same engine Mobalytics ships. Unlike them, parse and match tooltips **locally**: no account, no upload of screen text, instant results.
2. **Do not inject into the game.** Mobalytics injects a DLL into `Diablo IV.exe` and hooks DXGI/D3D12; that is a ban/anti-cheat risk we should not take. For capture beyond GDI/xcap:
   - Use **Windows.Graphics.Capture** on the game HWND. It is GPU-side and works in borderless mode; on Win11 (build 22000+) set `IsBorderRequired = false` and `IsCursorCaptureEnabled = false`.
   - Handle the same failure modes they enumerate: elevation mismatch, `WDA_EXCLUDEFROMCAPTURE` display affinity, capture access denied, OCR language missing.
3. **OCR budget.** Full-frame OCR at 5120x1440 costs ~230 ms even for them. Ways to cut it:
   - Crop to the tooltip region (it appears beside the cursor or the hovered item).
   - Run at about 2 Hz at most, and only while a hotkey is held or the cursor is still.
   - Dedupe frames by joined line text, as they do.
   - Try a "maximize color channel" preprocess (grayscale = max(R,G,B)) for D4's colored affix text. They enable this only for D4.
4. **Tooltip line parsing.** Expect OCR lines such as `+117 Intelligence (-8)`, where the comparison delta sits on the same line, and `2,805 Armor (03.2% Toughness)`. Strip trailing `(±N)` and `(… Toughness)`, normalize thousands separators, then fuzzy-match the remaining name against `d4Stats.name` (plus `d4StatImplicit`, `d4StatTempering`, `d4TransfiguredStats`). Use the line's `y` order and `h` to group lines into one tooltip.
5. **Static data cache.** Do one `staticDataV2` query with `page:{all:true}` and store it in `data/gamedata`. Re-fetch only when `Diablo4NgfStaticDataMetaQuery` reports a new version (currently `v0.0.169`). Filter out `deprecated:true`. `d4Stats.buildSlotsSlugs` tells you which slots an affix can roll on, which helps reject OCR mismatches. Our importer uses `/api/diablo4/v1/graphql/query`; both `v1` and `v4` (what the web app uses) answer identically today, so consider switching to `v4` and keep `v1` as fallback.
6. **Build-tracker model to copy (locally).** Mirror `NgfMatchableEntity`: per build slot, a target entity with `matched`, `matchRate`, `isNext`, `lastMatchedTime`, plus per-item `affixes {total, recognized, matched[]}`. Show the same small overlay toast: "Gloves: 3/4 affixes match build (missing: Crit Chance)". This is their premium "Autotracker", which we can do offline.
7. **Overlay UX ideas:**
   - Click-through overlay with a **hold-Ctrl** (passthrough) toggle to make it interactive.
   - Widgets pinned to anchors (`MIDDLE_LEFT`, `BOTTOM_RIGHT`, with inset), each with its own hotkey and visibility.
   - A settings panel with overlay scale and opacity.
   - Auto-show the companion window when the game starts, moving it to the secondary monitor if there is one. Find the game window via pid → HWND.
8. **Loot filters.** Builds can carry a `lootFilter` import string (≤200k chars) and there is a `loot-filters` document type. We could show a "copy loot filter" button for imported builds; check the exact field path on `Diablo4UserGeneratedDocumentData` before relying on it.
9. **Timers.** Mobalytics has no world boss / helltide / legion timers, so nothing to borrow. Keep the sources in `research/timers.md`.
10. **Etiquette and ToS.** The GraphQL API is undocumented and unofficial. Cache aggressively, send a normal UA, don't hammer it, and handle schema drift (`error` fields come back inside `data`).

## Appendix: scratch artefacts (not in repo)
`C:\Users\Kenneth\AppData\Local\Temp\claude\d--Projects-diablo-companion\a6e4f32b-489d-4c86-b61d-5b7cf5533ffe\scratchpad\moba-app\`:
- `extracted/app/`: unpacked asar
- `web/js/`: 150 public D4 web chunks
- `web/gql-ops.txt`: all GraphQL operation/fragment names
- `web/chunks.txt`: chunk map
- `scripts/gqlext.js`: prints a named GraphQL op from the bundles
