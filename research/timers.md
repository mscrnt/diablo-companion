# Diablo 4 event timer data sources (verified 2026-10-09 / 2026-10-10 01:05-01:16 UTC, Season 15)

All endpoints below were curl'd live during this session. Raw responses are in `research/samples/`.

## TL;DR / recommendation

| Role | Source | Why |
|---|---|---|
| **Primary (live state: boss name, zone, helltide zone, legion)** | helltides.com's public Firebase Realtime Database, REST: `https://helltides-7e530-r{1,2,3}.firebaseio.com/<node>.json` (read replicas) or `https://helltides-7e530-default-rtdb.firebaseio.com/<node>.json` (primary) | No auth, no Cloudflare, `Access-Control-Allow-Origin` echoes the Origin (works even from a webview), supports SSE push streaming, the data is current for S15 (includes Skovos/Nahantu zones and a S15 Tower leaderboard). |
| **Secondary (multi-event schedule list)** | `GET https://helltides.com/api/schedule` | Next ~5 world bosses (with boss+zone predictions), ~43 legions, ~19 helltides. **Behind a Cloudflare managed challenge**: plain curl gets 403 `cf-mitigated: challenge`. Only works through FlareSolverr/browser. Treat as optional. |
| **Tertiary (world boss only)** | `GET https://diablo4.life/api/trackers/list` | Works, no challenge, but only `worldBoss` is populated; `helltide` and `zoneEvent` were `{}` during an active helltide/legion; its JS still hard-codes the old 2h15m helltide cadence (site last updated ~Season 10). No CORS header. |
| **Offline fallback** | Local computation from the deterministic rules below | Times are fully deterministic (verified: the helltides schedule matches the formulas exactly). Boss name / zones are NOT deterministic as far as can be verified. |

**Dead / not usable**
- `d4armory.io` (all paths incl. `/api/events/recent`, `/api/events.json`): `301 → https://diablo4.com/`. Dead.
- `https://data.d4planner.io/events.json`: 200, but `Last-Modified: Sat, 20 Sep 2025`; contains stale placeholder (`"n":"TBD"`, legion ts `-62135596800`). Dead feed. (d4planner.io/trackers itself computes times locally, see "anchors" below.)
- `d4timers.com`, `api.helltides.com`: DNS/connection failure.
- `helltides.com/api/events`: 404. Realmwalker / tower / marker nodes on replicas: 401 Permission denied.
- wowhead / maxroll timer pages: 404 (no public timer API found).

---

## 1. helltides.com Firebase RTDB (PRIMARY)

Discovered from `window.__NUXT__.config.public` on https://helltides.com/ (config keys `firebase_dbRead_1..3`, project `helltides-7e530`) and the site's JS bundle, which subscribes with `onValue(ref(db,"world_boss"))`, `"world_boss_zone"`, `"helltide"`, `"legion"`, `"legion_zone"`, `"tower"`.

This is an **undocumented, unofficial** endpoint of a community site. Be polite: use one SSE stream (or poll no faster than every 30-60 s), cache, and fail over to the local schedule. It could change without notice.

### Hosts
- Read replicas (what the website uses): `https://helltides-7e530-r1.firebaseio.com`, `-r2`, `-r3`
- Primary: `https://helltides-7e530-default-rtdb.firebaseio.com` (also exposes `realmwalker` and `tower`, which are 401 on replicas)
- Root `/.json` is 401 everywhere; you must request a specific node. `?shallow=true` works on readable nodes.

### Request
```
GET https://helltides-7e530-r1.firebaseio.com/world_boss.json
GET https://helltides-7e530-r1.firebaseio.com/helltide.json
GET https://helltides-7e530-r1.firebaseio.com/legion.json
GET https://helltides-7e530-default-rtdb.firebaseio.com/realmwalker.json   (optional)
```
- Method: GET. No headers, no auth, no API key required.
- Response headers: `HTTP/1.1 200`, `access-control-allow-origin: *` (or echoes the request `Origin`, e.g. `tauri://localhost`), `Cache-Control: no-cache`, JSON.
- Streaming: add `Accept: text/event-stream` to the same URL → Firebase REST streaming (SSE). First event is `event: put` with `data: {"path":"/","data":{...full node...}}`; later `put`/`patch` events on change; `keep-alive` events with `data: null`. Handle `cancel`/`auth_revoked` by reconnecting / falling back. Sample: `samples/helltides_rtdb_helltide_sse.txt`.

