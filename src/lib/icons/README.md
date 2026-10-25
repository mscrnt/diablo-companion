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
                  else ask the game data reader    │          (progress back to the main thread)
                  for a plan() of the art to cut ──┘                │
                  (extract.ts, in its worker)                       │
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

## Where the game data comes from

Everything this feature needs from the install is in `GameFiles` and `GameMeta` (`types.ts`), and
the reader in `src/lib/gamedata/` provides them: `registerIcons()` (its `index.ts`) hands them over
with one `registerGameData(...)` call, and `src/lib/gamedata/icons.ts` is the adapter.

It is called when the icon setting is turned on, not at start-up, and again when the game build
changes. Nothing reads a game file until a library actually has to be built. `recognise.ts` waits
for the registration (`onGameData`), so the order doesn't matter; until something registers, the
Settings card says it is waiting for the game data.

Two things are worth knowing about that reader:

- **A finished read deletes its ~110 MB raw copy**, so none of the files the art needs are on disk
  by the time a library is built. `ensure(keys)` copies back just those (the two tables, ~1,100 item
  and actor records, the ~60 sheet payloads: about 140 MB) through the same read-only cascx sidecar,
  and `release()` deletes them again. They go in the build's own `icons/raw` folder so a re-read of
  the same build can't clear them mid-way.
- **The plan is worked out in the reader's worker** (`planIconsInWorker` in its `host.ts`), because
  it parses a couple of thousand records. A reader that gives `meta` instead of `plan` has it worked
  out on the calling thread.

`scripts/dev/icon-plan.ts` runs that same code against a real install with a Node IO
(`node scripts/dev/run.mjs icon-plan`), from an empty raw folder, and reports coverage and timings.

## Where a unique's picture lives

`plan()` tries three links, in this order, because the game uses all three:

1. **the item record's own icon handle** (field hash `0x075d565b`, which the definitions we pin have
   no name for): one picture authored for this exact item. This is what tells a seasonal reskin
   apart from the item whose actor it shares, so it has to come first.
2. **the item record's `tInvImages`**: one handle per class, for armour whose picture is composed
   per class.
3. **the item's actor** (`snoActor` -> `ptItemData[0].hDefaultImage`): one authored picture, which
   is where every weapon, ring and amulet keeps its. The Actor group's format hash isn't in the
   pinned definitions, so it is read as `ActorDefinition` by name.

Two guards on the actor route, because an actor's handle is not always a picture of the item:

- **It has to be in the 2D table and land on a sheet named `2DInventory*`.** Plenty of actors carry
  a handle that points into the component system instead. This is also the check that would catch
  the field moving in a later game build, rather than silently scoring the wrong art.
- **Not for an item type this build composes per class.** Several composed armour uniques share one
  actor, whose handle is then an arbitrary one of their class sheet frames, so for the one among
  them with no picture of its own it is somebody else's art. Which types those are is noticed, not
  listed: any type that resolved through `tInvImages` is one. `eComponentStyleType` looks like it
  should say this and doesn't (two amulets have it set to 1).

Measured on build 3.2.3.73883: 946 of 954 uniques get art (543 through `tInvImages` alone, which is
all there was before), and every weapon, ring, amulet and offhand. Of the eight that get none, seven
are placeholder and test records ("(DNS)", "[ph_...]", `TEST_*`); the eighth is `Wilted Potential`,
whose only candidate is another glove's art through a shared actor. Where the earlier labelling spike
had an opinion (172 names), all 172 land on exactly the same frame.
