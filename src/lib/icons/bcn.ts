// Block-compressed texture decoding (the documented GPU formats BC1 / DXT1 and BC3 / DXT5) to RGBA.
// Which one a sheet uses comes from its size: BC1 stores 4 bits a pixel, BC3 8 (mip 0 comes first).
//
// A port of tools/datamine/lib/bcn.mjs with no Node Buffer, so it runs in the worker.

const rgb565 = (c: number): [number, number, number] => [
  (((c >> 11) & 31) * 255) / 31 | 0,
  (((c >> 5) & 63) * 255) / 63 | 0,
  ((c & 31) * 255) / 31 | 0,
];

const u16 = (b: Uint8Array, o: number) => b[o] | (b[o + 1] << 8);
const u32 = (b: Uint8Array, o: number) => (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) >>> 0;

type Rgba = [number, number, number, number];

/** The 4 colours of a BC1 colour block; `alpha` = the 3-colour + transparent mode is allowed (BC1 only). */
function palette(c0: number, c1: number, alpha: boolean): Rgba[] {
  const a = rgb565(c0);
  const b = rgb565(c1);
  const mix = (f: (x: number, y: number) => number): Rgba => [f(a[0], b[0]), f(a[1], b[1]), f(a[2], b[2]), 255];
  if (c0 > c1 || !alpha)
    return [
      [...a, 255] as Rgba,
      [...b, 255] as Rgba,
      mix((x, y) => ((2 * x + y) / 3) | 0),
      mix((x, y) => ((x + 2 * y) / 3) | 0),
    ];
  return [[...a, 255] as Rgba, [...b, 255] as Rgba, mix((x, y) => ((x + y) / 2) | 0), [0, 0, 0, 0]];
}

function colourBlock(buf: Uint8Array, o: number, out: Uint8Array, w: number, bx: number, by: number, alpha: boolean) {
  const pal = palette(u16(buf, o), u16(buf, o + 2), alpha);
  const bits = u32(buf, o + 4);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3);
    const y = by + (i >> 2);
    const p = pal[(bits >>> (2 * i)) & 3];
    const d = (y * w + x) * 4;
    out[d] = p[0];
    out[d + 1] = p[1];
    out[d + 2] = p[2];
    out[d + 3] = p[3];
  }
}

function alphaBlock(buf: Uint8Array, o: number, out: Uint8Array, w: number, bx: number, by: number) {
  const a0 = buf[o];
  const a1 = buf[o + 1];
  const al = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) al.push((((7 - i) * a0 + i * a1) / 7) | 0);
  else {
    for (let i = 1; i < 5; i++) al.push((((5 - i) * a0 + i * a1) / 5) | 0);
    al.push(0, 255);
  }
  // 48 bits of 3-bit indices, read as two halves of 24 (both multiples of 3, so no index
  // straddles the join) — which keeps BigInt out of the hot loop
  const lo = buf[o + 2] | (buf[o + 3] << 8) | (buf[o + 4] << 16);
  const hi = buf[o + 5] | (buf[o + 6] << 8) | (buf[o + 7] << 16);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3);
    const y = by + (i >> 2);
    const bit = 3 * i;
    out[(y * w + x) * 4 + 3] = al[bit < 24 ? (lo >>> bit) & 7 : (hi >>> (bit - 24)) & 7];
  }
}

/**
 * Decode mip 0 of a block-compressed texture to RGBA (w*h*4). Rows are stored padded to a
 * multiple of 64 pixels (a 368 px wide sheet takes 384), so blocks are addressed with that pitch.
 * Format 47 is BC1 (half a byte a pixel), 49 BC3 (one byte). Throws on a size it can't place.
 */
export function decodeBlocks(buf: Uint8Array, w: number, h: number, format: number): Uint8Array {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  const pitch = Math.ceil(w / 64) * 16; // blocks per stored row
  const bytesPerBlock = format === 47 ? 8 : format === 49 ? 16 : buf.length >= pitch * bh * 16 ? 16 : 8;
  if (buf.length < pitch * bh * bytesPerBlock) throw new Error(`format ${format}: ${buf.length} bytes is too small for ${w}x${h}`);
  const out = new Uint8Array(w * h * 4);
  for (let by4 = 0; by4 < bh; by4++)
    for (let bx4 = 0; bx4 < bw; bx4++) {
      const bx = bx4 * 4;
      const by = by4 * 4;
      if (bx + 4 > w || by + 4 > h) continue;
      const o = (by4 * pitch + bx4) * bytesPerBlock;
      if (bytesPerBlock === 8) colourBlock(buf, o, out, w, bx, by, true);
      else {
        colourBlock(buf, o + 8, out, w, bx, by, false);
        alphaBlock(buf, o, out, w, bx, by);
      }
    }
  return out;
}
