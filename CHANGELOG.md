# Changelog

What changed in each release. The newest is at the top.
The release workflow publishes each version's section as its GitHub release notes, so add entries under **Unreleased** as you go.

## [Unreleased]

### Added
- **Map pins:** open the in-game map and the overlay pins Deckard's journals, Altars of Lilith and the regional collectibles, dungeons, cellars, strongholds and side quests (dimmer, as their spots are approximate) at their real places, at every zoom level. Helltide chest spots show during a Helltide in its zone. The app finds the map from its waypoint icons by screen capture only, and draws nothing when it isn't sure. Pick the kinds on the **Overlay** page.
- **In-app updates:** when a new version is out, **Settings → About** shows an "Update to vX" button. It downloads the update, checks its signature, installs it and restarts the app. (This version still needs the new installer once; updates are automatic from here on.)
- The app version now shows under the sidebar logo, in **Settings → About** and in the tray icon's tooltip.
- The app checks GitHub for a newer release at start and every 6 hours. When one exists, the sidebar version turns into a link to it.
- **Settings → About** card: check for updates, release notes, GitHub and "Report a problem" links.
- **Test mode** (Setup & Guide, off by default): records every item scan with its screen capture, the tooltip boxes, the text read, the parse and the verdict, along with your game window size and mode, monitor DPI scale, overlay layout and black-bar detection. A new snapshot is saved whenever the window, mode or DPI changes. Recordings go to a test-mode folder next to the judge log (capped at 500 MB by default, oldest first) and open from the Loot page or the Test mode card.

### Changed
- The app is now called **Sanctuary Toolkit**, with a new flaming-sword icon for the window, taskbar, tray and installer. Your settings and data carry over.
- Two installers per release: a small recommended one (about 6 MB, uses the WebView2 runtime Windows already has) and a large offline one that includes it.
- Licensed under the PolyForm Noncommercial License 1.0.0: free for personal and other noncommercial use.
- The loot judge checks what it reads against the game's own text before judging. Misread words are corrected ("Arit10r" becomes "Armor", "Thoms" becomes "Thorns"), while the numbers are kept exactly as read. Anything it isn't sure about is left as it was.
- Icons throughout the app and overlay are now consistent line icons instead of emoji.

### Fixed
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
