// The icon library: one int8 vector per piece of unique art, and the match of a tooltip's art
// against all of them. Built on the player's machine from their own install (extract.ts), kept in
// the app's cache folder keyed by the game build, and never shipped or downloaded.
import { DIMS, MODEL_ID, SIZE, BG, type IconLibrary, type LibraryEntry } from "./types";

/** int8 per dimension (unit vectors x 127): 768 bytes an icon, cosine changes by well under 1%. */
export const quantise = (v: Float32Array, into: Int8Array, at: number) => {
  for (let d = 0; d < v.length; d++) into[at + d] = Math.max(-127, Math.min(127, Math.round(v[d] * 127)));
};

const b64 = {
  encode(bytes: Uint8Array): string {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(s);
  },
  decode(s: string): Uint8Array {
    const raw = atob(s);
    const out = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
    return out;
  },
};

export function packLibrary(entries: LibraryEntry[], vectors: Int8Array, gameBuild: string): IconLibrary {
  return {
    v: 1,
    model: MODEL_ID,
    size: SIZE,
    bg: [BG.r, BG.g, BG.b],
    dims: DIMS,
    quant: "int8/127",
    built: new Date().toISOString(),
    gameBuild,
    entries,
    vectors: b64.encode(new Uint8Array(vectors.buffer, vectors.byteOffset, entries.length * DIMS)),
  };
}

/** A library ready to match against: the vectors as int8, plus the entries. */
export interface LoadedLibrary {
  entries: LibraryEntry[];
  vectors: Int8Array;
  gameBuild: string;
  built: string;
}

/** Null when the library was built by another model or a different square, so it gets rebuilt. */
export function loadLibrary(lib: IconLibrary): LoadedLibrary | null {
  if (lib.v !== 1 || lib.model !== MODEL_ID || lib.dims !== DIMS || lib.size !== SIZE || lib.quant !== "int8/127") return null;
  const vectors = new Int8Array(b64.decode(lib.vectors).buffer);
  if (vectors.length < lib.entries.length * DIMS) return null;
  return { entries: lib.entries, vectors, gameBuild: lib.gameBuild, built: lib.built };
}

/**
 * The best cosine per unique name: a unique has up to one piece of art per class, and the art of a
 * chaos copy is shared, so the score that matters is the best of its pictures. `className` keeps
 * another class's version of the same picture from being the one that matches.
 */
export function matchIcon(lib: LoadedLibrary, query: Float32Array, className?: string): Record<string, number> {
  const out: Record<string, number> = {};
  const n = Math.min(lib.entries.length, Math.floor(lib.vectors.length / DIMS));
  for (let i = 0; i < n; i++) {
    const e = lib.entries[i];
    if (className && e.c && e.c.toLowerCase() !== className.toLowerCase()) continue;
    let dot = 0;
    const at = i * DIMS;
    for (let d = 0; d < DIMS; d++) dot += lib.vectors[at + d] * query[d];
    // the library side is x127: divide once instead of normalising every row
    const cos = dot / 127;
    if (!(e.n in out) || cos > out[e.n]) out[e.n] = cos;
  }
  return out;
}
