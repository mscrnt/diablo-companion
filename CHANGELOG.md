# Changelog

What changed in each release. The newest is at the top.
The release workflow publishes each version's section as its GitHub release notes, so add entries under **Unreleased** as you go.

## [Unreleased]

### Added
- **Import a build from Maxroll, Icy Veins or d4builds too,** not just Mobalytics: one paste box takes a link from any of the four. Only the build you paste is fetched, nothing is searched or listed, and the build keeps a link back to the page it came from. d4builds imports gear, affixes, tempers, greater and masterwork marks, gems and runes, the skill bar, paragon boards and glyphs, the talisman and the mercenaries. Icy Veins imports all of that except the affixes, which its planner only stores as numbers. Maxroll imports the header, its profiles, the skill bar and the gear it names (runewords, named charms), and says "Unique Ring" where its planner keeps no name.
- **World events predicted by the app itself:** the world boss of every spawn (one slot in the rotation can be either of two bosses, and it says so), its likely zone ("probably Scosglen", right about 2 times in 3), which world bosses also spawn in Nahantu or Skovos, and the zone of every Helltide. Nothing is fetched from other sites any more. A Legion's zone can't be predicted yet.
- **World boss weekly bonus:** every world boss pays one bonus cache a week, and the app tells you whether yours is still waiting. Each world boss row says "Weekly bonus: claimed" or "not claimed yet" for the character you play, and the boss alert adds "You still have this week's bonus". It goes by what it has seen on your screen, the cache the game hands you ("Ashava's Spoils") or the event's own "Weekly bonus claimed", so it never calls a bonus claimed that isn't.
- **Character profiles:** each character has its own builds (several per character, one active), gear, progress, stats and glyphs. The app switches by itself when the Character panel shows a character's name, and runs and loot are labelled by character.
- **The loot judge checks every build of every character:** "Keep it: an upgrade for your Minion build" for this character, "Stash it: great for your Necromancer" for another. It only says scrap when no build of yours can use the item, and an item for another class says so.
- **Infernal Hordes runs are timed,** with a split for every wave and the Fell Council.
- **Events inside dungeons** (Cursed Shrine, Nest, Impromptu Investigation and others) get their own split in the dungeon's run, with how long they took and whether the mastery was met.
- **Horadric Strongrooms are tracked:** the chamber behind the portal in a Nightmare Dungeon gets its own split in the dungeon's run, with how long it took, and a toast for each step (the statues, the Main Chamber, the Artifact Pillar Room, its boss) and each reward upgrade up to 6. If no dungeon run is going, the chamber is timed as a run of its own with a split per step.
- **Glyph levels stay current:** any glyph you hover, and each upgrade at the Pit, updates its level.
- **Export your stats:** runs with splits, bests, loot history and character stats as CSV and JSON files (Runs page or Settings).
- **"Judging for"** on the overlay and the Build page shows which build and variant the loot judge follows.
- Option to only alert while Diablo IV is running.
- **Black bar layout:** panels can be moved and reordered in each bar, also in game in edit mode (Ctrl+Shift+O), and "Leave room for Discord" keeps the top left clear.

### Changed
- **The lookup tables are built from your own game files.** Uniques (Season 15 runewords included), aspects, stats, skills with every skill tree upgrade, gems, runes, charms, seals, Chaos perks, paragon boards, nodes and glyphs, mercenaries and the War Plans trees all come from the install on this PC instead of the copy of another site's data the app used to ship.
- **War Plans** lists the activity trees in the game's order: Tree of Whispers, Nightmare Dungeons, Helltide, The Undercity, Lair Bosses, Infernal Hordes, The Pit (player feedback).
- Up to 100 marked moments are kept (was 30, which a busy session filled in half an hour).
- Shared judgements go out every minute, and any still waiting when the app closes are kept (up to a week) and sent next time; in test mode a copy of each shared picture, blacked out as sent, is saved with the test log.
- Keys, sigils, tributes, caches and other things you carry say "Keep it" instead of "Stash it".
- The seal and charms you wear are remembered, so spare ones are judged even without the game's comparison.
- World event timers no longer fetch anything from other sites, and imported builds are never checked for updates in the background: builds come only from a link you paste.

