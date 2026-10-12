// Block-compressed texture decoding (the documented GPU formats BC1 / DXT1 and BC3 / DXT5) to RGBA.
// Which one a sheet uses comes from its size: BC1 stores 4 bits a pixel, BC3 8 (mip 0 comes first).

const rgb565 = (c) => [((c >> 11) & 31) * 255 / 31 | 0, ((c >> 5) & 63) * 255 / 63 | 0, (c & 31) * 255 / 31 | 0];

/** The 4 colours of a BC1 colour block; `alpha` = the 3-colour + transparent mode is allowed (BC1 only). */
function palette(c0, c1, alpha) {
  const a = rgb565(c0), b = rgb565(c1);
  if (c0 > c1 || !alpha) return [[...a, 255], [...b, 255], a.map((v, i) => (2 * v + b[i]) / 3 | 0).concat(255), a.map((v, i) => (v + 2 * b[i]) / 3 | 0).concat(255)];
  return [[...a, 255], [...b, 255], a.map((v, i) => (v + b[i]) / 2 | 0).concat(255), [0, 0, 0, 0]];
}

function colourBlock(buf, o, out, w, bx, by, alpha) {
  const pal = palette(buf.readUInt16LE(o), buf.readUInt16LE(o + 2), alpha);
  const bits = buf.readUInt32LE(o + 4);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3), y = by + (i >> 2);
    const p = pal[(bits >>> (2 * i)) & 3];
    const d = (y * w + x) * 4;
    out[d] = p[0]; out[d + 1] = p[1]; out[d + 2] = p[2]; out[d + 3] = p[3];
  }
}

function alphaBlock(buf, o, out, w, bx, by) {
  const a0 = buf[o], a1 = buf[o + 1];
  const al = [a0, a1];
  if (a0 > a1) for (let i = 1; i < 7; i++) al.push(((7 - i) * a0 + i * a1) / 7 | 0);
  else { for (let i = 1; i < 5; i++) al.push(((5 - i) * a0 + i * a1) / 5 | 0); al.push(0, 255); }
  // 48 bits of 3-bit indices
  let bits = 0n;
  for (let i = 0; i < 6; i++) bits |= BigInt(buf[o + 2 + i]) << BigInt(8 * i);
  for (let i = 0; i < 16; i++) {
    const x = bx + (i & 3), y = by + (i >> 2);
    out[(y * w + x) * 4 + 3] = al[Number((bits >> BigInt(3 * i)) & 7n)];
  }
}

/**
 * Decode mip 0 of a block-compressed texture to RGBA (Uint8Array, w*h*4). Rows are stored padded to a
 * multiple of 64 pixels (a 368 px wide sheet takes 384), so blocks are addressed with that pitch.
 * Format 47 is BC1 (half a byte a pixel), 49 BC3 (one byte). Throws on a size it can't place.
 */
export function decodeBlocks(buf, w, h, format) {
  const bw = Math.ceil(w / 4);
  const bh = Math.ceil(h / 4);
  const pitch = Math.ceil(w / 64) * 16; // blocks per stored row
  const bytesPerBlock = format === 47 ? 8 : format === 49 ? 16 : buf.length >= pitch * bh * 16 ? 16 : 8;
  if (buf.length < pitch * bh * bytesPerBlock) throw new Error(`format ${format}: ${buf.length} bytes is too small for ${w}x${h}`);
  const out = new Uint8Array(w * h * 4);
  for (let by4 = 0; by4 < bh; by4++)
    for (let bx4 = 0; bx4 < bw; bx4++) {
    const bx = bx4 * 4, by = by4 * 4;
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
