# Changelog

What changed in each release. The newest is at the top.
The release workflow publishes each version's section as its GitHub release notes, so add entries under **Unreleased** as you go.

## [Unreleased]

### Added
- Boss mode recognises the world bosses (Avarice, Ashava, Azmodan, Wandering Death), notes that they drop Lair boss summoning materials and Temper Manuals, and stops the timer as soon as "World Boss Defeated" shows.
- **Debug page** (new in the sidebar): shows live what the app is doing and what it thinks is on your screen: the game window, the current activity, what the loot judge saw and why it did or didn't judge, map pins, the skill bar check, and what the overlay is drawing and where. A filterable list shows every decision as it happens.
- **Mark this moment:** press **Ctrl+Alt+D** (or **View + RB** on a controller) when something looks wrong in game. The app saves a full screenshot of the game, what it believed at that moment and the last 90 seconds of what it did, and the overlay shows "Moment saved". Add a note to it afterwards on the Debug page. Works with test mode off; the newest 30 are kept. (Not Ctrl+Shift+D, which is Discord's deafen key.)
- With **test mode** on, the app also keeps a live state file and a log of every decision in its debug folder, sharing test mode's size limit.
- **Create debug report** (Debug page, and **Report a problem** in Settings → About): saves a zip of the debug files, recent loot judgments and test-mode records to your Downloads folder and opens a pre-filled GitHub issue to attach it to. It shows what's included first, and screenshots are left out unless you tick the box (they can show your character name or BattleTag). Your LLM address and API key, Discord webhook and OBS password are never included, and nothing is uploaded for you.
- **Map pins:** open the in-game map and the overlay pins Deckard's journals, Altars of Lilith and the regional collectibles, dungeons, cellars, strongholds and side quests (dimmer, as their spots are approximate) at their real places, at every zoom level. Helltide chest spots show during a Helltide in its zone. The app finds the map from its waypoint icons by screen capture only, and draws nothing when it isn't sure.
  - **Presets:** switch what the pins show in game with **Alt+M** or **View + left stick click** on a controller: Custom, Collectibles, Dungeons & cellars, Quests, Helltide, Everything or Off. The preset's name shows briefly in the map's corner. On the **Overlay** page you pick which presets the key steps through and which kinds Custom shows. The default is quiet: journals, altars and collectibles, and dungeons. If you had the old everything-on defaults, they switch to the quiet ones once.
  - **Unfound only:** altars and regional collectibles the map already shows as found are hidden (or drawn faded, if you turn the option off).
  - Pins stay on the map: they are clipped to the map itself, clear of the side panel, its tab and the boxes drawn over the map. They disappear within a fraction of a second when you close the map or switch to another tab, and while you pan or zoom, then come back when the map settles.
  - The closest zoom works: when you zoom in from a view the app already knows, it follows you in, even with only one waypoint in sight.
- **In-app updates:** when a new version is out, **Settings → About** shows an "Update to vX" button. It downloads the update, checks its signature, installs it and restarts the app. (This version still needs the new installer once; updates are automatic from here on.)
- The app version now shows under the sidebar logo, in **Settings → About** and in the tray icon's tooltip.
- The app checks GitHub for a newer release at start and every 6 hours. When one exists, the sidebar version turns into a link to it.
- **Settings → About** card: check for updates, release notes, GitHub and "Report a problem" links.
- **Test mode** (Setup & Guide, off by default): records every item scan with its screen capture, the tooltip boxes, the text read, the parse and the verdict, along with your game window size and mode, monitor DPI scale, overlay layout and black-bar detection. A new snapshot is saved whenever the window, mode or DPI changes. Recordings go to a test-mode folder next to the judge log (capped at 500 MB by default, oldest first) and open from the Loot page or the Test mode card.

### Changed
- **The loot judge weighs every stat for your build**, not just the few the guide lists for that slot. Stats the build wants on that slot count most. Stats it wants elsewhere, your main stat and ranks to your skills still count. Generic offence and defence count a little; another element's damage or another class's skills barely count. A bigger roll beats a smaller one by how much bigger it is. So a piece with better numbers, or useful stats off the guide's list, is now recognised as an upgrade. The verdict says how it compares ("For your build: better than yours (…)") and lists the biggest differences with numbers.
- Rings are weighed against both of your rings. The game compares a new ring with only one of yours (Alt switches); the judge now also checks your other ring, using what it last saw you wear there.
- Gear you've masterworked and tempered no longer beats a fresh drop just because of that work. Your piece is compared without its masterwork bonus (estimated), and a temper the new item can get too doesn't count against it. The verdict says so.
- **Top-tier items are saved for later** instead of scrapped, even when your build has no use for them: anything with 3★ or more greater affixes, uniques with 2★, and legendaries whose two ★ are on stats your class uses.
- **Occultist steps say exactly what to change:** an imprint names the aspect it replaces, and an enchant names the stat to give up: the one worth least to your build, never a ★ greater affix, the temper or the item's base stat.
- A copy with a cut-off tooltip isn't called better on stats your piece might also have; scroll down to see the full comparison.
- The app is now called **Sanctuary Toolkit**, with a new flaming-sword icon for the window, taskbar, tray and installer. Your settings and data carry over.
- Two installers per release: a small recommended one (about 6 MB, uses the WebView2 runtime Windows already has) and a large offline one that includes it.
- Licensed under the PolyForm Noncommercial License 1.0.0: free for personal and other noncommercial use.
- The loot judge checks what it reads against the game's own text before judging. Misread words are corrected ("Arit10r" becomes "Armor", "Thoms" becomes "Thorns"), while the numbers are kept exactly as read. Anything it isn't sure about is left as it was.
- Icons throughout the app and overlay are now consistent line icons instead of emoji.

### Fixed
- A Helltide no longer "starts" when other text on screen contains the word (an item label like "Helltide Harvest…" in the Undercity did); the app now looks for the Helltide HUD label itself.
- The Pit tier is only picked up from the obelisk's own panel between runs, and only as a real tier number (stray "T10" and "T327" readings came from other text).
- A verdict no longer waits several seconds when the game's EQUIPPED column can't be read instantly: the hovered tooltip's own comparison and what you were last seen wearing are enough, and the AI reads that column afterwards only to refresh the app's memory of your gear.
- **Undercity tributes** are no longer judged as gear (one was taken for an amulet). The verdict says what the tribute earns, how much harder it makes the run (Monster Power, starting time, time bonus penalty) and whether it's one for your build: tributes that earn charms and a Seal are marked "use it" for builds that wear them.
- A tooltip whose title is cut off at the top of the screen is read instantly by its type ("Legendary Sword") instead of waiting several seconds for the AI, which couldn't see the name either.
- A stack count under an item's title ("(2)") no longer ends up in its name, and an item title that reads like a type line ("MYTHIC TRIBUTE") no longer stops the quick read.
- A backpack item could be treated as one you're wearing ("Wearing — this is a stand-in") when an "Unequip" hint from a neighbouring panel was read along with its tooltip. A tooltip that compares itself with your gear is now never taken for your own.
- Tree of Whispers: a two-handed unique whose name doesn't say so (Bloodless Scream, a two-handed scythe) is recognised from its item type, so one-handed weapon caches are no longer ranked first for a two-handed build.
- An item you hover again moves back to the top of the Loot history (it used to stay where it was first judged).
- Charms (even the ones your build uses), seals and Whisper Caches could be told "scrap" when the AI read the tooltip. Your build's charms are kept, other pieces of its charm set are kept, other charms are stashed, and caches are never judged as gear.
- Infernal Hordes offers: the pick no longer jumps between offers. It remembers every offer seen on the offer screen and ranks that set, reads only real offer titles (not description fragments or boss names), starts fresh each wave, and reads your Aether count from the tracker instead of "+2 Aether" in a description.
- The "Open test-mode folder" and judge log buttons open the folder again (the app wasn't allowed to open folders from the page).
- The skill bar check no longer warns about skills your character mapping already read off your bar, and only warns after a skill is missing on three checks in a row, once per session.
- Screen reading could fail silently on some screen areas: when text was enlarged for reading, the image could end up a pixel off the size Windows expected and nothing was read. This affected the Infernal Hordes helper most, which never noticed a Hordes run.
- The Infernal Hordes helper recognises the run despite common misreads ("Infemal Hordes", "WAVE: 10/10"), and reads text on the red Hordes arena.
- AI Coach answers show proper headings, bullet lists and bold text instead of raw `###` and `**` marks.
- The Pit run timer now syncs to the in-game countdown. The pattern that reads it could never match before.
- The farm planner matches aspect names whether or not they include the word "Aspect".
- Link-style buttons no longer show an underline.
- Item names no longer pick up your character's name when the tooltip opens over the Character panel.
- Text from the panel behind a tooltip no longer sticks to the end of a stat ("+100 Intelligence Damage").
- A legendary's power text is no longer mistaken for an affix, so it can't count as a wanted stat by accident. The aspect is now recognised on more items.
- Hovering gear you're wearing from the **Character** panel could tell you to scrap it. The loot judge now knows it's yours (that tooltip offers "Unequip"), reads its full name even when it wraps around a panel label ("Ocelot's Eye of Reanimation"), gets the aspect from the name when the power text is hard to read, and keeps the panel's stats ("Toughness", "Weapon Damage", "Strength"…) out of the item. An item that matches what you wear in that slot is treated as yours, and a scrap verdict now says what your piece has that this one lacks.
- **Character** page, skills: the tooltip's rank includes ranks from your gear, so "34/15" showed up for a skill with 15 points. Skills now show the points you spent and the gear ranks apart ("15 +19"), and only your points are compared with the build. Skills read by an earlier version show their old rank with a "?" until you hover them again.
- **Character** page, stats: the sheet is read against the game's own stat names. Currency, other players' names, section headers and tooltip text no longer show up as stats, and each value goes with the stat on its own row and column. Stats saved by an earlier version are cleaned up once.
- Glyph levels are read when the glyph's name shares a line with other text, and a skill tooltip on the Paragon screen is no longer read as a glyph.

## [0.1.1] - 2026-10-10

### Added
- The installer and the app are now code-signed (Azure Artifact Signing), so Windows shows a verified publisher instead of "Unknown publisher". SmartScreen may still prompt for the first releases while the signature builds reputation.

### Changed
- The window works on narrow and portrait monitors:
  - Below about 1000 px wide, the sidebar shrinks to an icon strip. Hover an icon for the page name, or a status dot for its status.
  - Card rows step down to two columns, then one.
  - Wide tables scroll inside their card instead of spilling past the edge.

### Fixed
- Checkbox labels no longer drop onto their own line.
- The ✕ that clears a controller chord stays next to the chord.
- War Plans tree labels at the left and right edges are no longer cut off.
- The AI Coach subtitle names your configured model instead of always saying "on your Unraid box".

### Behind the scenes
- Automated tests: the loot judge replayed on real tooltips, build import, event timers and the activity helpers.
- GitHub Actions: checks every change, and builds, signs and publishes releases.
- README screenshots, and raw data dumps removed from the repository.

## [0.1.0] - 2026-10-09

First release.

- **Loot judge:** reads item tooltips automatically and gives plain-language verdicts on the overlay (wear, keep, salvage for the aspect, cube, socket, stash, sell or scrap), with temper, masterwork, Occultist and socket steps. Compares against your equipped items, including Alt-compare.
- **Build tracking:** import any Mobalytics build link (featured guides and profile builds), bookmark several, and see an update badge when the author changes one.
- **Activity helpers:** automatic Pit and Nightmare Dungeon run tracking, Infernal Hordes offer and spoils picks, Tree of Whispers cache picks, Helltide cinder plans, boss drop tips and War Plans planning.
- **Guided character mapping:** reads your stats, skills and paragon glyphs with on-screen prompts. Pause and resume any time (F7 or View+Y).
- **Overlays and timers:** world boss, Helltide and Legion timers, panels docked into the black pillarbox bars, and controller chords.
- Screen-reading only: no memory reading, no injection, no input sent to the game.

[Unreleased]: https://github.com/mscrnt/diablo-companion/compare/v0.1.1...HEAD
[0.1.1]: https://github.com/mscrnt/diablo-companion/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mscrnt/diablo-companion/releases/tag/v0.1.0
