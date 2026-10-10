// Minimal PNG reader/writer for dev scripts (8-bit RGB/RGBA/grey, non-interlaced), using only node:zlib.
import { deflateSync, inflateSync } from "node:zlib";
import { readFileSync, writeFileSync } from "node:fs";

export interface Rgba {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

const CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();
const crc32 = (b: Uint8Array) => {
  let c = 0xffffffff;
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};

export function readPng(file: string): Rgba {
  const buf = readFileSync(file);
  let p = 8;
  let w = 0, h = 0, depth = 0, type = 0, inter = 0;
  const idat: Buffer[] = [];
  while (p < buf.length) {
    const len = buf.readUInt32BE(p);
    const kind = buf.toString("ascii", p + 4, p + 8);
    const body = buf.subarray(p + 8, p + 8 + len);
    if (kind === "IHDR") {
      w = body.readUInt32BE(0);
      h = body.readUInt32BE(4);
      depth = body[8];
      type = body[9];
      inter = body[12];
    } else if (kind === "IDAT") idat.push(body);
    else if (kind === "IEND") break;
    p += 12 + len;
  }
  if (depth !== 8 || inter) throw new Error(`unsupported PNG (depth ${depth}, interlace ${inter})`);
  const ch = ({ 0: 1, 2: 3, 4: 2, 6: 4 } as Record<number, number>)[type];
  if (!ch) throw new Error(`unsupported PNG colour type ${type}`);
  const raw = inflateSync(Buffer.concat(idat));
  const stride = w * ch;
  const px = new Uint8Array(h * stride);
  for (let y = 0; y < h; y++) {
    const f = raw[y * (stride + 1)];
    const src = y * (stride + 1) + 1;
    const dst = y * stride;
    for (let x = 0; x < stride; x++) {
      const a = x >= ch ? px[dst + x - ch] : 0;
      const b = y ? px[dst - stride + x] : 0;
      const c = x >= ch && y ? px[dst - stride + x - ch] : 0;
      let v = raw[src + x];
      if (f === 1) v += a;
      else if (f === 2) v += b;
      else if (f === 3) v += (a + b) >> 1;
      else if (f === 4) {
        const pp = a + b - c, pa = Math.abs(pp - a), pb = Math.abs(pp - b), pc = Math.abs(pp - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      px[dst + x] = v & 255;
    }
  }
  const data = new Uint8ClampedArray(w * h * 4);
  for (let i = 0, j = 0; i < w * h; i++, j += ch) {
    const g = ch < 3;
    data[i * 4] = px[j];
    data[i * 4 + 1] = g ? px[j] : px[j + 1];
    data[i * 4 + 2] = g ? px[j] : px[j + 2];
    data[i * 4 + 3] = ch === 4 ? px[j + 3] : ch === 2 ? px[j + 1] : 255;
  }
  return { data, width: w, height: h };
}

export function writePng(file: string, img: Rgba) {
  const { width: w, height: h, data } = img;
  const raw = Buffer.alloc(h * (w * 4 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0;
    Buffer.from(data.buffer, data.byteOffset + y * w * 4, w * 4).copy(raw, y * (w * 4 + 1) + 1);
  }
  const chunk = (kind: string, body: Buffer) => {
    const out = Buffer.alloc(12 + body.length);
    out.writeUInt32BE(body.length, 0);
    out.write(kind, 4, "ascii");
    body.copy(out, 8);
    out.writeUInt32BE(crc32(out.subarray(4, 8 + body.length)), 8 + body.length);
    return out;
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  writeFileSync(file, Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk("IHDR", ihdr), chunk("IDAT", deflateSync(raw, { level: 6 })), chunk("IEND", Buffer.alloc(0))]));
}

/** Crop and/or box-downscale (integer-free: area average) to the given size. */
export function resize(img: Rgba, w: number, h: number, crop = { x: 0, y: 0, w: img.width, h: img.height }): Rgba {
  const out = new Uint8ClampedArray(w * h * 4);
  const sx = crop.w / w, sy = crop.h / h;
  for (let y = 0; y < h; y++) {
    const y0 = crop.y + y * sy, y1 = y0 + sy;
    for (let x = 0; x < w; x++) {
      const x0 = crop.x + x * sx, x1 = x0 + sx;
      let r = 0, g = 0, b = 0, n = 0;
      for (let yy = Math.floor(y0); yy < Math.max(Math.floor(y0) + 1, Math.ceil(y1)); yy++)
        for (let xx = Math.floor(x0); xx < Math.max(Math.floor(x0) + 1, Math.ceil(x1)); xx++) {
          const i = (yy * img.width + xx) * 4;
          r += img.data[i];
          g += img.data[i + 1];
          b += img.data[i + 2];
          n++;
        }
      const o = (y * w + x) * 4;
      out[o] = r / n;
      out[o + 1] = g / n;
      out[o + 2] = b / n;
      out[o + 3] = 255;
    }
  }
  return { data: out, width: w, height: h };
}

/** Rough stand-in for the app's JPEG step: average the chroma over 2×2 blocks (4:2:0), keep luma. */
export function chroma420(img: Rgba): Rgba {
  const { width: w, height: h, data } = img;
  const out = new Uint8ClampedArray(data);
  for (let y = 0; y + 1 < h; y += 2)
    for (let x = 0; x + 1 < w; x += 2) {
      let cb = 0, cr = 0;
      const ys: number[] = [];
      for (const [dx, dy] of [[0, 0], [1, 0], [0, 1], [1, 1]]) {
        const i = ((y + dy) * w + x + dx) * 4;
        const r = data[i], g = data[i + 1], b = data[i + 2];
        const Y = 0.299 * r + 0.587 * g + 0.114 * b;
        ys.push(Y);
        cb += -0.1687 * r - 0.3313 * g + 0.5 * b;
        cr += 0.5 * r - 0.4187 * g - 0.0813 * b;
      }
      cb /= 4;
      cr /= 4;
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([dx, dy], k) => {
        const i = ((y + dy) * w + x + dx) * 4;
        out[i] = ys[k] + 1.402 * cr;
        out[i + 1] = ys[k] - 0.344136 * cb - 0.714136 * cr;
        out[i + 2] = ys[k] + 1.772 * cb;
      });
    }
  return { data: out, width: w, height: h };
}
