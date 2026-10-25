// Item art from the player's own Diablo IV install, read-only. A port of
// tools/datamine/extract-icons.mjs, so the library can be built in the app instead of shipped:
//   1. Misc\2D_table.dat: image handle -> texture sheet + frame number
//   2. Texture-Base-Global.dat: every texture's definition (size, pixel format, frame rectangles)
//   3. each unique's image handles, from the three places the game keeps them (see `plan`)
//   4. the payloads (pixel data) of the sheets those icons are on, decoded (BC1/BC3 are documented
//      GPU block formats, see bcn.ts) and each icon's rectangle cut out
// Nothing is modified, decompiled or sent anywhere, and the art never leaves the machine: only the
// vectors made from it are kept.
import { decodeBlocks } from "./bcn";
import type { GameFiles, GameMeta, IconArt, IconPlanVia, IconPlanWire, SheetDef, UniqueRow } from "./types";

/** The game shows the picture for your class: the class sheets name it ("2DInventory_Items_Necromancer"). */
const CLASSES = ["Barbarian", "Druid", "Necromancer", "Rogue", "Sorcerer", "Spiritborn", "Paladin", "Warlock"];
const classOf = (sheet: string) => CLASSES.find((c) => new RegExp(`_${c}\\b`, "i").test(sheet)) ?? null;
/** SNO group 44 = Texture, group 1 = Actor. */
const TEXTURE_GROUP = 44;
const ACTOR_GROUP = 1;
/**
 * The item's own icon handle. The definitions we bundle have no name for this field (hash
 * 0x075d565b, next to hVendorIcon): it is the picture authored for this one item, which is how a
 * seasonal reskin tells itself apart from the item whose actor it shares.
 */
const ITEM_ICON = "unk_75d565b";
/**
 * Only a sheet the inventory UI draws from. The armour actors carry a handle too, but theirs
 * points into the component system rather than at a sheet, and this is also the check that would
 * catch the actor field moving in a later game build instead of silently scoring the wrong art.
 */
const INVENTORY_SHEET = /^2DInventory/i;

/** image handle -> [texture sno, frame number] from Misc\2D_table.dat (a flat table of 12-byte rows). */
function imageHandles(table: Uint8Array): Map<number, [number, number]> {
  const dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const out = new Map<number, [number, number]>();
  for (let o = 4; o + 12 <= table.length; o += 12) out.set(dv.getUint32(o, true), [dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]);
  return out;
}

/**
 * Read a list of meta files, one round trip per batch where the reader can do batches. Only a few
 * file bodies are alive at a time, and the caller gets a chance to breathe between batches.
 */
async function* readChunked<T>(
  files: GameFiles,
  items: T[],
  path: (item: T) => string,
  onBatch?: (done: number) => Promise<void>,
  chunk = 192,
): AsyncGenerator<[T, Uint8Array | null]> {
  for (let i = 0; i < items.length; i += chunk) {
    const slice = items.slice(i, i + chunk);
    const rels = slice.map(path);
    const bufs = files.readMany ? await files.readMany(rels) : await Promise.all(rels.map((r) => files.read(r)));
    for (let j = 0; j < slice.length; j++) yield [slice[j], bufs[j]];
    await onBatch?.(Math.min(i + chunk, items.length));
  }
}

/** One record, or null when it isn't there or this build's layout doesn't match the definitions. */
function parse(meta: GameMeta, buf: Uint8Array | null, opts?: { group?: number; asType?: string }): Record<string, unknown> | null {
  if (!buf) return null;
  try {
    return meta.parseMeta(buf, opts);
  } catch {
    return null; // one unreadable record costs that unique its picture, not the whole library
  }
}

const isRef = (r: [number, number] | undefined): r is [number, number] => !!r;

/** Every image handle the item record itself carries, its own picture first. */
function itemHandles(m: Record<string, unknown>): { own: number[]; perClass: number[] } {
  const own = ((m[ITEM_ICON] as number) ?? 0) >>> 0;
  const perClass = ((m.tInvImages as { hDefaultImage: number }[] | undefined) ?? []).map((x) => x.hDefaultImage >>> 0).filter(Boolean);
  return { own: own ? [own] : [], perClass: [...new Set(perClass)] };
}

