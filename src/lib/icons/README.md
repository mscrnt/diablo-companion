# Recognising items by their icon

One more signal for naming a unique (`src/lib/identify.ts`): how much the picture in the tooltip
looks like each unique's art. A mangled title or a cut-off power is common on a busy screen, and
the picture is a second opinion that doesn't depend on reading text at all.

Account safety is unchanged: the screen is read, the game's files are read, nothing is written,
injected or sent to the game.

## The shape of it

```
          main thread (recognise.ts)                    worker (worker.ts)
   setting on ──► model in the cache folder?   ──┐
                  else download it once from      │ init: ONNX bytes ──► SigLIP2 session
                  our own GitHub release          │                      (WebGPU, else wasm)
                  (model.ts)                      │
                                                  ├─► build: decode the sheets, cut the art,
   library for this game build in the cache?      │          embed every piece, 16 at a time
                  else plan() the art to cut  ────┘          (progress back to the main thread)
                  (extract.ts) ──► the worker                      │
                                                                    ▼
   library saved to the cache, keyed by build  ◄────────────  the int8 library
                                                         (library.ts)

   a tooltip is judged (judgeRunner.ts)
       the crop already taken  ─────────────────►  cut the art square out of it (crop.ts),
                                                  letterbox it (square.ts), one ONNX run,
       scores ◄───────────────────────────────    cosine against every vector
       into identify.ts
```

One run of the model per judged tooltip, and only for a tooltip whose type line says unique or
mythic. Nothing runs while you are not judging something.

Why WebGPU: the point is that the GPU does the matmuls and the CPU stays free for reading the
screen. Without WebGPU the feature stays off and says so, except that an already-built library
still matches on the wasm backend, single-threaded, at about one second a tooltip. Building a
library that way would take a quarter of an hour of CPU, so it isn't offered.

## What is shipped and what is not

- **Shipped:** the code here.
- **Downloaded once, from our own GitHub release:** the SigLIP2 vision encoder in ONNX, checked
  against a SHA-256 the app was built with. Never fetched from Hugging Face at runtime.
  `scripts/build-model-asset.mjs` makes that asset from the Hugging Face model; the owner uploads
  it. Apache 2.0, credited in `licenses/` and in Settings, About.
- **Built on the player's machine, from their own install:** the icon library. No Blizzard art,
  and no vectors made from it, are shipped or downloaded. A vector cannot be turned back into the
  picture.

## Wiring it to the game data reader

Everything this feature needs from the game install is in `GameFiles` and `GameMeta` (`types.ts`).
When the in-app extractor (`src/lib/gamedata/`, with its Rust/cascx file reader) is merged, one
call registers it and this feature starts working:

```ts
import { registerGameData } from "../icons/registry";

registerGameData({
  files: {
    // "base/Misc/2D_table.dat", "base/meta/186283", "base/payload/123456"
    read: (rel) => reader.readRaw(rel),
    // optional: copy these out of CASC if they aren't cached yet
    ensure: (keys) => reader.extract(keys),
    build: () => reader.gameBuild(),          // "3.2.2.73764"
    uniques: () => reader.uniques(),          // { sno, id, name, itemType }[]
  },
  meta: {
    nameOf: (sno) => reader.toc.byId.get(sno)?.[1],
    group: (g) => reader.toc.byGroup[g].entries(),
    parseMeta: (buf) => reader.metaReader.parseMeta(buf),
    parseCombined: (buf, group, asType) =>
      iterCombinedMeta(buf, group).map(([sno, b]) =>
        [sno, reader.metaReader.parseMeta(b, { standalone: false, group, asType })]),
  },
});
```

`recognise.ts` waits for that registration (`onGameData`), so the order of startup doesn't matter.
Until something registers, the Settings card says it is waiting for the game data.

`devio.ts` does the same against a `tools/datamine/extract.mjs` output folder on disk, for dev
builds only; delete it once the real reader is wired in.

## Not done yet

Weapons and jewellery. Their item records carry no image link (`tInvImages` is empty), so
`plan()` finds no art for them and they are counted in `plan().unlinked`. The offline library in
`tools/icons/build-library.mjs` covers them from `data/gamedata/icons/frames/labels.json`, which a
labelling spike produced and which isn't reproducible from the install alone yet. Until that is
solved, the in-app library covers the art the game itself links to a unique (armour, and anything
else with an image link), and weapons are named from their text as before.