### `world_boss` (sample `samples/helltides_rtdb_r1_world_boss.json`, `default_rtdb_world_boss.json`)
```json
{"boss":"Avarice","id":1791604800,"nextTime":"2026-10-10T07:30:00.000Z","startTime":"2026-10-10T04:00:00.000Z",
 "zone":[{"boss":"Avarice","id":"fractured_peaks","isWhisper":false,"name":"Fractured Peaks"}]}
```
- `boss`: short boss name of the NEXT/current spawn (`Avarice`, `Ashava`, `Azmodan`, `Wandering Death` seen on site).
- `id`: Unix seconds of the spawn (= `startTime`).
- `startTime`: ISO UTC spawn time. `nextTime`: the spawn after that (+3h30m).
- `zone`: array of `{id, name, boss, isWhisper}`. Can contain **more than one** entry: the site treats an array as a *prediction* (`isZonePredicted = Array.isArray(zone)`) refined by user votes (`/api/world_boss/zone_vote`). Observed: replica r1 briefly returned two candidates (Fractured Peaks/Avarice and Nahantu/Azmodan) while the primary returned one; so take `zone[0]` but display alternates if length > 1. Value updates over time.
- `isWhisper`: meaning not documented (likely whether it counts for a Tree of Whispers objective) - **unverified**.
- Site JS also reads an optional `nahantuBoss` field (not present in current data).
- `world_boss_zone` node: currently `null`; when set, overrides the zone (vote result).

### `helltide` (sample `samples/helltides_rtdb_r1_helltide.json`)
```json
{"endTime":"2026-10-10T01:55:00.000Z","id":1791594000,"startTime":"2026-10-10T01:00:00.000Z","zone":"scosglen"}
```
- Current helltide: `zone` id (`scosglen`, `fractured_peaks`, `dry_steppes`, `kehjistan`, `hawezar`, `nahantu`, `skovos` — zone ids observed across nodes), `startTime`/`endTime` ISO UTC, `id` = start Unix seconds.
- Chest / mystery-chest / Living Steel / ritual / hellworm markers are in other nodes (`helltide_markers`, etc.) that are **auth-protected (401)**. No usable chest data from this source.

### `legion` (sample `samples/helltides_rtdb_r1_legion.json`, `default_rtdb_legion.json`)
```json
{"id":1791595200,"nextTime":"2026-10-10T01:45:00.000Z","startTime":"2026-10-10T01:20:00.000Z","zoneWindow":false}
```
- `startTime`: next/current Legion ("Gathering Legions") start, `nextTime` = +25 min. `zoneWindow` false / `legion_zone` null → zone currently not known (crowd-sourced when present).

### `realmwalker` (primary DB only; sample `default_rtdb_realmwalker.json`)
`{"id":..,"startTime":..,"zone":[{"id":"hawezar",...}],"nextEvent":{"time":..,"zone":[...]}}` — mirrors the legion timestamps. Realmwalker was a Season 6-era seasonal event; whether it still exists in S15 is **unverified** - don't show it by default.

### `tower` (primary DB only; sample `default_rtdb_tower.json`)
Top entry of The Tower leaderboard: `{"battle_tag","class","tier":150,"run_time_ms":49406,"season":15,"hardcore":false,"ssf":false,"platform":"pc"}`. Confirms the data is S15-live. Not an event timer.

---

## 2. helltides.com `/api/schedule` (SECONDARY, Cloudflare-challenged)

- `GET https://helltides.com/api/schedule` → with plain curl: `403`, `cf-mitigated: challenge` (Cloudflare managed challenge, needs JS). Through FlareSolverr: 200, JSON wrapped in Chrome's `<pre>` viewer (strip HTML, unescape).
- Not suitable as a primary from a desktop app (would require embedding a challenge solver). If ever used, fetch inside a real webview and let Cloudflare set `cf_clearance`.
- Sample: `samples/helltides_api_schedule.json`. Shape:
```json
{"world_boss":[{"id":1791604800,"timestamp":1791604800,"boss":"Avarice","type":"world_boss","startTime":"2026-10-10T04:00:00.000Z",
                "zone":[{"id":"fractured_peaks","name":"Fractured Peaks","isWhisper":false,"boss":"Avarice"}]}, ... 5 entries],
 "legion":[{"id":1791595200,"timestamp":1791595200,"type":"legion","startTime":"2026-10-10T01:20:00.000Z"}, ... 43 entries],
 "helltide":[{"id":1791594000,"timestamp":1791594000,"startTime":"2026-10-10T01:00:00.000Z","type":"helltide"}, ... 19 entries]}
```
- Observed world-boss forecast (UTC): 04:00 Avarice/Fractured Peaks, 07:30 Ashava/Scosglen, 11:00 Ashava/(Kehjistan or Skovos), 14:30 Azmodan/Scosglen, 18:00 Azmodan/Fractured Peaks.

