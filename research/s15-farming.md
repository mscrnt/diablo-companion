# Season 15 farming guide: Kay's "Skeletal Warrior Minions" Necromancer

Research date: 2026-10-09. This covers **Season 15, "Season of Hell's Legacy"**, which launched 2026-09-15 (patch 3.2.0/3.2.1, then hotfix 3.2.2 on 2026-09-29/30).

**Sources.** Most facts come from third-party sites updated for S15: Mobalytics, d4guides.gg, Icy Veins and AOEAH. I could not reach Blizzard's own patch-notes page, so patch facts come from the [Mobalytics S15 patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown).

**Flags.** **(unverified)** means I could not confirm the fact for S15. Where known, the season the information comes from is noted. The same data in machine-readable form is in `s15-knowledge.json`.

---

## 0. The build guide itself

- **URL:** https://mobalytics.gg/diablo-4/builds/necromancer-mages-necro-guide
  - The slug is left over from an older guide. The page title is "Skeletal Warrior Minions", by Kay, updated 2026-09-15 for S15.
  - The older `/profile/kay/builds/minions-skeletal-warrior-guide` is a different, outdated page.
- **Variants:**
  - **Early Game Army:** uses no uniques.
  - **End Game Warriors:**
    - Uniques: The Undercrown, Bloodless Scream, Deathgrip, Blood Moon Breeches and Pact of Bone.
    - Aspects: Hellbent Commander (ring 1), Reanimation (amulet), Hewed Flesh (boots) and Heavenly Strength (chest).
    - Soul Splinters: Anguish (ring 1), Pain (amulet) and Hellfire (ring 2).
    - Runes: Jah + Igni in the pants, Nagu + Wat in the chest.
    - Charms: Black Shroud set plus The Furnace. Temerity is the survivability swap.
    - Ultimate: Army of the Dead.
- **Key tips from the guide:**
  - Get **100% Minion Attack Speed** to fully scale the Cult Leader paragon node.
  - Bloodied affix priority: Berserking every 25 kills, then Movement Speed per tier, then CDR per tier, then XP per tier, then Attack Speed per tier.
- **Caveats:**
  - Recent comments are critical. One says "go with Hand of Naz".
  - The guide's emphasis on Crit Chance conflicts with Splinter of Hellfire, which sets Crit Chance to −100%.
  - The guide's "Grasping Veins / Frenzied Dead" swap refers to aspects that are reportedly no longer obtainable (see section 2).
- **Leveling:** The guide has no leveling section. Kay's separate "Minion Leveling" build (https://mobalytics.gg/diablo-4/builds/necromancer-minion-leveling) is still tagged S14. **(unverified)**

## 1. Uniques: where they drop in S15

