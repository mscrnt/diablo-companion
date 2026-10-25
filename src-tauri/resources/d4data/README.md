# d4data (bundled, pinned)

These files describe the **layout** of Diablo IV's own data files. They are not game data: they are
the type definitions and attribute tables from **[DiabloTools/d4data](https://github.com/DiabloTools/d4data)**,
MIT licensed (see `LICENSE` next to this file). The reader in `src/lib/gamedata/` needs them to
parse the files it copies out of the player's install, so they ship with the app as Tauri resources.

The app never downloads anything at runtime, which is why these are committed rather than fetched.

| file                    | what it is                                                 | used by                              |
| ----------------------- | ---------------------------------------------------------- | ------------------------------------ |
| `definitions.json`      | every SNO type, its fields, offsets and format hash        | `d4meta.ts` (the whole parser)       |
| `attributeList.json`    | attribute id to name ("Armor", "Crit_Percent_Bonus")       | affix and paragon attribute lines    |
| `json/snoFileInfo.json` | SNO group number to group name ("StringList", "Affix")     | naming SNO references                |
| `json/snoGroups.json`   | the group list, for reference                               | reference only                       |
| `buildVersion.txt`      | the game build these definitions were generated from       | the cache manifest, and re-read      |
| `LICENSE`               | the MIT licence these files are used under                  | the About / licences list            |

## Pinned to

- Source: `https://github.com/DiabloTools/d4data`, branch `master`
- d4data `buildVersion.txt`: **3.2.1.73552**
- Fetched: 2026-10-09

## Refreshing them after a game patch

Definitions only need refreshing when a patch adds or changes a *type*, which the reader reports as
`markerFormatFallbacks` or a `no type for format hash ...` parse error. To refresh:

```bash
cd src-tauri/resources/d4data
for f in definitions.json attributeList.json buildVersion.txt LICENSE; do
  curl -sSfL -o "$f" "https://raw.githubusercontent.com/DiabloTools/d4data/master/$f"
done
for f in snoFileInfo.json snoGroups.json; do
  curl -sSfL -o "json/$f" "https://raw.githubusercontent.com/DiabloTools/d4data/master/json/$f"
done
```

Then update the "Pinned to" block above, re-run `node tools/datamine/extract.mjs` and diff the
output against the previous run before committing. Bumping `buildVersion.txt` makes every app
install re-read the game data once, which is intended.
