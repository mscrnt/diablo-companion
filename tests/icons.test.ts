// Recognising an item by its picture: the pieces that have to be exactly right for a library
// vector and a tooltip vector to be comparable (the square, the quantised library, the match) and
// the rule that the picture helps but never outvotes a clear read of the text.
//
// Synthetic vectors, so these run anywhere: no model, no game files, no GPU. The accuracy on real
// data is measured by scripts/dev/icon-eval.ts.
import { beforeAll, describe, expect, it } from "vitest";
import { artInCrop, artSquare, INSET } from "../src/lib/icons/crop";
import { decodeBlocks } from "../src/lib/icons/bcn";
import { loadLibrary, matchIcon, packLibrary, quantise } from "../src/lib/icons/library";
import { l2, letterbox, pixelValues } from "../src/lib/icons/square";
import { BG, DIMS, SIZE, type LibraryEntry } from "../src/lib/icons/types";
import { confident, identifyUnique, WEIGHTS } from "../src/lib/identify";
import { hasGameData } from "./setup";

/** A w x h picture of one solid colour, fully opaque. */
function solid(w: number, h: number, r: number, g: number, b: number, a = 255): Uint8Array {
  const out = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) out.set([r, g, b, a], i * 4);
  return out;
}

const px = (sq: Uint8Array, x: number, y: number) => [sq[(y * SIZE + x) * 3], sq[(y * SIZE + x) * 3 + 1], sq[(y * SIZE + x) * 3 + 2]];

describe("the 224x224 square every vector is made from", () => {
  it("is always SIZE x SIZE whatever the picture's size", () => {
    for (const [w, h] of [
      [64, 64],
      [100, 60],
      [512, 300],
      [1, 7],
    ])
      expect(letterbox(solid(w, h, 200, 100, 50), w, h).length).toBe(SIZE * SIZE * 3);
  });

  it("letterboxes a wide picture with the tooltip colour and centres it", () => {
    const sq = letterbox(solid(224, 112, 200, 100, 50), 224, 112);
    expect(px(sq, 112, 4)).toEqual([BG.r, BG.g, BG.b]); // above the art
    expect(px(sq, 112, 219)).toEqual([BG.r, BG.g, BG.b]); // below it
    expect(px(sq, 112, 112)).toEqual([200, 100, 50]); // the art itself
  });

  it("composites a transparent picture over the same colour, so edges never differ", () => {
    const sq = letterbox(solid(224, 224, 255, 255, 255, 0), 224, 224);
    expect(px(sq, 112, 112)).toEqual([BG.r, BG.g, BG.b]);
  });

  it("normalises the way SigLIP does: 0 becomes -1, 255 becomes +1", () => {
    const v = pixelValues(letterbox(solid(224, 224, 255, 0, 128), 224, 224));
    expect(v.length).toBe(3 * SIZE * SIZE);
    expect(v[0]).toBeCloseTo(1, 5);
    expect(v[SIZE * SIZE]).toBeCloseTo(-1, 5);
    expect(v[2 * SIZE * SIZE]).toBeCloseTo(128 / 127.5 - 1, 5);
  });
});

describe("the library", () => {
  const entries: LibraryEntry[] = [
    { n: "Deathgrip", t: "Gloves", c: "Necromancer" },
    { n: "Endurant Faith", t: "Gloves", c: "Necromancer" },
    { n: "Fists of Fate", t: "Gloves", c: "Sorcerer" },
  ];
  const axis = (i: number) => {
    const v = new Float32Array(DIMS);
    v[i] = 1;
    return v;
  };
  const vectors = new Int8Array(entries.length * DIMS);
  entries.forEach((_, i) => quantise(axis(i), vectors, i * DIMS));
  const lib = loadLibrary(packLibrary(entries, vectors, "3.2.2.73764"))!;

  it("survives packing and loading, keeping the game build it was built from", () => {
    expect(lib).toBeTruthy();
    expect(lib.gameBuild).toBe("3.2.2.73764");
    expect(lib.entries.length).toBe(3);
  });

  it("is thrown away when it was built by another model", () => {
    const stale = { ...packLibrary(entries, vectors, "x"), model: "some-other-model" };
    expect(loadLibrary(stale)).toBeNull();
  });

  it("names the picture it matches, and scores the others near zero", () => {
    const scores = matchIcon(lib, axis(1));
    expect(scores["Endurant Faith"]).toBeCloseTo(1, 2);
    expect(scores["Deathgrip"]).toBeCloseTo(0, 2);
  });

  it("skips another class's version of the art", () => {
    const scores = matchIcon(lib, axis(2), "Necromancer");
    expect("Fists of Fate" in scores).toBe(false);
    expect("Deathgrip" in scores).toBe(true);
  });

  it("l2 makes a unit vector, so a dot product is a cosine", () => {
    const v = l2(Float32Array.from([3, 4, 0]));
    expect(Math.hypot(...v)).toBeCloseTo(1, 6);
  });
});