/**
 * Work out what to cut before cutting any of it, so the caller can show a total and copy the
 * sheet payloads out of CASC in one go. Reads the tables, not the pixels. `onStep` is called every
 * so often with how far along it is, so the caller can let the page breathe.
 *
 * The game keeps a unique's inventory picture in one of three places, and this tries them in this
 * order:
 *   1. the item record's own icon handle (`ITEM_ICON`): one authored picture for this exact item
 *   2. the item record's `tInvImages`: one handle per class, for armour composed per class
 *   3. the item's actor (`snoActor` -> `ptItemData[0].hDefaultImage`): weapons and jewellery, whose
 *      records carry neither of the above
 * The third one is guarded twice, because an actor's handle isn't always a picture of the item: see
 * `INVENTORY_SHEET` and `perClassTypes`.
 */
export async function plan(files: GameFiles, meta: GameMeta, uniques: UniqueRow[], onStep?: (done: number, total: number) => Promise<void>): Promise<IconPlanWire> {
  // the raw copy is deleted once a read is parsed, so the reader may have to fetch all of this again
  await files.ensure?.(["base:Misc\\2D_table.dat", "base:Texture-Base-Global.dat", ...uniques.map((u) => `base:meta\\${u.sno}`)]);
  const table = await files.read("base/Misc/2D_table.dat");
  if (!table) throw new Error("the image table (Misc\\2D_table.dat) isn't in the game data cache");
  const handles = imageHandles(table);
  const sheetRef = (h: number, inventoryOnly = false): [number, number] | undefined => {
    const r = handles.get(h);
    return r && (!inventoryOnly || INVENTORY_SHEET.test(meta.nameOf(r[0]) ?? "")) ? r : undefined;
  };

  // the uniques' icons first, so only the sheets in use get parsed
  const wanted: { u: UniqueRow; refs: [number, number][] }[] = [];
  const via: IconPlanVia = { perClass: 0, item: 0, actor: 0 };
  /** the ones that name an actor and carry no picture of their own, looked up in a second pass */
  const named: { u: UniqueRow; actor: number }[] = [];
  /**
   * Item types whose picture this build composes per class ("Gloves", "Helm", ...), noticed rather
   * than listed. Several of those uniques share one actor, whose handle is then an arbitrary one of
   * their class sheet frames, so for a record of such a type the actor is not a picture of it.
   */
  const perClassTypes = new Set<string>();
  const noArt: number[] = [];
  // the actor pass adds to the total once pass one knows how many there are
  let total = uniques.length;
  for await (const [u, buf] of readChunked(files, uniques, (x) => `base/meta/${x.sno}`, (done) => onStep?.(done, total) ?? Promise.resolve())) {
    const m = parse(meta, buf);
    const { own, perClass } = m ? itemHandles(m) : { own: [], perClass: [] };
    const ownRefs = own.map((h) => sheetRef(h)).filter(isRef);
    const classRefs = perClass.map((h) => sheetRef(h)).filter(isRef);
    if (ownRefs.length || classRefs.length) {
      wanted.push({ u, refs: [...ownRefs, ...classRefs] });
      if (ownRefs.length) via.item++;
      else {
        via.perClass++;
        perClassTypes.add(u.itemType ?? "");
      }
      continue;
    }
    // one authored picture, kept on the item's own actor
    const actor = (m?.snoActor as { sno?: number } | null)?.sno;
    if (actor) named.push({ u, actor });
    else noArt.push(u.sno);
  }

  const actors = named.filter((a) => !perClassTypes.has(a.u.itemType ?? ""));
  for (const a of named) if (perClassTypes.has(a.u.itemType ?? "")) noArt.push(a.u.sno);

  total = uniques.length + actors.length;
  await files.ensure?.(actors.map((a) => `base:meta\\${a.actor}`));
  for await (const [{ u }, buf] of readChunked(files, actors, (a) => `base/meta/${a.actor}`, (done) =>
    onStep?.(uniques.length + done, total) ?? Promise.resolve(),
  )) {
    // the Actor group's format hash isn't in the definitions we pin, so the type is named here
    const m = parse(meta, buf, { group: ACTOR_GROUP, asType: "ActorDefinition" });
    const h = ((m?.ptItemData as { hDefaultImage?: number }[] | undefined)?.[0]?.hDefaultImage ?? 0) >>> 0;
    const ref = h ? sheetRef(h, true) : undefined;
    if (ref) {
      wanted.push({ u, refs: [ref] });
      via.actor++;
    } else noArt.push(u.sno);
  }

  // those sheets' definitions, out of the one combined meta container
  const sheetIds = new Set(wanted.flatMap((w) => w.refs.map((r) => r[0])));
  const combined = await files.read("base/Texture-Base-Global.dat");
  if (!combined) throw new Error("the texture definitions (Texture-Base-Global.dat) aren't in the game data cache");
  const sheets = new Map<number, SheetDef>();
  for (const [sno, t] of meta.parseCombined(combined, TEXTURE_GROUP, "TextureDefinition")) {
    if (!sheetIds.has(sno)) continue;
    const d = t as { eTexFormat: number; dwWidth: number; dwHeight: number; ptFrame?: { flU0: number; flV0: number; flU1: number; flV1: number }[] };
    sheets.set(sno, {
      sno,
      name: meta.nameOf(sno) ?? String(sno),
      format: d.eTexFormat,
      width: d.dwWidth,
      height: d.dwHeight,
      frames: (d.ptFrame ?? []).map((f) => [f.flU0, f.flV0, f.flU1, f.flV1]),
    });
  }

  const items: IconPlanWire["items"] = [];
  for (const { u, refs } of wanted)
    for (const [sno, frame] of refs) {
      const s = sheets.get(sno);
      if (!s?.frames[frame]) continue;
      const cls = classOf(s.name);
      items.push({
        entry: {
          n: u.name,
          t: u.itemType ?? "",
          ...(cls ? { c: cls } : {}),
          // S10_* entries are the season-10 chaos versions of a unique in another armour slot
          ...(/^S10_/.test(u.id) ? { x: 1 as const } : {}),
        },
        sheet: sno,
        frame,
      });
    }
  return { items, sheets: [...sheets.values()], noArt, via };
}

