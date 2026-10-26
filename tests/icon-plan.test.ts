// Which piece of art the library is built from: the three places the game keeps a unique's
// inventory picture, and the order they have to be tried in (src/lib/icons/README.md).
//
// Our own shapes, not the game's bytes: the records go in as JSON and a fake reader parses them,
// so this runs anywhere, with no install and nothing from Blizzard in the repo.
import { describe, expect, it } from "vitest";
import { plan } from "../src/lib/icons/extract";
import type { GameFiles, GameMeta, UniqueRow } from "../src/lib/icons/types";

describe("where the game keeps a unique's picture", () => {
  /** Misc\2D_table.dat: a 4-byte header, then [image handle, texture sno, frame] rows. */
  function table2d(rows: [number, number, number][]): Uint8Array {
    const b = new Uint8Array(4 + rows.length * 12);
    const dv = new DataView(b.buffer);
    rows.forEach(([h, sno, frame], i) => {
      dv.setUint32(4 + i * 12, h, true);
      dv.setUint32(8 + i * 12, sno, true);
      dv.setUint32(12 + i * 12, frame, true);
    });
    return b;
  }

  // the sheets a handle can land on, and the one that is not an inventory sheet
  const SHEETS: Record<number, string> = { 10: "2DInventory_Items_Necromancer", 11: "2DInventory_Swords", 12: "2DInventory_Rings", 13: "SomeModelTexture" };
  const TABLE = table2d([
    [0xa1, 10, 3], // the necro armour picture
    [0xa2, 10, 7], // the sorc version of the same armour
    [0xb1, 11, 20], // the sword
    [0xc1, 12, 5], // the ring the actor names
    [0xc2, 12, 9], // the ring the item overrides it with
    [0xd1, 13, 0], // an armour actor's handle: not a sheet the inventory draws from
  ]);

  const UTF8 = new TextEncoder();
  const json = (o: unknown) => UTF8.encode(JSON.stringify(o));

  /** An item record as `plan` reads it: the three places a picture can be named. */
  const item = (o: { own?: number; perClass?: number[]; actor?: number; composed?: boolean }) =>
    json({
      unk_75d565b: o.own ?? 0,
      tInvImages: (o.perClass ?? []).map((h) => ({ hDefaultImage: h })),
      snoActor: o.actor ? { sno: o.actor } : null,
      eComponentStyleType: o.composed ? 1 : 0,
    });

  function reader(files: Record<string, Uint8Array>) {
    const ensured: string[] = [];
    const gameFiles: GameFiles = {
      async read(rel) {
        return files[rel] ?? null;
      },
      async ensure(keys) {
        ensured.push(...keys);
      },
      async build() {
        return "3.2.3.0";
      },
      async uniques() {
        return [];
      },
    };
    const meta: GameMeta = {
      nameOf: (sno) => SHEETS[sno],
      group: () => [],
      parseMeta: (buf) => JSON.parse(new TextDecoder().decode(buf)),
      // one definition per sheet, each 64 px square with 32 frames of 16 px
      *parseCombined() {
        for (const sno of Object.keys(SHEETS).map(Number))
          yield [sno, { eTexFormat: 47, dwWidth: 512, dwHeight: 512, ptFrame: Array.from({ length: 32 }, (_, i) => ({ flU0: 0, flV0: i / 32, flU1: 0.5, flV1: (i + 1) / 32 })) }];
      },
    };
    return { files: gameFiles, meta, ensured };
  }

  const uniques: UniqueRow[] = [
    { sno: 1, id: "Gloves_Unique_Necro_001", name: "Deathgrip", itemType: "Gloves" },
    { sno: 2, id: "1HSword_Unique_Generic_001", name: "Doombringer", itemType: "Sword" },
    { sno: 3, id: "Ring_Unique_Generic_001", name: "Earthbreaker", itemType: "Ring" },
    { sno: 4, id: "Chest_Unique_Generic_001", name: "Tuskhelm", itemType: "Chest" },
    { sno: 5, id: "Gloves_Unique_Necro_002", name: "Wilted Potential", itemType: "Gloves" },
  ];
  const FILES: Record<string, Uint8Array> = {
    "base/Misc/2D_table.dat": TABLE,
    "base/Texture-Base-Global.dat": new Uint8Array(4),
    // armour: a handle per class on the item itself
    "base/meta/1": item({ perClass: [0xa1, 0xa2], composed: true, actor: 900 }),
    // a weapon: nothing on the item, one authored picture on its actor
    "base/meta/2": item({ actor: 901 }),
    // a ring whose own icon handle overrides what its actor says
    "base/meta/3": item({ own: 0xc2, actor: 902 }),
    // armour whose actor handle isn't a sheet the inventory draws from
    "base/meta/4": item({ actor: 903 }),
    // gloves with no picture of their own: Gloves are composed per class (Deathgrip is), so their
    // shared actor's handle is one of those per-class frames and says nothing about this one
    "base/meta/5": item({ actor: 904 }),
    "base/meta/900": json({ ptItemData: [{ hDefaultImage: 0xd1 }] }),
    "base/meta/901": json({ ptItemData: [{ hDefaultImage: 0xb1 }] }),
    "base/meta/902": json({ ptItemData: [{ hDefaultImage: 0xc1 }] }),
    "base/meta/903": json({ ptItemData: [{ hDefaultImage: 0xd1 }] }),
    "base/meta/904": json({ ptItemData: [{ hDefaultImage: 0xa2 }] }),
  };

  const art = (p: Awaited<ReturnType<typeof plan>>, name: string) => p.items.filter((i) => i.entry.n === name);

  it("finds the per-class pictures an armour record carries itself", async () => {
    const r = reader(FILES);
    const p = await plan(r.files, r.meta, uniques);
    expect(art(p, "Deathgrip").map((i) => [i.sheet, i.frame])).toEqual([
      [10, 3],
      [10, 7],
    ]);
    // the sheet names whose version of the picture it is
    expect(art(p, "Deathgrip").map((i) => i.entry.c)).toEqual(["Necromancer", "Necromancer"]);
    expect(p.via.perClass).toBe(1);
  });

  it("follows a weapon's actor, which is where its one picture lives", async () => {
    const r = reader(FILES);
    const p = await plan(r.files, r.meta, uniques);
    expect(art(p, "Doombringer").map((i) => [i.sheet, i.frame])).toEqual([[11, 20]]);
    expect(p.via.actor).toBe(1); // only the sword: the ring's own handle wins over its actor's
  });

  it("prefers the item's own icon handle over its actor's, which is how a reskin differs", async () => {
    const r = reader(FILES);
    const p = await plan(r.files, r.meta, uniques);
    expect(art(p, "Earthbreaker").map((i) => [i.sheet, i.frame])).toEqual([[12, 9]]);
    expect(p.via.item).toBe(1);
  });

  it("ignores an actor handle that isn't a sheet the inventory draws from", async () => {
    const r = reader(FILES);
    const p = await plan(r.files, r.meta, uniques);
    expect(art(p, "Tuskhelm")).toEqual([]);
    expect(p.noArt).toContain(4);
    expect(p.sheets.map((s) => s.sno).sort()).toEqual([10, 11, 12]);
  });

  it("won't take an actor's picture for an item type the game composes per class", async () => {
    const r = reader(FILES);
    const p = await plan(r.files, r.meta, uniques);
    // its actor's handle is a real inventory frame, but it is one of Deathgrip's
    expect(art(p, "Wilted Potential")).toEqual([]);
    expect(p.noArt).toContain(5);
    // so that actor's record is never even asked for
    expect(r.ensured.some((k) => k.endsWith("904"))).toBe(false);
  });

  it("asks the reader to copy the records it needs out of the game, the actors included", async () => {
    const r = reader(FILES);
    await plan(r.files, r.meta, uniques);
    expect(r.ensured).toContain("base:Misc\\2D_table.dat");
    expect(r.ensured).toContain("base:meta\\2");
    // only the ones whose picture is on their actor, and the composed armour is not among them
    expect(r.ensured).toContain("base:meta\\901");
    expect(r.ensured).not.toContain("base:meta\\900");
  });

  it("counts a unique with no picture anywhere instead of failing", async () => {
    const r = reader({ ...FILES, "base/meta/2": item({}) });
    const p = await plan(r.files, r.meta, uniques);
    expect(art(p, "Doombringer")).toEqual([]);
    expect(p.noArt.sort()).toEqual([2, 4, 5]);
  });
});

describe("the art square of an item you wear", () => {
  it("sits below the EQUIPPED bar", async () => {
    const { artBox, artSquare, EQUIPPED_DROP } = await import("../src/lib/icons/crop");
    const box = { x: 1000, y: 200, w: 400, h: 700 };
    expect(artBox(box, false)).toEqual(box);
    expect(artSquare(artBox(box, true)).y - artSquare(box).y).toBe(Math.round(400 * EQUIPPED_DROP));
  });
});
