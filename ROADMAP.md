# Roadmap

Everything reads the screen (capture + Windows OCR + local vision LLM). Nothing reads
game memory, injects into the game, or sends input — keep it that way.

## Done
- Event timers (local schedule + helltides.com live names/zones), alerts, Discord, overlay
- Build import (Mobalytics GraphQL / FlareSolverr), static game data, datamined strings
- Loot judge: auto (no hotkey) + hotkey + controller chord, plain-language actions
  (wear / keep yours / scrap / sell / stash / take the power / cube it) with a to-do list
  (Occultist enchant & imprint, Blacksmith temper & masterwork, sockets, cube → mythic)
- Remembers what you're wearing (hover your gear once) for keep-or-swap comparisons
- Guided overlay: setup, black-bar docking, inventory layout learning, gear scan, stats check
- Farm planner with S15 drop sources and boss route; AI coach; runs & splits; screen watchers
- **Skill bar check** — matches the 6 HUD icons against the build's skill icons (passive, every 60 s)

## Next: knowing your skills & paragon

| Feature | How we'd read it | Effort | Confidence |
|---|---|---|---|
| Skill ranks & enhancements | Guided: "hover each skill on your bar" → tooltip OCR reads `Rank X/Y` and the enhancement names; compare with the build's point order | S | High (plain tooltip text) |
| Skill tree allocation | Guided: open the skill tree; vision model compares node highlights to the build's chosen nodes, asks you to scroll/pan for the rest | M | Medium |
| Paragon glyphs & levels | Guided: open Paragon, "hover each glyph socket" → tooltip OCR reads glyph name + level; flag missing/under-levelled glyphs (and plan Pit runs to level them) | S | High |
| Paragon boards & order | Guided: zoom out on the paragon screen; vision model names the attached boards + rotation vs the build's `Starter → Cult Leader → Flesh-eater → Scent of Death → Wither` | M | Medium |
| Paragon node-by-node diff | Template-match the board grid at a fixed zoom against Mobalytics node coordinates; highlight nodes to (re)spend on the overlay | L | Experimental |
| Paragon points available | OCR the "points available" counter; nudge when unspent | S | High |

## Later
- Stash / materials scan (guided tab-by-tab) → masterwork & temper cost planner
- Helltide chest & event locations on a minimap overlay (needs a data source)
- Train a small local screen classifier from auto-labelled frames (inventory, map, loading, death…) for faster scene detection
- Support Maxroll / d4builds imports (Playwright/Patchright scraping)
- Packaged installer + auto-update