/**
 * Cut the planned art out, a sheet at a time so only one decoded sheet (up to ~64 MB of RGBA) is
 * in memory at once. Yields in sheet order, not plan order; the caller labels by `entry`.
 */
export async function* cutArt(files: Pick<GameFiles, "read" | "ensure">, p: IconPlanWire): AsyncGenerator<IconArt> {
  const defs = new Map(p.sheets.map((s) => [s.sno, s]));
  const bySheet = new Map<number, IconPlanWire["items"]>();
  for (const it of p.items) {
    const list = bySheet.get(it.sheet);
    if (list) list.push(it);
    else bySheet.set(it.sheet, [it]);
  }
  await files.ensure?.([...bySheet.keys()].map((id) => `base:payload\\${id}`));
  for (const [sno, items] of bySheet) {
    const s = defs.get(sno)!;
    const payload = await files.read(`base/payload/${sno}`);
    if (!payload) continue; // encrypted, or the key isn't available: the other sheets still work
    let rgba: Uint8Array;
    try {
      rgba = decodeBlocks(payload, s.width, s.height, s.format);
    } catch {
      continue;
    }
    for (const it of items) {
      const [u0, v0, u1, v1] = s.frames[it.frame];
      const x0 = Math.round(u0 * s.width);
      const y0 = Math.round(v0 * s.height);
      const w = Math.round(u1 * s.width) - x0;
      const h = Math.round(v1 * s.height) - y0;
      if (w < 8 || h < 8) continue;
      const crop = new Uint8Array(w * h * 4);
      for (let r = 0; r < h; r++) crop.set(rgba.subarray(((y0 + r) * s.width + x0) * 4, ((y0 + r) * s.width + x0 + w) * 4), r * w * 4);
      yield { entry: it.entry, rgba: crop, w, h };
    }
  }
}
