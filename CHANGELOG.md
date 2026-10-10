# Changelog

What changed in each release. The newest is at the top.
The release workflow publishes each version's section as its GitHub release notes, so add entries under **Unreleased** as you go.

## [Unreleased]

### Added
- The app version now shows under the sidebar logo, in **Settings → About** and in the tray icon's tooltip.
- The app checks GitHub for a newer release at start and every 6 hours. When one exists, the sidebar version turns into a link to it.
- **Settings → About** card: check for updates, release notes, GitHub and "Report a problem" links.

### Changed
- Licensed under the PolyForm Noncommercial License 1.0.0: free for personal and other noncommercial use.

### Fixed
- Link-style buttons no longer show an underline.

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
