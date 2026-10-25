// Item art from the player's own Diablo IV install, read-only. A port of
// tools/datamine/extract-icons.mjs, so the library can be built in the app instead of shipped:
//   1. Misc\2D_table.dat: image handle -> texture sheet + frame number
//   2. Texture-Base-Global.dat: every texture's definition (size, pixel format, frame rectangles)
//   3. each unique's ItemDefinition.tInvImages: its image handles (one per class)
//   4. the payloads (pixel data) of the sheets those icons are on, decoded (BC1/BC3 are documented
//      GPU block formats, see bcn.ts) and each icon's rectangle cut out
// Nothing is modified, decompiled or sent anywhere, and the art never leaves the machine: only the
// vectors made from it are kept.
import { decodeBlocks } from "./bcn";
import type { GameFiles, GameMeta, IconArt, IconPlanWire, SheetDef, UniqueRow } from "./types";

/** The game shows the picture for your class: the class sheets name it ("2DInventory_Items_Necromancer"). */
const CLASSES = ["Barbarian", "Druid", "Necromancer", "Rogue", "Sorcerer", "Spiritborn", "Paladin", "Warlock"];
const classOf = (sheet: string) => CLASSES.find((c) => new RegExp(`_${c}\\b`, "i").test(sheet)) ?? null;
/** SNO group 44 = Texture. */
const TEXTURE_GROUP = 44;

/** image handle -> [texture sno, frame number] from Misc\2D_table.dat (a flat table of 12-byte rows). */
function imageHandles(table: Uint8Array): Map<number, [number, number]> {
  const dv = new DataView(table.buffer, table.byteOffset, table.byteLength);
  const out = new Map<number, [number, number]>();
  for (let o = 4; o + 12 <= table.length; o += 12) out.set(dv.getUint32(o, true), [dv.getUint32(o + 4, true), dv.getUint32(o + 8, true)]);
  return out;
}

/**
 * Work out what to cut before cutting any of it, so the caller can show a total and copy the
 * sheet payloads out of CASC in one go. Reads the tables, not the pixels. `onStep` is called every
 * so often with how far along it is, so the caller can let the page breathe.
 */
export async function plan(files: GameFiles, meta: GameMeta, uniques: UniqueRow[], onStep?: (done: number, total: number) => Promise<void>): Promise<IconPlanWire> {
  await files.ensure?.(["base:Misc\\2D_table.dat", "base:Texture-Base-Global.dat"]);
  const table = await files.read("base/Misc/2D_table.dat");
  if (!table) throw new Error("the image table (Misc\\2D_table.dat) isn't in the game data cache");
  const handles = imageHandles(table);

  // the uniques' icons first, so only the sheets in use get parsed
  const wanted: { u: UniqueRow; refs: [number, number][] }[] = [];
  let unlinked = 0;
  for (let i = 0; i < uniques.length; i++) {
    const u = uniques[i];
    if (onStep && i % 64 === 0) await onStep(i, uniques.length);
    const buf = await files.read(`base/meta/${u.sno}`);
    const m = buf ? (meta.parseMeta(buf) as { tInvImages?: { hDefaultImage: number }[] }) : null;
    const refs = [...new Set((m?.tInvImages ?? []).map((x) => x.hDefaultImage >>> 0).filter(Boolean))]
      .map((h) => handles.get(h))
      .filter((r): r is [number, number] => !!r);
    if (refs.length) wanted.push({ u, refs });
    else unlinked++;
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
  return { items, sheets: [...sheets.values()], unlinked };
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