### Fixed
- Opening the game's War Plans screen no longer shows the Helltide cinders panel (its "Helltide" tab and point counter looked like a Helltide) or starts the Infernal Hordes helper.
- **Tree of Whispers:** cache names that wrap onto two lines ("Greater Collection of / Chestplates", "Ancestral Collection of / Rings") are read whole. Each one was read as a Boots cache, so the advice ranked caches you weren't offered.
- **Loot judge:** a stat your guide lists twice for a slot counts once, so "N of M stats" and the verdict aren't inflated.
- **Boss timer:** only the health bar's name at the very top counts. Your minions ("Skeleton Guardian"), other players and their titles walking past no longer start a fight with Grigoire, Duriel or the Butcher.
- **Keys and other non-gear seen without their title** are never judged as gear: the bottom of an Escalating Nightmare sigil ("Ancient Reservoir in Hawezar") was called boots and scrapped.
- A Chronicle of Nightmares tooltip over the quest tracker no longer starts a Minor Nightmare run, and a misread first cinder count (3,598 for 598) waits for a second read.
- **Helltide cinders** are counted from the first seconds of a Helltide; the timer's hourglass, read as a letter, hid the tracker for up to two minutes.
- **Rings:** each of your two rings is remembered in its own slot, so a ring you replaced no longer leads to a wrong "wear this".

## [0.2.4] - 2026-10-16

### Added
- **Help improve Sanctuary Toolkit:** a new step in the first-run setup, shown once to everyone who upgrades, and a card in Settings.
  - **Share my judgements** (off until you say yes): each loot-judge result goes to the developer, so the judge gets tested on every class, build and screen setup. It sends the item's tooltip text and a picture of the tooltip, the verdict and why, your build guide, and your screen size. Text in the picture that isn't the tooltip (names, chat) is blacked out. Never your BattleTag, character name, chat or a full screenshot. Kept for 30 days. **See what was sent** and **Delete my shared data** are in Settings.
  - **Test mode** can be turned on right there, with how to mark a moment and send a debug report.
- **Wrong verdict?** on the Loot page, with an optional note, and a hotkey to flag the last verdict (**Ctrl+Alt+W**). With sharing on, flags go to the developer with the judgement.

