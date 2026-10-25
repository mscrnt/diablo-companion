// A little-endian reader over a Uint8Array, with the Node Buffer method names the parser was
// written against. Runs anywhere (browser worker, Node), so the extractor has one implementation.
//
// It subclasses Uint8Array so byte indexing (`buf[off]`), `length` and `subarray` keep working;
// subarray hands back a Bytes with its own lazy DataView.

const UTF8 = new TextDecoder("utf-8");
const HEX = Array.from({ length: 256 }, (_, i) => i.toString(16).padStart(2, "0"));

export class Bytes extends Uint8Array {
  #dv: DataView | null = null;

  private get dv(): DataView {
    return (this.#dv ??= new DataView(this.buffer, this.byteOffset, this.byteLength));
  }

  readUInt8(o: number): number {
    return this.dv.getUint8(o);
  }
  readUInt16LE(o: number): number {
    return this.dv.getUint16(o, true);
  }
  readInt32LE(o: number): number {
    return this.dv.getInt32(o, true);
  }
  readUInt32LE(o: number): number {
    return this.dv.getUint32(o, true);
  }
  readFloatLE(o: number): number {
    return this.dv.getFloat32(o, true);
  }
  readBigUInt64LE(o: number): bigint {
    return this.dv.getBigUint64(o, true);
  }

  /** UTF-8 text in [start, end), the way Buffer#toString() read it. */
  str(start = 0, end = this.length): string {
    return UTF8.decode(this.subarray(start, end));
  }
  /** Lower-case hex of [start, end), as Buffer#toString("hex") wrote it. */
  hex(start = 0, end = this.length): string {
    let s = "";
    for (let i = start; i < end; i++) s += HEX[this[i]];
    return s;
  }
}

/** Wrap bytes without copying them. */
export function bytes(u8: Uint8Array): Bytes {
  return u8 instanceof Bytes ? u8 : new Bytes(u8.buffer, u8.byteOffset, u8.byteLength);
}
