# Diablo IV loot filter codes

The in-game loot filter (Game menu → Loot Filter, added with Lord of Hatred) exports and imports a filter as a code. The code is **base64-encoded protobuf**. Decoded from codes exported in game (samples below) and checked against the datamined game files.

## Structure

```
Filter
  1  rule        (repeated, message)
  2  name        (string)
  3  slot        (varint) local filter number; increments per filter (1, 2, 3...)
  4  version?    (varint) always 1 so far

Rule
  1  name        (string, optional; absent when the rule is unnamed)
  2  action      (varint) 0 = Show, 2 = Recolor, 3 = Hide   (1 not seen yet)
  3  colour      (fixed32) ARGB, e.g. 0xFFFF0000 = red; present even when unused
  4  condition   (repeated, message) an item must meet ALL conditions
  5  enabled     (varint) 1

Condition
  1  type        (varint)
  2  ids         (repeated fixed32) game SNO ids, meaning depends on type
  4  value       (varint) meaning depends on type
  5  value2?     (varint) presumably the maximum for Item Power Range (not seen yet)
  6  flag        (varint) seen as 1 on Greater Affix Check
```

### Condition types

| type | In game | Fields | Seen |
|---|---|---|---|
| 0 | Item Power Range | 4 = minimum (5 = maximum, presumably) | min 800 |
| 1 | Item Rarity Match | 4 = bitmask (Rare = 4; Common 1, Magic 2, Legendary 8 … presumed) | Rare |
| 2, 3, 7 | not seen yet: likely Item Properties, Matches Favorite Aspect, Unique Modifier | | |
| 4 | Greater Affix Check | 4 = count, 6 = 1 (probably "at least") | 1 |
| 5 | Item Type Match | 2 = ItemType SNO ids | Gloves = 446833 |
| 6 | Has Specific Affixes | 2 = Affix SNO ids, 4 = how many of them must match | Crit Chance (S04_CritChance) = 1829582, 1 of |
| 8 | Is Specific Unique | 2 = Item SNO ids | Deathgrip (Gloves_Unique_Necro_104) = 2587890 |

IDs are the game's own SNO ids: ItemType from the CoreTOC `ItemType` group (161 entries), Affix and Item SNOs as in `data/gamedata/affixes.json`, `items.json` and `uniques.json`.

## Samples

| Name | Rule | Code |
|---|---|---|
| Hide rare items | Hide, Item Rarity = Rare | `Cg8QAx0AAP//IgQIASAEKAESD0hpZGUgcmFyZSBpdGVtcxgBIAE=` |
| recolor red | Recolor red, Item Type = Gloves | `ChIQAh0AAP//IgcIBRVx0QYAKAESC3JlY29sb3IgcmVkGAIgAQ==` |
| Power | Show, Item Power ≥ 800 | `ChAQAB0AAP//IgUIACCgBigBEgVQb3dlchgDIAE=` |
| greater | Show, Greater Affix count 1 | `ChEQAB0AAP//IgYIBCABMAEoARIHZ3JlYXRlchgEIAE=` |
| affix | Show, Has Specific Affixes = Critical Strike Chance | `ChQQAB0AAP//IgkIBhXO6hsAIAEoARIFYWZmaXgYBSAB` |
| unique | Recolor (0xFF3600FF), Is Specific Unique = Deathgrip | `ChIQAh3/ADb/IgcICBXyfCcAKAESBnVuaXF1ZRgGIAE=` |

## Still to confirm

- The rarity bitmask for other rarities (a Legendary-only sample would settle it).
- Item Power maximum, and condition types 2, 3 and 7.
- Whether the game accepts codes it didn't create (expected, since diablofilter.com shares them, but test the generator's output by importing it).
- The 25-rule limit per filter.
