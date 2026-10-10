# Diablo IV Companion

Desktop companion for Diablo IV (Tauri 2 + React). Screen-reading only: capture,
Windows OCR and a local vision LLM — no memory reading, no injection, no input sending.

![Loot Judge: plain-language verdict next to the in-game tooltip it read](docs/screenshots/loot-judge.png)

| | |
|---|---|
| ![Dashboard with world events, build progress and recent verdicts](docs/screenshots/dashboard.png) **Dashboard**: next world events, build progress, recent verdicts | ![Build page with gear slots, affix targets and masterwork goals](docs/screenshots/build.png) **Build**: your Mobalytics build, slot by slot, with progress |
| ![Farm Planner with boss route and drop sources](docs/screenshots/farm-planner.png) **Farm Planner**: where each missing piece drops | ![War Plans tree with the recommended path in green](docs/screenshots/war-plans.png) **War Plans**: which nodes to unlock next |
| ![Runs and splits with Pit and Nightmare Dungeon history](docs/screenshots/runs.png) **Runs & Splits**: Pit and Nightmare Dungeon runs tracked automatically | |

## For players (install & use)
1. Run the installer (`D4 Companion_x.y.z_x64-setup.exe`). It's self-contained: the C runtime is linked into the exe and the WebView2 runtime installs offline if it's missing — no admin rights needed.
2. On first start, paste your **Mobalytics build link** (featured guide or profile build). Add more builds any time on the **Build** page — the active one drives the loot judge; the others still get "stash it — great for your other build" advice. Builds show an **update** badge when the author changes the guide.
3. Optional: point **Settings → Local LLM** at any OpenAI-compatible server (vLLM, LM Studio, Ollama…) for the AI Coach/session plans. Everything else works without it.
4. In game: Display Mode **Windowed Fullscreen**; hover your equipped gear once so it knows what you wear.

Screen-reading only (capture + Windows OCR): no memory reading, no injection, no input.

## Run (development)
```
npm install
npx tauri dev
```
Rust is pinned to 1.92 via `rust-toolchain.toml` (rustup installs it automatically).
Game: Display Mode **Windowed Fullscreen** so the overlay can draw.

## Configure (Settings page)
- **LLM** (optional): any OpenAI-compatible endpoint, e.g. vLLM serving Qwen3.5-35B-A3B (vision) — used for the AI Coach, session plans and as the loot-parse fallback
- **FlareSolverr** (optional): only needed if the Mobalytics GraphQL API is unavailable
- Hotkeys / controller chords, OBS websocket, Discord webhook

## Tests
```
npm test            # Vitest: loot judge on logged tooltips, build import, timers, activity helpers
npm run typecheck
```
CI (`.github/workflows/ci.yml`) runs the typecheck, tests, web build and `cargo check` on every push and PR.

## Release
- **From GitHub:** Actions → *Release* → *Run workflow*, enter `patch`, `minor`, `major` or an exact `x.y.z`. It bumps the version files, commits, tags `vX.Y.Z` on main, builds the installer and publishes a GitHub release with it attached.
- **From a terminal:** `npm run version -- 0.2.0`, commit, `git tag v0.2.0`, `git push --follow-tags`. Pushing the tag triggers the same build.
- **Local installer only:** `npx tauri build` → `src-tauri/target/release/bundle/nsis/D4 Companion_<ver>_x64-setup.exe`.

## Data refresh
```
node scripts/fetch-mobalytics-static.mjs && node scripts/slim-static.mjs   # game data tables
node tools/datamine/extract.mjs --update-defs                             # strings from local game files (after a patch)
```
`research/` holds the S15 farming knowledge and timer source notes used by the app.

## Layout
- `src-tauri/src` — capture (xcap), Windows OCR, game-window watcher, XInput reader, tray
- `src/lib` — engine (timers, hotkeys, watchers), loot judge, guide, farm planner, importers
- `src/overlay` — transparent click-through overlay (docks into the black pillarbox bars)
- `src/pages` — dashboard UI
- `tests` — Vitest suite; `tests/fixtures/tooltips` are real OCR'd tooltips from the judge log
- `scripts/dev` — `node scripts/dev/run.mjs <name>` runs exploratory scripts against your local judge log and app state

See `ROADMAP.md` for what's next.
