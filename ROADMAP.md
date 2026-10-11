# Roadmap

**Goal:** the one-stop Diablo IV companion. Every system in the game (loot, builds, character, activities, world, seasons) covered in one app, more accurately than any single-purpose tool, and without ever risking the player's account.

## Ground rules: ban-safe only

Everything on this roadmap uses one of these sources:

| Allowed | Examples |
|---|---|
| **Screen capture + OCR / local vision model** | tooltips, HUD, quest tracker, menus |
| **Game files on disk, read-only** | CASC data from the local install: affixes, drop tables, map markers, schedules, recipes |
| **Public web data** | Mobalytics, Maxroll, d4builds, helltides.com, guides, tier lists, patch notes, Blizzard news (fetched politely, cached, credited) |
| **The game's own features** | importing a loot filter code the app generates |
| **Read-only controller input** | XInput chords for our own hotkeys |

**Never:** reading or writing game memory, loading or injecting DLLs into the game (this includes d4lf's screen-reader/TTS DLL), modifying game files, sending input to the game (macros, auto-clicking, auto-salvage), capturing network traffic, or handling Battle.net credentials.

**Legend:** effort **S** (days) · **M** (a week or two) · **L** (bigger). Sources: 🖥 screen · 📦 game files · 🌐 web · 🎮 in-game feature.

---

## Done (0.1.x)
- **Loot judge**: automatic on hover, with plain-language verdicts and upkeep steps (temper, masterwork, Occultist, sockets, cube). Compares against equipped and Alt-compare items, remembers what you wear, and stays quiet while you fight. Gems, runes, charms and seals are handled too.
- **Builds**: Mobalytics import (featured and profile builds), several bookmarked builds, author-update badges, cross-build "stash it for your other build".
- **Activities**: auto-tracked Pit (tier, Guardian split, deaths) and Nightmare Dungeons, Infernal Hordes offer and spoils picks, Tree of Whispers caches, Helltide cinder plans, boss drop tips, War Plans planner.
- **Character**: guided mapping of stats, skills and paragon glyphs (pause and resume with F7 / View+Y). Skill bar check.
- **Timers and overlay**: world boss / Helltide / Legion schedule with live names, alerts, Discord. Overlay docks into the black pillarbox bars, plus a status corner and a guided overlay.
- **Platform**: signed standalone installer, CI, tested release pipeline, update check, portrait layout.

---

## Now: accuracy and the biggest wins

| Feature | How | Source | Effort |
|---|---|---|---|
| **Loot filter generator** | Turn the active build into the game's native loot-filter import code (25 rules): keep the build's uniques, aspects, wanted affixes, greater affixes and item power thresholds; hide the rest. Profiles for leveling, Torment farming and greater-affix hunting. Codes are base64-encoded protobuf; the format is worked out from codes the player exports in game, and item categories come from `LootFilterItemTypeGroup`. | 🎮📦 | M |
| **Filter decoder and diablofilter.com** | Paste any filter code (from diablofilter.com or a friend) and see each rule in plain language, or merge it with build-generated rules. A "Browse filters" button opens diablofilter.com in the browser. Their terms forbid automated access without written permission, so in-app browsing waits on their OK. | 🎮🌐 | S |
| **Snap OCR to the game's own text** | Match every OCR'd line against the datamined affix, aspect, unique and item-type strings (fuzzy plus number-aware), so "Arit10r" becomes "Armor" and garbled item names get corrected. Removes most misreads at the source. | 📦 | S |
| **Fix Character page reading** | Skill ranks read as "31/15" (base vs gear bonus) and stats get mixed up ("Toughness 1,241,124", "Kyldirril"). Parse the character sheet against the datamined stat names, and split base and bonus ranks. | 🖥📦 | S |
| **Roll quality on every affix** | Show "87% of max" next to each affix and greater affix using datamined affix ranges by item power, so "is this a good roll?" gets an exact answer. | 📦🖥 | M |
| **Re-check questionable verdicts** | Audit rules such as "wear this ring" when the swap would lose a unique power. Add these cases as test fixtures. | 🖥 | S |
| **Test mode** | One toggle that records each scan (frame, tooltip box, OCR, verdict) along with window size, DPI scale and bar detection, so a play session doubles as a test run across resolutions and window modes. | 🖥 | S |
| **Look-and-feel pass** | Consistent spacing, type and colour; overlay readability at 1080p, 1440p, 4K, ultrawide and windowed, and at 100–150% DPI; onboarding, empty and loading states; motion that never distracts mid-fight; full controller navigation. | 🖥 | M |

## Signature features: explain, improve, grade

What sets the app apart: it knows the game's actual data, your build, your character and how you play, and connects them.

| Feature | How | Source | Effort |
|---|---|---|---|
| **Ask anything about Diablo IV** | The Coach answers from the datamined game data (drops, maps, recipes, affix ranges, bosses, activities), the active build and your mapped character, quoting real values instead of guessing. Points to the map or a page when the answer is a place or a list. | 📦🌐 | M |
| **Build doctor** | Import a build from Mobalytics, Maxroll or d4builds and get concrete improvement suggestions: missing synergies, weak or outdated aspects and affixes (checked against the current patch's datamined values), better temper and masterwork targets, paragon and glyph order, gear you already own that fits. Each suggestion explains why. | 🌐📦 | L |
| **Gear check against the build** | Compare what you actually wear (mapped gear and stats) with the build, ranked by impact: "your biggest upgrade is a greater-affix Crit Chance ring". | 🖥📦 | M |
| **Play grading** | Grade each session from what the screen shows: Pit and Nightmare clear times by tier, time per floor, deaths and what killed you (death screen), potion use, how long elites and bosses take, resource starvation. Trends over time, with "you're ready for tier N" calls. | 🖥 | L |
| **Adaptive build tuning** | Turn the grades into build changes: dying to the same thing suggests specific defensive swaps; slow boss kills suggest a damage-focused swap; resource issues suggest the right affix or aspect. The build doctor applies them, and you can accept, reject or bookmark them as a variant. | 🖥📦 | L |
| **Session recap** | End-of-session card: runs, best times, drops worth keeping, glyph progress, and what to do next session. | 🖥 | S |
| **DPS check at the training dummy** | Set the dummy to Boss and measure how fast its health bar drains, which counts every hit including minions with no floating numbers to read. Gives exact A/B comparisons ("this ring is +12% damage") right away; absolute DPS once the dummy's max health is mined from the game files. | 🖥📦 | M |

## Map and collectibles

| Feature | How | Source | Effort |
|---|---|---|---|
| **Pins on the in-game map** | When the map is open, find the waypoint icons on screen, fit them to the waypoints' known world positions to learn the map's pan and zoom, then draw pins in the overlay. No map art is shipped; the game's own map is the picture. | 🖥📦 `MarkerSet`, `Scene`, `World` | L |
| **Lilith altars still needed** | The game only shows altars you've found (per character). Compare the altar icons on screen with all ~160 known positions and pin the missing ones. | 🖥📦 | M |
| **Seasonal collectibles** | Deckard's Journal (Season 15) and each new season's collectibles, mined automatically after each patch, with pins and a "found" checklist. | 📦🖥 | S per season |
| **Side quest helper** | Every side quest per region with its giver's location; done vs left from the quest log; pins for what's left. Feeds renown. | 📦🖥 `Quest` | M |
| **Dungeons, cellars, strongholds** | Entrances pinned, with what each dungeon unlocks (aspects) and completion tracked | 📦🖥 | M |
| **War Plans overlay** | On the in-game War Plans screen, highlight the recommended next nodes (from the War Plans planner) right on the tree, the same way map pins sit on the map | 🖥📦 | M |
| **Stitched reference map** | Stitch the player's own map captures into a full map stored locally, for registration at any zoom (even over open sea) and a fog-of-war view of explored areas | 🖥 | L |

## Next: be the best at each system

### Loot and crafting
| Feature | How | Source | Effort |
|---|---|---|---|
| Masterwork planner | Crit chances per rank, material cost to +12, "reroll or keep" advice for the build's target affix | 📦 `MasterworkData`, `MasterworkRankData` | M |
| Tempering odds | Which manual can roll the build's temper, the odds per attempt, and tempers left on the item | 📦 `TemperingData`, recipes | M |
| Occultist cost and odds | Enchant cost scaling and the chance of the wanted affix in the reroll pool | 📦 `EnchantCostScalarDelta`, affix pools | S |
| Codex of Power tracker | Read the Codex screen; know which aspects (and what roll) you own; skip "extract" advice for aspects you already have at max | 🖥📦 | M |
| Stash scanner | Guided tab-by-tab scan: dupes, upgrades for other builds, salvage list, material totals | 🖥 | M |
| Cube and recipe helper | Every Horadric Cube and crafting recipe with ingredients and what you can make right now | 📦 `RecipeDefinition`, `Crafter` | M |
| Gem and rune planner | Which gems and runes the build socketed, what to craft, rune combos | 📦 | S |
| Real drop sources | Replace the hand-written research file with drop tables mined from the game: which boss, chest or activity can drop each unique, aspect, rune and material | 📦 `TreasureClass`, `SpawnPool` | L |

### Builds
| Feature | How | Source | Effort |
|---|---|---|---|
| Maxroll and d4builds import | Public planner data plus page scraping (Playwright / Patchright when needed) | 🌐 | M |
| Build diff and patch impact | After each game patch, diff the datamined affixes, aspects and uniques and show "what changed for your build" | 📦 | M |
| **Full skill tree** | Guided: open the tree; read every node and its rank (lit vs unlit nodes at known positions from the game's skill tree data, tooltips for ranks), panning where needed. Shows your whole tree next to the build's. | 🖥📦 | M |
| **Full paragon** | Every board, its rotation and attachment, every allocated node and glyph, read from the paragon screen against the datamined board grids. Shown as your boards next to the build's, with nodes to (re)spend highlighted on the overlay. | 🖥📦 | L |
| Stat breakpoints | Check key thresholds the guide calls for (attack speed, crit, resistances, armor cap) from the mapped stats | 🖥 | S |
| Mercenaries | Read the active mercenary and reinforcement against the build's picks | 🖥 | S |

### Activities
| Feature | How | Source | Effort |
|---|---|---|---|
| Glyph levelling planner | Pit tier vs glyph upgrade chance, and "runs to reach level N" per glyph | 📦 `GlyphChanceUpgradeEntry`, `ParagonGlyphExperience` | S |
| Nightmare sigil advisor | Read a sigil's affixes; flag dangerous ones for the build; suggest which to run | 📦 `DungeonAffixDefinition` | S |
| World bosses and Uber bosses | Boss mode for every boss: mechanics notes, summon materials, wanted drops | 📦🌐 | S |
| Lair boss materials | Track summon materials and how many kills you can afford | 🖥📦 | S |
| Undercity map helper | Run tracking, floor splits, the countdown warning and reward upgrades are done. Next: point out beacons, Afflicted monsters and the exit on each floor's map (needs map captures from real runs), and suggest which tribute to offer | 🖥📦 | M |
| Prime Evil Nightmares (Labyrinth, Worldstone Keep, Durance of Hate) | Run tracking and boss notes for the season's echoes; which Splinter you carry and what it changes | 🖥📦 | M |
| Legion, strongholds | Run tracking like the Pit; stronghold, cellar and altar completion | 🖥📦 | M |
| Seasonal mechanic module | One module per season (datamined each patch) so the app is ready on day one | 📦 | M per season |
| Bounties and dailies | Read the active bounty or Grim Favor list and plan the shortest route | 🖥📦 `BountyData` | M |

### World and map
| Feature | How | Source | Effort |
|---|---|---|---|
| Interactive map page | Zones, waypoints, dungeons, cellars, Altars of Lilith, strongholds, Helltide chest spawns | 📦 `MarkerSet`, `POI`, `Zone`, `Territory` | L |
| Overlay pins | Show nearby points of interest in the black bars | 📦🖥 | M |
| Helltide route | Chest and event route for the current Helltide zone | 📦🌐 | M |
| Collection progress | Altars, waypoints, cellars and dungeons found per region | 🖥📦 | M |

### Progression and seasons
| Feature | How | Source | Effort |
|---|---|---|---|
| Season Journey tracker | Chapters and objectives with what's left and the fastest way to finish | 📦🖥 `SeasonDefinition` | M |
| Renown / reputation | Per-region progress and rewards | 📦🖥 `ReputationDefinition` | S |
| Achievements and titles | Datamined list with tracking | 📦 `AchievementDefinition`, `PlayerTitle` | M |
| Season and patch countdowns | Season end, patch day, maintenance from Blizzard news | 🌐📦 `Season` | S |
| Event schedule from game data | Validate and extend the timers with the datamined `Schedule` and `Activity` data | 📦 | S |

### Knowledge
| Feature | How | Source | Effort |
|---|---|---|---|
| Search everything | One search box over items, aspects, affixes, monsters, zones, recipes and activities | 📦 | M |
| Coach with game knowledge | Retrieval over the datamined data and the build, so the AI Coach answers from facts | 📦 | M |
| Patch notes digest | Fetch patch notes and summarise them for your build with the local LLM | 🌐 | S |

## Later: platform and polish
- **Multi-language**: the game ships every locale's strings, so the OCR and verdicts can work in other game languages. 📦
- **Fast scene classifier**: a small local model trained on auto-labelled frames (inventory, map, loading, death) to make detection faster and cheaper. 🖥
- **In-app auto-update**: Tauri updater with signed update packages; one click to update.
- **Microsoft Store (MSIX)**: free distribution and automatic updates.
- **Profiles per character**: switch builds, progress and stats per character.
- **Settings backup and export**: move to a new PC or share a setup.
- **Discord Rich Presence**: show the current activity (from our own app, no game hook).
- **Streamer mode**: OBS-friendly overlay scenes; verdict and run widgets as browser sources.
- **Controller-first app UI**: navigate the dashboard entirely from the pad.

## Explicitly not doing
| Idea | Why not |
|---|---|
| d4lf-style TTS / screen-reader DLL | Puts third-party code inside the game process. Exact text, but a ban risk. |
| Reading game memory | Anti-cheat territory, ban risk. |
| Auto-salvage, auto-pickup, macros | Sends input to the game. |
| Packet capture | Against the terms of service. |
| Logging in to Battle.net or D4 Armory with your account | Credentials stay out of the app. |
