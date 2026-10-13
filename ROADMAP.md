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
| **Browse DiabloFilter** | Search and browse public filters from DiabloFilter.com by class, season and text, right in the app. Each result shows the title, "by [author]" and "via DiabloFilter.com", and links to the filter page, where players copy the code. Codes stay on their site (agreed with DiabloFilter, 2026-10-11). The app calls our Worker, which holds the API key as a Cloudflare secret, caches results for up to an hour, and drops filters that disappear from their results. Their limits: 120 requests a minute, 15,000 a day. | 🌐 | S |
| **Filter decoder and diablofilter.com** | Paste any filter code (from diablofilter.com or a friend) and see each rule in plain language, or merge it with build-generated rules. A "Browse filters" button opens diablofilter.com in the browser. Their terms forbid automated access without written permission, so in-app browsing waits on their OK. | 🎮🌐 | S |
| **Snap OCR to the game's own text** | Match every OCR'd line against the datamined affix, aspect, unique and item-type strings (fuzzy plus number-aware), so "Arit10r" becomes "Armor" and garbled item names get corrected. Removes most misreads at the source. | 📦 | S |
| **Fix Character page reading** | Skill ranks read as "31/15" (base vs gear bonus) and stats get mixed up ("Toughness 1,241,124", "Kyldirril"). Parse the character sheet against the datamined stat names, and split base and bonus ranks. **Glyphs:** mapping took the first five in the glyph list, not the ones socketed on your boards (a player's sixth glyph is the one in use, and the app tracked one they dropped long ago): read which glyphs are equipped, from the list's equipped marker or the board sockets (player report, 2026-10-11). | 🖥📦 | S |
| **Roll quality on every affix** | Show "87% of max" next to each affix and greater affix using datamined affix ranges by item power, so "is this a good roll?" gets an exact answer. | 📦🖥 | M |
| **Re-check questionable verdicts** | Audit rules such as "wear this ring" when the swap would lose a unique power. Add these cases as test fixtures. | 🖥 | S |
| **Shared judgements (opt-in)** | Players who opt in send each judgement automatically, so nobody has to remember to send a debug report: the tooltip's OCR lines, how they were read (rules or AI), the verdict and its reasons, the build guide and variant it followed, class, season or eternal, hardcore, resolution, DPI scale and app version. A random install id, no BattleTag, no full screenshots. A "Wrong verdict?" button on the verdict card adds the best signal there is, and an item you later wear is a quiet "good call". Batched to our Worker every few minutes, stored by day in MinIO. Uses: a regression set across every class, build and resolution; verdict disagreements to fix; per-build "what players keep" stats; tooltip art (vectors only) for icon recognition. Off by default, asked once with what's sent, a "see what was sent" view and a one-click stop. Open: keep the text records longer than 30 days once aggregated? Include a small tooltip crop, or text only? (Kenneth, 2026-10-13) | 🌐🖥 | M |
| **Test mode** | One toggle that records each scan (frame, tooltip box, OCR, verdict) along with window size, DPI scale and bar detection, so a play session doubles as a test run across resolutions and window modes. | 🖥 | S |
| **Your build's guide changed** | Re-check the imported guide on Mobalytics now and then (at start and every few hours) and alert when it changed: new or renamed variants ("Under Construction" appeared on a player's guide), different gear, aspects or paragon. Offer to re-import, and show on the overlay which variant the loot judge is following (leveling vs endgame), since judging against the wrong one reads as nonsense (player feedback, 2026-10-12). | 🌐 | S |
| **Overlay placement around other overlays** | The left bar's World Events panel sits right under Discord's voice overlay (top-left). In the bar layout, let each panel pick its bar and order (top or bottom), add a top offset, and a "leave room for Discord" preset; the free layout already lets you drag everything (player feedback, 2026-10-11). | 🖥 | S |
| **Alerts when the game isn't running** | World event and Helltide alerts also show when Diablo IV isn't running, which players like ("it notifies me about world events and HT when I'm not on D4"). Keep that as the default, with a Settings option to only alert while the game is running for those who find it annoying (player feedback, 2026-10-11). | 🖥 | S |
| **Export your stats** | Export runs and splits, loot history, Pit and Helltide bests and mapped character stats as CSV or JSON, to keep, share or chart elsewhere (Kenneth, 2026-10-11). | 🖥 | S |
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
| **DPS check at the training dummy** | Set the dummy to Boss and measure how fast its health bar drains, which counts every hit including minions with no floating numbers to read. Gives exact A/B comparisons ("this ring is +12% damage") right away; absolute DPS once the dummy's max health is mined from the game files. The most asked-for feature in player feedback ("Does it have a damage counter for DPS?", 2026-10-11). | 🖥📦 | M |

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
| **Recognise items by their icon** (optional) | **Off by default**: a Settings switch downloads the model and builds the icon library in the background, with progress, so nobody waits on it. **Model:** SigLIP2 image encoder (Kenneth has had good results with it on Diablo textures), base size at 224–256 px, run locally through ONNX Runtime (CPU, or DirectML on a GPU), exported ONNX builds exist; MobileCLIP2-S0 (about 11M parameters) as a light fallback for slow PCs. **Also in the spike: EmbeddingGemma 2** (Google, Apache 2.0): text, images and audio in one 768-d space (shrinks to 256), about 440M parameters for text + image. It could match an icon to the item's name or power text from the same library, a second vote beside the OCR. Heavier per image than SigLIP2 and no ONNX build yet (we'd export it). Pick by top-1 / top-5 and time per icon on the same test set. The text side is a bonus: a zero-shot "which of these uniques is it" check against item names. **Library:** icons for 831 uniques, 377 charms, 50 gems, 63 runes and 5 seals are already listed in our Mobalytics static data, fetched once on the player's machine and cached; later from the player's own game install (needs a Diablo IV texture decoder, no ready-made one found). Each icon is embedded several times on in-game looks (dark tooltip corner, bag and stash cells with rarity tints, scaled down to grid size), so no fine-tuning is needed to start: about 1,300 icons × 6 looks, a few minutes in the background, rebuilt when the static data changes. **Fine-tuning only if the spike shows confusions** (similar charm or rune art): a small adapter or LoRA trained on the same synthetic looks. **Uses:** names uniques and mythics when the title is cut off or garbled, and names gems, runes, charms, seals, sigils and legendaries' base types **without hovering**: the base for the stash scanner and the keys & socketables tab review. **Spike results (2026-10-12):** on 52 clean icon crops from test mode, SigLIP2-base 67% right first / 77% in the top 5 at ~45 ms a lookup; EmbeddingGemma 2 60% / 81% but ~17× slower, and icon-to-name-as-text fails (0/28: the models don't know the game's art). Armour uniques' icons now come from the game install (tools/datamine/extract-icons.mjs); weapons and jewellery need their sheets' frames labelled locally. **Combine signals rather than trust one:** filter by item type, then score icon similarity + fuzzy title + unique power text + the unique's fixed stat set (no model needed, likely the biggest gain); answer when one candidate is clearly ahead, else say "probably X". Two uniques can share one icon (Deathgrip / Endurant Faith), which the text signals tell apart. A text embedding only for power text, if the test set shows the word-overlap match is the weak link. **GPU:** a Settings choice Auto / CPU / GPU, through ONNX Runtime's DirectML backend (NVIDIA, AMD and Intel on Windows, no CUDA install). Auto builds the library on the GPU while the game isn't running and does lookups on the CPU during play (~45 ms on a hover), so inference never competes with the game for the card; GPU uses it for everything (players with headroom, or heavier models like EmbeddingGemma 2). **Game-art library (2026-10-12):** armour from tInvImages (the player's class picture plus class-agnostic art, no S10 chaos variants) and 249 weapons / jewellery labelled locally from the sheets' frames (near-identical match + clear margin, spot-checked): 67% right first / 84% in the top 5 on the clean set. About half the misses are identical game art shared by two uniques for that class (Mutilator Plate / Razorplate, Deathgrip / Endurant Faith, Paingorger's / Hangman's Hand): only the text signals can split those, and counting them the icon is ~80% right first. The rest are crops that missed the art. **Fine-tuning:** not worth it yet: it can't separate identical art, and the remaining errors are cropping. Next: find the art box in the tooltip instead of a window search, then measure again; if real non-tie errors remain, a small adapter on frozen SigLIP2 embeddings (trainable in minutes) before a LoRA on the encoder (PyTorch + peft on a GPU, exported back to ONNX). **Which build to use:** measure at first run (DXGI adapters: vendor, VRAM, integrated or discrete; CPU threads). A discrete GPU with 4 GB+ free: SigLIP2-base fp16 on DirectML for the library build (an RTX 5090 does ~6 ms an icon, the 9950X3D ~35 ms on the CPU). No discrete GPU: SigLIP2-base fp32 on the CPU (int8 if under 8 threads, once its accuracy is checked). EmbeddingGemma 2 fails on DirectML today (an unsupported Reshape), so it's not offered. **Shipping it:** a prebuilt library (vectors + item ids only, never the icons; about 4 MB at 256-d float16) published as a release asset and downloaded when the feature is switched on, with the local build as the fallback after a patch. Build the published file from the icons in the game install, not Mobalytics' CDN copies, unless Mobalytics agrees (their terms couldn't be checked: 403). Embeddings can't be turned back into the art and the app is noncommercial, but Blizzard's EULA restricts derivative works and data mining, so pull the file if Blizzard or Mobalytics object. Not legal advice. **Spike first:** embed the 831 unique icons, crop the corner icons from the 2026-10-11 marks and scans, and measure top-1 / top-5. Check: whether transmog changes the icon, and grid icons at 1080p (Kenneth, 2026-10-11). | 🌐📦🖥 | M–L |
| Stash scanner | Guided tab-by-tab scan: dupes, upgrades for other builds, salvage list, material totals | 🖥 | M |
| **Keys & socketables tab review** | Open the bag's **Dungeon Keys** or **Socketables** tab and press one key: the app hovers nothing, it reads the tab's tooltips as you sweep over them (or the item grid), then shows one list for the whole tab. Keys: which sigils/compasses/Chronicles to run first for your build (dangerous affixes flagged), which to combine or salvage. Socketables: gems and runes your build uses, which to **combine in the Horadric Cube** (amalgamate lesser into greater, runes into higher runes), and which to sell. Uses the marks taken on 2026-10-11 to learn both tabs' layout. | 🖥📦 | M |
| Cube and recipe helper | Every Horadric Cube and crafting recipe with ingredients and what you can make right now | 📦 `RecipeDefinition`, `Crafter` | M |
| Seals and charms you wear | Remember the seal and charms you wear (read once from the talisman panel), so a spare seal or charm is judged even without the game's comparison column: charm slots, a mythic seal, its powers and set bonuses. Since 0.2.0 a spare seal is already compared when the tooltip shows "Properties lost when equipped" or your seal's column (requested 2026-10-11). | 🖥 | S |
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
| The Tower | Timed leaderboard dungeon from the Pit's obelisk: tell it apart from the Pit, track tier and time, show your best per tier and what beats it | 🖥📦 | S |
| Events inside dungeons | Events that pop up inside a Nightmare Dungeon or the Undercity ("Impromptu Investigation", "Nest", "Cursed Shrine": a timer, a mastery objective) get their own split in the dungeon's run, with the time they took and whether the mastery was met, plus per-event bests (requested 2026-10-11). | 🖥 | S |
| Horadric Strongroom | Time the Strongroom's stages ("I II III IV V VI" on the tracker) with a split per stage and its objective ("Invoke 0/3 Horadric Statues"); seen untracked 2026-10-12 | 🖥 | S |
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
| **News & patches tab** | A News page (and a dismissable overlay toast) with the latest Diablo IV news, patch notes and hotfixes. Checks at start and every 4 hours, plus right after 10:00 Pacific, when patches usually go live. Sources: the official forums' Blizzard-tracker feed (blue posts as JSON, e.g. "HOTFIX 2 – October 6, 2026 – 3.2.2") and the Diablo IV page on news.blizzard.com. Also notices when your local game build changes (from the install folder's build info) and says so: "Diablo IV updated to 3.2.2 — patch notes" | 🌐🖥 | S–M |
| Patch notes digest | Summarise new patch notes for your build with the local LLM: nerfs and buffs to your skills, aspects and uniques, and whether the build guide has caught up. Builds on the News tab | 🌐 | S |

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