Boss pools come from the [Mobalytics boss loot tables](https://mobalytics.gg/diablo-4/guides/diablo-4-boss-loot-tables), updated for S15 on Oct 5 2026. [AOEAH](https://www.aoeah.com/news/4818--diablo-4-season-15-boss-loot-table--legacymythicsuniques-drop-boss) agrees on all five items. **None of the five is an Iconic Mythic.**

| Item | Slot | Best target farm (S15) | Boss cost | Other routes |
|---|---|---|---|---|
| **The Undercrown** | Helm | **Duriel** (Greater Lair Boss, Gaping Crevasse, Kehjistan) | 1 Greater Lair Key | Belial with Duriel's pool selected; random drop; Cube Upgrade to Mythic |
| **Bloodless Scream** | 2H Scythe | **Cube a white 2H Scythe** (see below); or **Astaroth** (end of Escalating Nightmares) | 1 Escalation Sigil | Random drop |
| **Deathgrip** | Gloves | **Grigoire** (Initiate, Hall of the Penitent) | 1 Lair Key | Belial (Grigoire's pool) |
| **Blood Moon Breeches** | Pants | **Astaroth** | 1 Escalation Sigil | Random drop |
| **Pact of Bone** | Ring | **Harbinger of Hatred** (Greater, Nahantu) | 1 Greater Lair Key | Belial (Harbinger's pool) |

**Bloodless Scream from the Horadric Cube**
- The "Craft Unique" recipe takes 1 Common (white) item, 1 Enhanced Primordial Dust and 10 Raw Primordial Dust. It returns a random Unique of the same item type. ([d4guides Craft Unique](https://d4guides.gg/en/database/horadric-cube/craft-unique), [Icy Veins cube overview](https://www.icy-veins.com/d4/guides/horadric-cube-overview/))
- Bloodless Scream is the only known 2H-scythe Unique; Black River is a 1H scythe. That is why Kay calls the result guaranteed. I could not independently verify that S15 has no other 2H-scythe Uniques.
- Older guides list Varshan and Beast in the Ice as its farm. That is S14 info and outdated; those bosses' S15 pools don't include it.

**The Undercrown's "mythic" flag**
- Since S14, Mythic is a quality tier that most Uniques can roll at. A "mythic Undercrown" is therefore the Mythic-quality version of the Unique. ([mein-mmo](https://mein-mmo.de/en/diablo-4-entwertet-was-spieler-an-lord-of-hatred-lobten,1583031/); applying this to the Undercrown is my inference)
- S15 also fixed The Undercrown not consistently increasing max Skeleton Warriors. ([patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown))

## 2. Mythic Uniques in S15

1. **Boss drops.** Lair Bosses and Belial roll Mythics **only from that boss's own pool**, and S15 raised the drop rates.
   - **Belial** has the best odds and lets you **pick which boss's pool** to roll. ([patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown), [Icy Veins Belial](https://www.icy-veins.com/d4/guides/belial-boss-guide/))
   - Mythic chance rises with Torment, from about 0.053% at T1 to 0.4% at T12. ([d4guides](https://d4guides.gg/en/guides/diablo-4-season-15-legacy-uniques-new-mythic-items))
2. **Echo of Mephisto** now has a **guaranteed Mythic** drop. It costs 1 Crux of the False Prophet, from high-Torment activities, and Whisper Key Caches have a small chance to give a Mephisto Key. ([patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown), [Icy Veins lair guide](https://www.icy-veins.com/d4/guides/lair-boss-system-guide/))
3. **Pandemonium (Uber Prime Evils)** drops Mythic Uniques, Mythic Unique Charms and the Hellfire Torch. Section 4 covers how to open it. ([Icy Veins](https://www.icy-veins.com/d4/news/defeat-the-uber-prime-evils-and-earn-a-hellfire-torch-in-diablo-4-season-15/))
4. **Horadric Cube "Upgrade to Mythic"** turns an Ancestral Unique into its Mythic version 1:1. ([Icy Veins S15 crafting](https://www.icy-veins.com/d4/news/mythic-uniques-retain-their-affixes-when-upgraded-and-new-horadric-cube-recipes-diablo-4-season-15-crafting-updates/))
   - It keeps affixes, tempers and masterwork.
   - The result gets a **Crafted** tag, and only one Crafted item can be equipped.
   - It doesn't work on Unmodifiable (Transfigured) items.
   - d4guides lists the cost as about 5 Resplendent Sparks. **(unverified)**
5. **Jeweler and Blacksmith** each offer a random class-appropriate Mythic with no Crafted tag. The Blacksmith also has an Iconic-only cache. Costs are **unverified**.
6. **Season Journey** gives 5 Mythic Unique Caches and up to 10 Resplendent Sparks. ([d4guides S15](https://d4guides.gg/en/season15))

## 3. Boss ladder and summon materials (S15)

Source: [Icy Veins Lair Boss guide (S15)](https://www.icy-veins.com/d4/guides/lair-boss-system-guide/).
- You can fight a boss without a key. The key only opens the hoard, and each player pays their own key.
- Lair bosses need Torment I or higher.

| Material | Where it comes from |
|---|---|
| Lair Key | War Plans, Helltide, World Bosses, Legion events, Tree of Whispers caches |
| Greater Lair Key | Initiate Lair Bosses. Stygian Stones (also from Initiates) convert 1:1 into a Greater key |
| Betrayer's Husk (×2 for Belial) | Belial's Ambush, a small chance after any Initiate or Greater kill |
| Crux of the False Prophet | High-Torment endgame activities; Mephisto Key from Whisper Key Caches |
| Escalation Sigil | Nightmare Dungeons with the "Recurring Nightmare" War Plans node, or cube 5 Nightmare Sigils into 1 |
| Infernal Horde Compass | Occultist; cost dropped to 500 Sigil Powder in 3.2.1. Bartuc is summoned with Aether inside the Horde |

| Tier | Bosses (Necromancer-relevant drops) |
|---|---|
| Initiate (1 Lair Key) | Varshan (Hand of Naz, Hangman's Hand), **Grigoire (Deathgrip)**, Beast in the Ice, Lord Zir (sources disagree on whether he needs a Lair Key or a Greater Lair Key), Urivar |
| Greater (1 Greater Key) | **Duriel (The Undercrown)**, Andariel, **Harbinger of Hatred (Pact of Bone)**, Bloodied Butcher |
| Exalted | Belial (2 Husks; choose any pool), Echo of Mephisto (Crux; guaranteed Mythic) |
| Special | **Astaroth (Bloodless Scream, Blood Moon Breeches)**, Bartuc (Gravewalker's Hand, Omen of Pain, The Unmaker) |
| Seasonal | Echoes of Baal, Mephisto and Diablo, then Pandemonium (see section 4). Nihlathak is a random pop-up Waking Nightmare **(unverified, one commercial source)** |

## 4. S15 systems

### Seasonal mechanic: Splinters of Evil and Prime Evil Powers
Sources: [d4guides S15](https://d4guides.gg/en/season15), [season powers](https://d4guides.gg/en/database/season-powers).
- The seasonal questline has you beat echoes of **Diablo** (Labyrinth), **Baal** (Worldstone Keep) and **Mephisto** (Durance of Hate). Each one gives a Splinter: **Terror**, **Destruction** or **Hatred**.
- You carry **one Splinter at a time**. It gives a Prime Evil Power: Flames of Metus, Ice of Excidium or Ghosts of Odium. It also makes that Prime Evil's echoes ambush you.
- Each power has 6 upgrades at reputation ranks 2, 6, 10, 16, 21 and 24. Reputation comes from Waking Nightmares and "remnants of evils past".
- Each Splinter modifies certain activities:
  - Terror: Helltide and Infernal Hordes
  - Destruction: Undercity and Lair Bosses
  - Hatred: Pit and Nightmare Dungeons
  - All three modify the Tree of Whispers.
- Cubing all three Splinters makes **Wirt's Lucky Coin**. Throw it into the Old Tristram fountain to open **Pandemonium**. ([Icy Veins](https://www.icy-veins.com/d4/news/defeat-the-uber-prime-evils-and-earn-a-hellfire-torch-in-diablo-4-season-15/))
- Sources disagree on the questline order. **(unverified)**
- **Season Journey:** 9 ranks and 125+ objectives. Rewards include up to 14 Skill Points, 42 Paragon points, 10 Resplendent Sparks and 5 Mythic caches. Smoldering Ashes buy the Urns, including the Urn of Masterworking.

### Talismans: Seals and Charms
Sources: [d4guides talisman guide](https://d4guides.gg/guides/miscellaneous/talisman-lord-of-hatred), [Black Shroud set](https://d4guides.gg/en/database/talismans/beru-of-the-black-shroud).
- **What it is:** A Lord of Hatred system. One Seal sets how many Charm slots you get: 3 (normal/magic), 4 (rare), 5 (legendary) or 6 (ancestral/mythic). Charms only work while slotted.
- **Unlock:** At the LoH campaign quest "The Last of the Horadrim".
- **How they drop:** As world drops only.
- **New in S15:**
  - Mythic-quality Unique Charms
  - 24 new charms, including the **Hellfire Torch**, which allows one extra Unique Charm
  - **Annihilus**, the first Unique Seal. It reportedly drops from Uber Diablo after World Bosses. **(unverified)**
- **Peace of the Black Shroud** (Necromancer 5-piece set):
  - Pieces: Berú, Fer, Linta, Mlor and Phoba "of the Black Shroud".
  - (2) Darkness skills deal extra damage over time. The 3.2.1 notes shortened this duration from 30 s to 10 s.
  - (3) 30% Damage Reduction for 5 s.
  - (5) 175%[x] more Shadow/Cold damage plus permanent debuffs.
  - **Missing pieces:** Reroll a set charm into a random piece of the same set in the cube (25 Raw Primordial Dust + 50 Infused Horadric Resin).
- **The Furnace / Temerity charms:** Cube the Unique item + 3 Charms + 1 Enhanced Primordial Dust + 50 Raw Primordial Dust + 100 Infused Horadric Resin.
  - The Furnace is a new S15 Legacy Unique 2H mace. The charm gives 75–100% more damage to Elites.
  - Temerity's charm gives a Barrier from overhealing.
  - Sources: [Furnace recipe](https://d4guides.gg/en/database/horadric-cube/craft-the-furnace-charm), [Temerity](https://d4guides.gg/en/database/talismans/temerity).
- **Where to farm:**
  - T10 Nightmare Escalations with the Recurring Nightmare and Dread Revival War Plan nodes.
  - Infernal Hordes: the Fallen Council drops class set charms, and Bartuc is a source of Mythic Seals.
  - Undercity with Tributes.
  - With the Splinter of Terror at reputation rank 20, the Chest of Talismans costs 1 Aether.

### Horadric Cube
Source: [d4guides cube database](https://d4guides.gg/en/database/horadric-cube), patch 3.2.1.
- **Recipe groups:** Craft Unique (white base to random Unique of that type), Upgrade to Mythic (new), Affix Value Reroll and Horadric Reroll (new), Transfigure, 3-to-1, Recycle Uniques, Craft Unique Charm, Reroll Set Charm, Soul Splinter Amalgamation (5 to 1), and 182 hidden Runeword recipes (white base + Legacy runes).
- **Materials:** Primordial Dust (Coarse, Raw, Refined, Volatile, Pure, Enhanced, Attuned), Infused Horadric Resin, Tuning Prisms and Resplendent Sparks.
- **Where materials come from:** Cube Material Caches from Whispers give about 2–3× more in S15. ([patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown))
- **Kullean Tuning Prism (amulets only):** Used when you transfigure a Mythic Amulet with Volatile Dust. It adds a random bonus Legendary Aspect and keeps the amulet modifiable.
  - Drops from War Plans Cube Spoils, Tree of Whispers caches, Elites and the Undercity. ([d4guides](https://d4guides.gg/en/database/horadric-cube/kullean-tuning-prism))
  - I did not find the exact list of "Kullean transfigured stats".

### War Plans
- **What it is:** Seven activity trees with 7 points each.
- **S15 changes:**
  - Reputation and points are now **shared account-wide** within the same realm, mode and SSF setting.
  - 24 nodes gain seasonal bonuses that need the matching Splinter at a set reputation rank. Examples: Lair of Runes gives extra runes; Exotic Armory gives +3 Uniques from hoards. ([d4guides S15](https://d4guides.gg/en/season15))
  - 3.2.1 raised War Plans XP; T10+ nodes now give 4 XP orbs.

### The Tower
- **What it is:** A 10-minute run over 5 random floors that ends in a Tower Boss, with weekly leaderboards. It is permanent since S14.
- **Unlock:** At the Artificer's Obelisk, through the Season Rank II capstone "Hellish Descent".
- **Rewards:** Halos, Titles, gear caches and Tier 100+ milestones.
- These details come from S14 sources. **(unverified for S15)** ([progametalk](https://progametalk.com/diablo-4/the-tower-guide/))
- The Tower is live in S15: helltides.com's database has an S15 leaderboard entry at Tier 150.

### Soul Splinters (Splinter of Anguish / Pain / Hellfire)
Sources: [d4guides S15](https://d4guides.gg/en/season15), [splinter farming](https://d4guides.gg/en/guides/season/soul-splinter-farming-in-diablo-4-season-15).
- **What they are:** New S15 socketables for jewelry, up to 3 equipped. The names in the build are the **Rare** tier.
  - **Anguish:** +Attack Speed and Crit Chance, +30% resource cost.
  - **Pain:** Damage Reduction, −30% Movement Speed.
  - **Hellfire:** big damage multiplier, −100% Crit Chance.
- **Farm** Nightmare Dungeons or Escalations with the matching sigil affix:
  - Ruby Reserve: Anguish
  - Emerald Reserve: Pain
  - Diamond Reserve: Hellfire
- **Upgrade** by fusing 5 identical Splinters into 1 of the next rarity in the cube.
- **Other source:** Pandemonium drops Unique-tier Splinters.

### Gems and runes
- **Topaz and amethyst:**
  - 3.2.1 cut the Jeweler's Forgotten Soul cost: Royal gems now cost 10 and Grand gems 50.
  - T10+ elites drop many more gems, and Whisper Gem Caches give a Royal or Grand gem.
  - Source: [patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown).
- **Runes:**
  - **Jah:** Legendary Invocation rune. S15 adds a cube recipe: 2× Ber + Grand Sapphire → Jah.
  - **Igni:** Legendary Ritual rune.
  - **Nagu:** Rare Ritual rune ("keep summons active").
  - **Wat:** Rare Invocation rune (Decrepify).
  - Nagu and Wat have no direct cube recipe. Get them from drops, Undercity Rune Tributes, the Lair of Runes War Plan node, or the cube's 3-to-1 rune reroll. ([d4guides runes](https://d4guides.gg/en/database/runes))

### Mercenaries
- **Requirement:** The Vessel of Hatred expansion; mercenaries are hired at the Den.
- **Subo:** Ranged trapper who marks targets; killing marked targets reduces your cooldowns. Quest "A Feather on the Scale".
- **Aldkin:** Shapeshifting caster. Quest "A Nameless Mystery".
- The quest names come from VoH-era guides. **(unverified)**
- **Reinforcement:** A second mercenary that triggers on a chosen Opportunity: on skill cast, when injured, or on crowd control.
- **Rapport:** 10 levels. It resets each season and pays out Pale Marks. ([Icy Veins](https://www.icy-veins.com/d4/guides/mercenaries-guide/), [d4guides Subo](https://d4guides.gg/en/database/mercenaries/subo))

### Aspects and the Codex
- **How you get them:** Since Lord of Hatred, aspects are **drop-only**; no dungeon unlocks a specific aspect. ([Fextralife](https://diablo4.wiki.fextralife.com/Legendary_Aspects))
- **How you upgrade them:** Salvaging a Legendary stores its aspect in the Codex, which keeps the best roll. Upgrade by salvaging better rolls.
- **Cube option:** The cube can turn a Rare into a Legendary with a random aspect. Tuning Prisms pick the category.
- This is confirmed for S13. I found no S15 change, so it is assumed for S15.
- **This build's aspects:**
  - Hellbent Commander, Reanimation and Hewed Flesh: drop-only.
  - **Heavenly Strength:** drop-only. It was nerfed in S15 from 30–40% to 20–30% Damage Reduction.
  - **Grasping Veins and Frenzied Dead:** reported as **no longer obtainable** ([Fextralife](https://diablo4.wiki.fextralife.com/Aspect+of+Frenzied+Dead)).

### Masterworking and tempering
Source: [Wowhead masterworking guide](https://www.wowhead.com/diablo-4/guide/gear/masterworking). All numbers are from S13. **(unverified for S15)**
- **Masterworking cost:** each rank costs 50 Obducite + 1 Forgotten Soul + 2 slot materials (Coiling Ward for armor, Baleful Fragment for weapons, Abstruse Sigil for jewelry). The final rank costs 500 Obducite + 3 Forgotten Souls + 6 Abstruse Sigils.
- **Obducite sources:**
  - Nightmare Dungeons
  - Infernal Hordes "Spoils of Materials"
  - Undercity Tribute of Refinement, which now also gives Forgotten Souls (S15)
  - Mercenary's Den cache
  - Whisper Salvage caches (2–3× in S15)
  - The Urn of Masterworking blessing
- **Tempering:**
  - Cost: Veiled Crystal + Forgotten Soul + a slot material.
  - **Temper Manuals** drop from bosses, World Bosses and Nightmare Dungeons, and are stored per season. ([Fextralife](https://diablo4.wiki.fextralife.com/Temper+Manuals); S4-era drop-source text)

### Bloodied items / Kill Streaks, and Chaos Perks
- **Bloodied items / Kill Streaks:** The **Season 12** mechanic. Bloodied affixes scale with five Kill Streak tiers: Killstreak, Carnage, Devastation, Bloodbath, Massacre. ([Icy Veins S12](https://www.icy-veins.com/d4/news/diablo-4-season-12-adds-bloodied-items-that-grow-with-kills/))
  - No S15 system source mentions it, but Kay's S15 guide still gives a Bloodied affix priority.
  - Status in S15: **unverified**.
- **Chaos Perks:** A **Season 10** mechanic. **(unverified, likely not active in S15)**
- **Infernal Hordes:** Still core in S15.

## 5. Best S15 farming activities

S15-wide changes:
- All Uniques drop from level 1.
- Torment bonus XP: T10 1300%, T11 1500%, T12 1700%.
- Source: [patch rundown](https://mobalytics.gg/diablo-4/news/season-15-patch-notes-rundown).

| Goal | Activity | Notes |
|---|---|---|
| Leveling 1-25 | Seasonal questline + Helltides (Helltide War Plan) | [d4guides leveling](https://d4guides.gg/en/guides/season/diablo-4-season-15-leveling-guide-fast-level-1-70) |
| Leveling 25-70 / Paragon | **Kurast Undercity** | Jade Epiphany node doubles XP orbs in S15. ([ConsolePulse](https://consolepulse.com/multiplatform/diablo/guides/diablo-4-season-15-xp-paragon-farming-guide)) |
| Paragon (dense XP) | **Infernal Hordes** | Spoils of Materials chest gives Obducite (S13 info). Only push T11/T12 if comfortable |
| Gold, mats, keys, gems | **Helltide + Tree of Whispers** | S15 caches: about 3× gold, Royal/Grand gems, 2–3× cube and salvage materials, Key caches with Lair Keys and Mephisto Key chance |
| Lair Keys | World Bosses, Legion events, Helltide, War Plans, Whispers | Times: see `timers.md` |
| Uniques | Lair bosses: Grigoire, Duriel, Harbinger; Astaroth; Belial | Section 3 |
| Mythics | Echo of Mephisto, Belial, Pandemonium, Cube | Section 2 |
| Charms / Seals | T10 Nightmare Escalations, Infernal Hordes (Fallen Council, Bartuc) | Section 4 |
| Soul Splinters | NM Dungeons with Ruby, Emerald or Diamond Reserve | Section 4 |
| Glyphs / Torment unlock | **The Pit** | Pit 10 unlocks Torment 1. S15 raised high-tier Pit XP |
| Leaderboard | The Tower | |

## 6. Recommended progression for this build

This order is my synthesis of Kay's guide and the S15 guides above.

1. **Levels 1–25: questline and Helltides.**
   - Play the Early Game Army variant: Skeletal Warriors, Mages and Golem, with Corpse Explosion and Sever.
   - Imprint Hellbent Commander and Reanimation as soon as they drop.
2. **Levels 25–70: Undercity, plus Bloodless Scream.**
   - Level in the Undercity with Jade Epiphany, and do the Season Rank capstones.
   - Cube a **white 2H Scythe into Bloodless Scream** as soon as you have 1 Enhanced + 10 Raw Primordial Dust.
3. **Level 70 to about Paragon 40: unlock Torment and collect the core uniques.**
   - Clear Pit 10 to unlock Torment 1.
   - Farm Lair Keys from World Bosses, Legions and Helltide.
   - Kill **Grigoire (Deathgrip)**, then use Greater keys on **Duriel (Undercrown)** and **Harbinger (Pact of Bone)**.
   - Run Escalating Nightmares for **Astaroth (Blood Moon Breeches)**.
   - Collect the **Black Shroud** charms and reroll duplicates in the cube.
   - Reach 100% minion attack speed.
4. **Torment 1–9: switch to End Game Warriors.**
   - Upgrade aspects through Codex salvage.
   - Temper for Max Resolve and Attack Speed.
   - Socket Jah/Igni and Nagu/Wat.
   - Craft **The Furnace charm**.
5. **Torment 10–12: Masterwork and Mythics.**
   - Masterwork the core pieces.
   - Farm Echo of Mephisto (guaranteed Mythic) and Belial (pick Duriel's pool for a Mythic Undercrown).
   - Use the Season Journey Mythic caches and Sparks, or the Cube's Upgrade to Mythic (1 Crafted item only).
   - Farm Soul Splinters for Anguish, Pain and Hellfire.
6. **Pit and Tower pushing.**
   - Level Glyphs in the Pit.
   - Run Pandemonium for Mythic charms and the Hellfire Torch.
   - Push The Tower for the leaderboard.

## 7. Unverified or conflicting items (summary)

- **Bloodied affixes and Kill Streaks:** Kay's S15 guide references them, but no S15 system source confirms them.
- **Chaos Perks:** S10 mechanic; S15 status unknown.
- **Tower details:** unlock condition and rewards come from S14 sources.
- **Bloodless Scream from the cube:** "guaranteed" depends on it being the only 2H-scythe Unique. That is true historically, but I did not re-check S15's 9 new Legacy Uniques.
- **Costs not confirmed live:** Cube Upgrade to Mythic, and the Jeweler and Blacksmith Mythic crafts.
- **Lord Zir's key tier:** Icy Veins and Mobalytics disagree.
- **Mercenary quest names:** from VoH-era guides.
- **Seasonal questline order:** sources disagree.
- **Nihlathak and Annihilus drop sources:** each comes from a single, low-reliability source.
- **Exact list of "Kullean transfigured stats":** not found.
- **Aspect of Grasping Veins and Aspect of Frenzied Dead:** reported unobtainable, although the guide still names them.
- **Masterworking costs, Pit material tiers and Temper Manual drop sources:** taken from S13 or older guides.