---

## 3. diablo4.life (TERTIARY, world boss only)

- `GET https://diablo4.life/api/trackers/list` (optional `?helltideLocationOverride=<zone>`). No auth, no challenge. Headers: `200`, `content-type: application/json`, `cache-control: public, max-age=10`, Vercel behind Cloudflare. **No `Access-Control-Allow-Origin`** → fetch from Rust, not the webview.
- Sample `samples/diablo4life_trackers_list.json`:
```json
{"helltide":{},"worldBoss":{"name":"Avarice, the Gold Cursed","time":1791604800000},
 "nextWorldBoss":{"name":"Avarice, the Gold Cursed","time":1791604800000,"_id":"..."},"zoneEvent":{},"chestRespawn":1791601200000}
```
- `time` fields are **milliseconds**. `worldBoss.name` is the full boss title. `helltide`/`zoneEvent` (legion) were empty while both were active → unreliable. `chestRespawn` meaning undocumented (value was 03:00 UTC) - **unverified**.
- Its front-end falls back to `now - (now - 1686404700000) % 8100000 + 8100000` for helltide = the pre-S4 2h15m cadence → stale, don't copy it.

---

## 4. Deterministic schedule rules (local fallback)

All verified against the live helltides.com schedule on 2026-10-10 (every entry matched exactly):

| Event | Rule (Unix seconds, UTC) | Duration | Anchor check |
|---|---|---|---|
| **World Boss** | spawns when `t % 12600 == 10800` (every **3h30m**). Equivalent anchor: `1697583600` (2023-10-17T23:00Z) + n·12600 | Boss stays ~15 min before despawning (community, unverified for S15); site shows a 15-min "spawned" window | All 5 forecast spawns gave integer n (7462..7466) |
| **Legion (Gathering Legions)** | `t % 1500 == 1200` (every **25 min**). Anchor `1697582700` + n·1500 | Event itself is short (few minutes) | 43/43 entries matched, n integer |
| **Helltide** | Starts every hour on the hour (`t % 3600 == 0`), ends at **:55** (55 min active, 5 min downtime) | 55 min | 19/19 consecutive hourly starts; RTDB `endTime` = start + 55 min |

Non-deterministic (needs live data): world boss **name** and **zone**, helltide **zone**, legion **zone**, helltide chest locations. No reliable public formula found; d4planner hard-codes an old 15-entry boss rotation (`Wandering Death ×3, Avarice ×2, Ashava ×3, ...`) that does not include Azmodan and no longer matches live data — don't use it.

Pseudo-code:
```
next_world_boss(now) = now + ((10800 - now) mod 12600)        // if result == now, it's spawning now
next_legion(now)     = now + ((1200  - now) mod 1500)
helltide_active(now) = (now mod 3600) < 3300; helltide_end = floor(now/3600)*3600 + 3300
next_helltide(now)   = ceil(now/3600)*3600
```
(Use a true modulo for negatives.) Server-wide; same for all regions/platforms (helltides.com shows a single global schedule).

Sources: live API responses above; https://helltides.com/ (config + bundle); https://d4planner.io/trackers (anchor constants in its JS: world boss `16975836e5`+`126e5`, legion `16975827e5`+`15e5`, helltide `17065548e5`+`36e5` ms); https://d4planner.io/trackers text "world bosses spawn every 3.5 hours ... Legion events occur every 25 minutes ... Helltides ... reset on the hour".

---

## 5. Integration plan (Rust side of Tauri)

1. On start: compute local schedule (section 4) so UI is never empty.
2. Open SSE streams (reqwest, `Accept: text/event-stream`) to `https://helltides-7e530-r{rand 1-3}.firebaseio.com/world_boss.json`, `/helltide.json`, `/legion.json`. Parse `event: put|patch` lines; `data.path=="/"` → replace node, else patch subpath. Reconnect with backoff; rotate replica r1→r2→r3→default-rtdb on failure.
   - Simpler alternative: poll the three `.json` URLs every 60 s.
3. Overlay live data onto the computed times: if live `startTime` disagrees with computed by > 1 min, trust live and log it.
4. Optional: `diablo4.life/api/trackers/list` as a cross-check for the world boss name (convert ms → s).
5. Never depend on `/api/schedule` (Cloudflare) or d4armory (dead).
6. Set a descriptive `User-Agent` (e.g. `diablo-companion/0.1`) and credit helltides.com in the UI.