### Fixed
- **Infernal Hordes offers:** all four offers of a wave are ranked. The helper kept only three, the ones its camera read most often, so two players in one run could get different picks. The offer you stand next to (it shows its effects instead of its title) is recognised too, including offers that differ only by a number (2x, 2.25x, 2.5x Aether from spires) or share a title (two "Summoned Hellborne"). The order no longer flips between reads.
- **Undercity:** the boss floor ("FLOOR 4/3") is part of the run, with its own split, and the timer stops when the boss dies. It used to stop as the boss floor began, then start and finish a bogus 2-second run.
- **Boss timer:** another player's title under their name ("Bloodied Butcher") no longer starts a boss fight.
- **Much less CPU, no more lag:** the loot judge read the screen nonstop, about half the time on a 6-core CPU, which made the game lag (player report). It now reads only when your cursor rests (a tooltip can't show while it moves, so fights cost almost nothing), not again over the same spot right away, and never more than about a third of the time.
- **Overlays in the right place when the game runs windowed** (with a title bar): they were placed on the outer window, a border to the left and a title bar too high. Borderless Windowed Fullscreen was fine and stays the same.

## [0.2.3] - 2026-10-13

### Added
- **Minor Nightmares are timed:** the Chronicle's runs through old dungeons ("Diablo II - Den of Evil", "Diablo III - The Scouring of Caldeum") start the timer like a Nightmare Dungeon, split on each objective and stop on "Nightmare Cleansed".

### Fixed
- **White and blue items with no stats of their own** ("RING" / "Ancestral Ring", "Hide Tunic", a blue helm whose rarity word didn't read) are judged by the quick reader. They were passed to the AI read, which called some of them unique or legendary and said to scrap them; without an AI model they couldn't be read at all.
- The AI read always looks at the item it reads the text of: when the mouse had already moved on, it saw the next item's tooltip and mixed the two ("Strider's Crown" judged as magic boots).
- The bottom of a seasonal socketable ("Amalgamable / Account Bound / Seasonal Item") is kept to amalgamate, not scrapped as a unique helm.
- A pickup notice over the tracker ("20 Iron Chunks") isn't taken for part of the dungeon's name.
- No more 3-second Nightmare Dungeon runs right after a clear: while the tracker still says "Dungeon cleared", a line misread as a new dungeon's name ("New", "Priority Quest(s) Available") doesn't start a run.
- **A legendary power that wraps onto a line starting with a number** ("…Critical Strike Chance and" / "50% Critical Strike Damage for 4 seconds") stays part of the power. It was read as a +50% Crit Damage stat, and a ring was called an upgrade on it (player report).
- When a ring or weapon is weighed against your other one, not the one the game compares it with, the verdict says so.

## [0.2.2] - 2026-10-13

### Fixed
- **Map pins stay off the game's boxes over the map:** a hovered icon's popup (a Whisper, a dungeon), the War Plans panel and the Whispers bar. The game's boxes are near-black and the map is light parchment, so a pin with dark all around it is hidden; the game's own icons under a pin don't count.

### Changed
- **Uniques are named from several signals together:** the title, the unique power and the stats the unique always rolls, filtered by the item type. A title that OCR mangles ("IN.?INIT.Y", "TVSKHELm"), merges with the comparison column's item, or misses entirely still gets the right name. On 57 real test items it named 96% right with no confident mistakes, and 91% with the title removed.

## [0.2.1] - 2026-10-12

### Fixed
- **Item reading without an AI model**, at 1920x1080: white and blue items read (they have no rarity word, or it wraps onto a second line: "Ancestral Magic Two-" / "Handed Mace"), and get a sell or scrap verdict instead of "couldn't read this item". A speck of OCR junk under the title no longer loses the name, and a yellow item with one readable stat still gets judged. In one player's session 41 of the 45 unreadable items now read.
- A garbled "Mythic Unique" ("Ancestrah1ya1ic Nique") is still read as mythic, so a mythic is never told to take an imprint at the Occultist.
- **Glyphs:** mapping now records which glyphs are active (the hovered glyph's tooltip offers "Unequip" when it's socketed and "Drag to Equip" when it isn't, in any Paragon layout; the red ring in the full-screen glyph list is the fallback) and every glyph you hover, not just the build's. The Character page shows your glyphs next to the build's, flags a build glyph you don't use ("not active: the build uses it") and lists active glyphs the build doesn't. It used to show the build's five as if you used them.
- Uniques that exist once per weapon type are named for this one: "Infinity (2h Mace)", not "Infinity (Bow)". A title too garbled to match is named from its unique power.

## [0.2.0] - 2026-10-11

### Added
- **Kurast Undercity helper:** a run starts on its own when you enter, with a split for each floor. A panel in the left bar shows the floor, the seconds left, the reward upgrades (N/4) and what fills the attunement bar and adds time. Toasts mark each new floor and each reward upgrade (and "Rewards maxed" at 4/4). When the countdown drops to 15 s you get a warning and a sound. When you leave, the run is saved in Runs & Splits with its time, counting as cleared if you reached the last floor.
- Boss mode recognises the world bosses (Avarice, Ashava, Azmodan, Wandering Death), including health bars that show the title without a comma ("AZMODAN LORD OF SIN"), notes that they drop Lair boss summoning materials and Temper Manuals, and stops the timer as soon as "World Boss Defeated" shows.
- **Debug page** (new in the sidebar): shows live what the app is doing and what it thinks is on your screen: the game window, the current activity, what the loot judge saw and why it did or didn't judge, map pins, the skill bar check, and what the overlay is drawing and where. A filterable list shows every decision as it happens.
- **Mark this moment:** press **Ctrl+Alt+D** (or **View + RB** on a controller) when something looks wrong in game. The app saves a full screenshot of the game, what it believed at that moment and the last 90 seconds of what it did, and the overlay shows "Moment saved". Add a note to it afterwards on the Debug page. Works with test mode off; the newest 30 are kept. (Not Ctrl+Shift+D, which is Discord's deafen key.)
- With **test mode** on, the app also keeps a live state file and a log of every decision in its debug folder, sharing test mode's size limit.
- **Send debug report** (Debug page, and **Report a problem** in Settings → About): sends the developer a zip of the debug files, recent loot judgments and test-mode records, and gives you a report ID to mention if you open a GitHub issue. It shows what's included first, and screenshots are left out unless you tick the box (they can show your character name or BattleTag). You can add a note about what went wrong; it goes into the report and into the GitHub issue form if you open one. Reports are stored privately and deleted after 30 days. Your LLM address and API key, Discord webhook and OBS password are never included. If sending fails, or you pick **Save it instead**, the zip is saved to your Downloads folder with a pre-filled GitHub issue to attach it to.
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
- Gear you've masterworked, tempered or enchanted no longer beats a fresh drop just because of that work. Your enchanted stat is credited to the new item too (it can get the same enchant, giving up its weakest stat). Your piece is compared without its masterwork bonus (estimated), and a temper the new item can get too doesn't count against it. The verdict says so.
- **Top-tier items are saved for later** instead of scrapped, even when your build has no use for them: anything with 3★ or more greater affixes, uniques with 2★, and legendaries whose two ★ are on stats your class uses.
- **Occultist steps say exactly what to change:** an imprint names the aspect it replaces, and an enchant names the stat to give up: the one worth least to your build, never a ★ greater affix, the temper or the item's base stat.
- A copy with a cut-off tooltip isn't called better on stats your piece might also have; scroll down to see the full comparison.
- The app is now called **Sanctuary Toolkit**, with a new flaming-sword icon for the window, taskbar, tray and installer. Your settings and data carry over. Installing it over 0.1.x removes the old "D4 Companion" install, so only one app is left in the Start menu and in Installed apps.
- Two installers per release: a small recommended one (about 6 MB, uses the WebView2 runtime Windows already has) and a large offline one that includes it.
- Licensed under the PolyForm Noncommercial License 1.0.0: free for personal and other noncommercial use.
- The loot judge checks what it reads against the game's own text before judging. Misread words are corrected ("Arit10r" becomes "Armor", "Thoms" becomes "Thorns"), while the numbers are kept exactly as read. Anything it isn't sure about is left as it was.
- Icons throughout the app and overlay are now consistent line icons instead of emoji.

### Fixed
- **Wear verdicts were too eager.** A cut-off tooltip hid stats from your piece ("Properties lost when equipped"), so they weren't counted: the stats of the piece you were last seen wearing now fill the gap. The roll on the same unique's power counts (230% vs your 235%), and so does the game's own Toughness change. "Wear this" needs a clear gain, and not one that gives up nearly as much as it adds ("a trade, not an upgrade"). The reasons always show the biggest loss, and a number compared without your masterwork says so ("vs yours 476 (about 414 before its masterwork)").
- The judge never tells you to imprint an aspect onto a unique (you can only change its stats); a unique in a slot your build fills with an aspect counts against it.
- A spare seal is no longer told "keep it, your build uses a seal" when the one you wear is better: with the game's comparison showing, a mythic seal, more charm slots or more seal powers win ("Salvage it: the seal you wear is better (1 more charm slot and 3 seal powers this one doesn't have)").
- **Nightmare Dungeons**: a split only when the objective really changes (two reads agree), not on every OCR slip ("Seaborn"/"Seabom", a damage number glued on). The timer stops on "Dungeon cleared" instead of when you walk out.
- **Escalating Nightmares** are timed stage by stage ("Nightmare Escalation Tier 1"), each stage named after its dungeon, and the next stage starts its own run right away.
- **The Pit** no longer finishes when you die and revive at the checkpoint (the loading screen hid "Slay the Boss"). It finishes on "Dungeon cleared", or when the boss objective has been gone for a few seconds while the Pit's tracker still shows.
- Lair bosses are recognised from their health bar ("TORMENTED ECHO OF URIVAR +3" is Urivar), and the boss panel also shows inside dungeons while the dungeon's run keeps the time.
- Hovering an Infernal Hordes compass in the bag no longer brings up the Hordes panel when OCR garbles the word "Compass".
- A seal whose title the capture missed is no longer scrapped as off-hand gear: "Unlocks N Charm Slots" makes it a seal.
- Hovering one item no longer re-judges it every second: an item is recognised by its numbers, not its title, which the stylised font reads differently each time.
- A unique whose title the capture missed is named from its unique power ("Unique Gloves" is Paingorger's Gauntlets), and the base armor line is never counted as a ★ greater affix (a 4★ item was called 5★).
- **Map pins hide while you drag the map** (a mouse button held on the open map) and come back once it's let go and the map is still. A slow drag used to leave them sliding over the map.
- The black-bar layout no longer switches off for a whole session when one early frame (a loading screen) showed no bars: the samples that agree win, so the loot judge panel and its picture, and the toasts, stay in the bars.
- Helltide cinders no longer jump on one misread frame (283 → 3 → 387): a drop or a big jump must be read twice.
- Dungeon Caches and Experience Tomes get "Open it" / "Use it" instead of "couldn't read this item".
- Tree of Whispers: caches that score the same no longer swap places on every read.
- A mythic you wear whose name the comparison column garbles ("Blood Mo N Che G") is still known as your build's unique.
- Player-facing text no longer uses em dashes.
- Unique and mythic names misread in the title font are matched to the real name ("TYRÄEL'S rn1Gi4T" is Tyrael's Might).
- When an item can't be read (a failed AI read, or a tooltip that isn't an item), the card says "Couldn't read this item" with what to do, instead of disappearing.
- Helltide: the cinder count no longer jumps to the HUD's other counter when the cinders aren't read, and opening the bag or the map no longer ends the Helltide (it ends after 90 s without the HUD).
- An Undercity run left open by an app restart is picked up again when its tracker shows, or closed after 90 s, instead of its timer running forever.
- Keys are never told to scrap: an Infernal Hordes compass ("it opens the Infernal Hordes"), Escalation sigils (an Escalating Nightmare) and Nightmare sigils (a Nightmare Dungeon) each say what they open, and the bottom half of a Chronicle tooltip is no longer taken for a ring. Hovering a compass in the bag no longer starts a Hordes run.
- Tribute advice comes from what the tribute earns, not from other text on screen (a Tribute of Armaments was called a charm tribute).
- Greater affixes (★) were missed on some items, so a 4★ legendary could be told to scrap: the starburst can be pale peach rather than orange, and OCR sometimes reads it as a "*" in front of the stat. Both now count.
- Items in the bag's right-hand columns, and some tributes, were treated like loot on the ground (no verdict card, or only a late badge): their tooltip covers the CHARACTER header the app looked for. The tooltip's own footer (Equip, Mark as Junk, Hide Comparison, Take, Sell) now also tells it a menu is open.
- Undercity: a run no longer ends or splits in two when the map, the inventory or a loading screen hides the quest tracker for a while. It ends when the game shows the run is complete ("FLOOR 4/3"), or after 90 s without the tracker if you leave. The end area after a clear no longer starts a phantom run, and a run's time stops when it was last seen, not when the app noticed.
- **Chronicles of Nightmares** were told "sell it" as if they were off-hands. They're kept now, with a note to use them on a Waking Nightmare, their theme and their affixes.
- Helltides are recognised again from the HUD label as Windows reads it ("Helitide:", "e//tide."), while other text containing the word (an item label like "Helltide Harvest…") no longer starts one. When the HUD timer is misread, the event schedule's end time is used.
- The Pit tier is only picked up from the obelisk's own panel between runs, and only as a real tier number (stray "T10" and "T327" readings came from other text).
- A verdict no longer waits several seconds when the game's EQUIPPED column can't be read instantly: the hovered tooltip's own comparison and what you were last seen wearing are enough, and the AI reads that column afterwards only to refresh the app's memory of your gear.
- **Undercity tributes** are no longer judged as gear (one was taken for an amulet). The verdict says what the tribute earns, how much harder it makes the run (Monster Power, starting time, time bonus penalty) and whether it's one for your build: tributes that earn charms and a Seal are marked "use it" for builds that wear them.
- A tooltip whose title is cut off at the top of the screen is read instantly by its type ("Legendary Sword") instead of waiting several seconds for the AI, which couldn't see the name either.
- An item type misread by OCR ("ii/ölakic Scythe" for Magic Scythe) no longer gets glued onto the item's name, and a slot label from the Character panel behind a tooltip ("Boots") is no longer taken for the item's type.
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

[Unreleased]: https://github.com/mscrnt/diablo-companion/compare/v0.2.4...HEAD
[0.2.4]: https://github.com/mscrnt/diablo-companion/compare/v0.2.3...v0.2.4
[0.2.3]: https://github.com/mscrnt/diablo-companion/compare/v0.2.2...v0.2.3
[0.2.2]: https://github.com/mscrnt/diablo-companion/compare/v0.2.1...v0.2.2
[0.2.1]: https://github.com/mscrnt/diablo-companion/compare/v0.2.0...v0.2.1
[0.2.0]: https://github.com/mscrnt/diablo-companion/compare/v0.1.1...v0.2.0
[0.1.1]: https://github.com/mscrnt/diablo-companion/compare/v0.1.0...v0.1.1
[0.1.0]: https://github.com/mscrnt/diablo-companion/releases/tag/v0.1.0
