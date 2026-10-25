// Recognising an item by its picture: the shapes the pieces pass between each other.
//
// The chain is: the game's own texture sheets -> one 224x224 square per piece of unique art ->
// a SigLIP2 vector per square (the library) -> at judge time, the same for the art in the
// tooltip, and the cosine against every library vector feeds identify.ts.
//
// Nothing from the game is shipped or downloaded: the library is built on the player's machine
// from their own install, and a vector can't be turned back into the picture.

/** The square every vector is made from. The model's input size; don't change without rebuilding. */
export const SIZE = 224;
/** The dark tooltip corner the art sits on in game: the letterbox colour for every square. */
export const BG = { r: 22, g: 19, b: 17 };
/** SigLIP2-base pooler_output width. */
export const DIMS = 768;
/** The model the library's vectors come from; a library built by another model is thrown away. */
export const MODEL_ID = "onnx-community/siglip2-base-patch16-224-ONNX";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One piece of art in the library: the unique it belongs to, and whose version of it. */
export interface LibraryEntry {
  /** the unique's name, as the static tables spell it (the key identify.ts matches on) */
  n: string;
  /** item type ("Gloves", "Two-Handed Mace"), for debugging the matches */
  t: string;
  /** the class whose version of the art this is, when the sheet names one */
  c?: string;
  /** 1 = a season-10 chaos copy of a unique in another slot (shared generic art) */
  x?: 1;
}

/**
 * The built library: the entries and their vectors, quantised to int8 (unit vectors x 127, so
 * 768 bytes an icon and a cosine that changes by well under 1%).
 */
export interface IconLibrary {
  v: 1;
  model: string;
  size: number;
  bg: [number, number, number];
  dims: number;
  quant: "int8/127";
  built: string;
  /** the game build the art came from ("3.2.2.73764"): a patch invalidates the library */
  gameBuild: string;
  entries: LibraryEntry[];
  /** entries.length * dims int8 values, base64 */
  vectors: string;
}

/** A unique as the extractor needs it: enough to find its art and to label the vector. */
export interface UniqueRow {
  sno: number;
  id: string;
  name: string;
  itemType?: string;
}

/** One texture sheet: its size, pixel format and the rectangle of each frame on it. */
export interface SheetDef {
  sno: number;
  name: string;
  format: number;
  width: number;
  height: number;
  /** [u0, v0, u1, v1] per frame, as fractions of the sheet */
  frames: [number, number, number, number][];
}

/** How many uniques each of the three links the game keeps found art for. */
export interface IconPlanVia {
  /** the item record's per-class list (`tInvImages`): armour, whose picture is composed per class */
  perClass: number;
  /** the item record's own icon handle: seasonal reskins, and the weapons that override their actor */
  item: number;
  /** the item's actor: weapons and jewellery, whose one authored picture lives there */
  actor: number;
}

/**
 * What to cut and where from, worked out before any pixels are read, so the build can show a total
 * and the worker can be handed the whole job in one message (plain arrays: it crosses postMessage).
 */
export interface IconPlanWire {
  items: { entry: LibraryEntry; sheet: number; frame: number }[];
  sheets: SheetDef[];
  /** the uniques (by SNO) none of the three links found art for, for the debug log and the dev tools */
  noArt: number[];
  via: IconPlanVia;
}

/** One square of art cut out of a sheet, ready to be embedded. */
export interface IconArt {
  entry: LibraryEntry;
  /** RGBA, w*h*4 */
  rgba: Uint8Array;
  w: number;
  h: number;
}

/**
 * Read-only access to the game's data files. The icon code never touches CASC itself: it asks for
 * a file by its path inside the raw cache ("base/Misc/2D_table.dat", "base/meta/186283") and gets
 * bytes back, so the same code works against the extractor's cache on disk and against the
 * Rust/cascx reader. See src/lib/icons/README.md for wiring.
 */
export interface GameFiles {
  /** The file's bytes, or null when it isn't there (encrypted, or not in this build). */
  read(rel: string): Promise<Uint8Array | null>;
  /**
   * The same in one round trip, in the same order, null for the ones that aren't there. Optional,
   * but worth having: the plan reads a couple of thousand small files.
   */
  readMany?(rels: string[]): Promise<(Uint8Array | null)[]>;
  /**
   * Make sure these files are in the raw cache, copying them out of CASC if they aren't.
   * Keys are CASC names ("base:Misc\\2D_table.dat", "base:payload\\123456"). Optional: a reader
   * that already has everything on disk leaves it out.
   */
  ensure?(keys: string[]): Promise<void>;
  /**
   * The library is built: whatever `ensure` copied out can go again. Optional, and called once the
   * art has been embedded (the app's reader deletes its raw copy after every read, so the copies
   * this feature asks for are its own to clean up).
   */
  release?(): Promise<void>;
  /** The game build the files came from ("3.2.2.73764"), the library's cache key. */
  build(): Promise<string>;
  /** The uniques of this build, with their SNO ids. */
  uniques(): Promise<UniqueRow[]>;
}

/**
 * The SNO meta reader (a port of tools/datamine/lib/d4meta.mjs). Only the four calls the icon
 * extractor needs, so it can be satisfied by the gamedata port with a few lines.
 */
export interface GameMeta {
  /** The name of a SNO id ("2DInventory_Items_Necromancer"). */
  nameOf(sno: number): string | undefined;
  /** Every (id, name) in a SNO group (44 = Texture). */
  group(group: number): Iterable<[number, string]>;
  /**
   * Parse a standalone meta file (base/meta/<id>). `asType` names the type to read it as, for a
   * group whose format hash the bundled definitions don't know (the Actor group needs it).
   */
  parseMeta(buf: Uint8Array, opts?: { group?: number; asType?: string }): Record<string, unknown>;
  /** Parse the entries of a combined meta container (Texture-Base-Global.dat) as `asType`. */
  parseCombined(buf: Uint8Array, group: number, asType: string): Iterable<[number, Record<string, unknown>]>;
}