describe("where the picture is in a tooltip", () => {
  const box = { x: 1000, y: 200, w: 400, h: 1100 };

  it("is a square in the tooltip's top-right corner, as wide as half the tooltip", () => {
    const s = artSquare(box);
    expect(s.w).toBe(200);
    expect(s.h).toBe(200);
    expect(s.x + s.w).toBe(box.x + box.w + 20);
    expect(s.y).toBe(box.y - 48);
  });

  it("maps into a downscaled crop, trimming the frame off", () => {
    // the crop is the padded box at half scale
    const region = { x: 940, y: 50, w: 520, h: 1300 };
    const r = artInCrop(box, region, 260, 650)!;
    expect(r).toEqual({ x: 145, y: 56, w: 90, h: 90 });
    // the trimmed square sits inside the untrimmed one
    const s = artSquare(box);
    expect(r.w).toBe(Math.round(s.w * (1 - 2 * INSET) * 0.5));
  });

  it("gives up when the square isn't fully inside the crop", () => {
    expect(artInCrop(box, { x: 1000, y: 200, w: 400, h: 1100 }, 400, 1100)).toBeNull();
  });

  it("gives up on a tooltip too small for the picture to tell anything", () => {
    expect(artInCrop({ x: 0, y: 40, w: 40, h: 100 }, { x: 0, y: 0, w: 200, h: 200 }, 200, 200)).toBeNull();
  });
});

describe("block-compressed textures", () => {
  it("decodes a BC1 block: the two endpoint colours and the mix between them", () => {
    // 64 px of pitch for a 4x4 texture; one 8-byte BC1 block: c0 = red, c1 = blue, indices 0,1,2,3
    const buf = new Uint8Array(16 * 8);
    const dv = new DataView(buf.buffer);
    dv.setUint16(0, 0xf800, true); // red  (5:6:5)
    dv.setUint16(2, 0x001f, true); // blue
    dv.setUint32(4, 0b11_10_01_00, true); // first row: index 0, 1, 2, 3
    const rgba = decodeBlocks(buf, 4, 4, 47);
    expect([rgba[0], rgba[1], rgba[2], rgba[3]]).toEqual([255, 0, 0, 255]);
    expect([rgba[4], rgba[5], rgba[6]]).toEqual([0, 0, 255]);
    expect(rgba[8]).toBeGreaterThan(rgba[12]); // 2/3 red, then 1/3 red
    expect(rgba[10]).toBeLessThan(rgba[14]);
  });

  it("refuses a payload too small for the size it was told", () => {
    expect(() => decodeBlocks(new Uint8Array(8), 256, 256, 47)).toThrow();
  });
});

describe("the picture as one signal among several", () => {
  // naming a real unique weighs title, power and stats against the whole game data: those tests need it
  const named = it.skipIf(!hasGameData);
  const deathgripPower =
    "Your maximum number of Skeleton Warriors is increased by 2. Skeleton Warriors cleave with their attacks and deal 120% increased damage.";
  const name = (r: ReturnType<typeof identifyUnique>) => confident(r)?.name ?? null;

  named("names the item when the title is lost and only the picture is sure", () => {
    const icon = { "Deathless Visage": 0.98 };
    expect(name(identifyUnique({ title: "", itemType: "Ancestral Unique Helm", power: "", stats: [], icon }))).toBe("Deathless Visage");
  });

  named("a wrong picture never beats a clear title", () => {
    const icon = { "Endurant Faith": 1 };
    const r = identifyUnique({ title: "DEATHGRIP", itemType: "Ancestral Unique Gloves", power: deathgripPower, stats: [], icon });
    expect(name(r)).toBe("Deathgrip");
  });

  named("a wrong picture never beats a clear power on its own either", () => {
    // a bad crop's false high: measured, the worst another unique's art scores is about 0.83
    const icon = { "Endurant Faith": 0.85 };
    const r = identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: deathgripPower, stats: [], icon });
    expect(name(r)).toBe("Deathgrip");
  });

  it("the picture's say stays under the power's, whatever the cosine", () => {
    // the worst case is the same picture scoring 1 for the wrong unique, which only happens when two
    // uniques share their art: then the power has to win on its own
    expect(WEIGHTS.icon).toBeLessThan(WEIGHTS.power);
  });

  named("the picture breaks a tie the text can't", () => {
    const base = { title: "", itemType: "Ancestral Unique Gloves", power: "", stats: [] };
    expect(name(identifyUnique(base))).toBeNull();
    expect(name(identifyUnique({ ...base, icon: { Deathgrip: 0.98 } }))).toBe("Deathgrip");
  });

  it("art two uniques share decides nothing by itself", () => {
    const icon = { Deathgrip: 0.97, "Endurant Faith": 0.97 };
    expect(name(identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: "", stats: [], icon }))).toBeNull();
  });

  named("an unrelated picture (cosine around 0.72) counts for nothing", () => {
    const r = identifyUnique({ title: "", itemType: "Ancestral Unique Gloves", power: "", stats: [], icon: { Deathgrip: 0.72, "Endurant Faith": 0.68 } });
    expect(r[0].parts.icon).toBe(0);
    expect(name(r)).toBeNull();
  });

  it("the icon weight stays under the title's, so the picture can't outvote a name that was read", () => {
    expect(WEIGHTS.icon).toBeLessThan(WEIGHTS.title);
  });
});
