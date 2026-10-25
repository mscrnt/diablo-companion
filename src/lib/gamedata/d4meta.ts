// Diablo IV SNO meta-file reader driven by DiabloTools/d4data `definitions.json`.
//
// The binary reading logic is a port of DiabloTools/d4data `parse.js` (MIT licence, see
// src-tauri/resources/d4data/LICENSE) with a simplified output shape that is easier to consume:
//   - complex types   -> plain objects { fieldName: value }  (polymorphic entries get `__type`)
//   - DT_SNO(_NAME)   -> null | { sno, name, group }   (group = SNO group name, e.g. "StringList")
//   - DT_GBID         -> null | { gbid, name?, group } (name resolved from GameBalance tables)
//   - DT_CSTRING      -> string
//   - DT_STRING_FORMULA -> formula source string
//   - external (payload) arrays -> null   (their data lives in base:payload files, not read here)
//
// Nothing here touches the filesystem: callers hand in the bytes (see io.ts), so the same code
// runs in the app's worker and in the command-line extractor.

import { bytes, type Bytes } from "./bytes";

export function djbHash(str: string): number {
  // "typeHash" in parse.js (no lower-casing)
  let h = 0;
  for (let c = 0; c < str.length; c++) h = (((h << 5) + h + str.charCodeAt(c)) >>> 0);
  return h >>> 0;
}
export const gbidHash = (str: unknown) => djbHash(String(str).toLowerCase());

// ------------------------------------------------------------------------------------------------
// definitions.json, loosely typed: only what the reader uses

export interface DefField {
  name: string;
  hash: number;
  offset: number;
  type: number | number[];
  flags?: number;
  arrayLength?: number;
  serializedBitCount?: number;
  group?: number;
}
export interface DefType {
  name?: string;
  hash?: number;
  type?: string;
  size?: number;
  flags?: number;
  fields?: DefField[];
  dwFormatHash?: number;
}
export type Definitions = Record<string | number, DefType>;

/** A field as parseMeta synthesises it for tag-map entries, where there is no definition field. */
type FieldLike = Partial<DefField> | null;

export interface SnoRef {
  sno: number;
  name: string | null;
  group: string | number;
  encrypted?: true;
}

// ------------------------------------------------------------------------------------------------
// CoreTOC & friends

export interface CoreToc {
  /** snoId -> [group, name] */
  byId: Map<number, [number, string]>;
  /** group -> Map(snoId -> name) */
  byGroup: Record<number, Map<number, string>>;
  formatHashes: Record<number, number>;
}

export function readCoreToc(buf0: Uint8Array): CoreToc {
  const buf = bytes(buf0);
  let tocOffset = 4,
    newFormat = false,
    n = buf.readUInt32LE(0);
  if (n === 0xbcde6611) {
    newFormat = true;
    tocOffset = 8;
    n = buf.readUInt32LE(4);
  }
  const counts: number[] = [],
    offsets: number[] = [],
    formatHashes: Record<number, number> = {};
  for (let c = 0; c < n; c++) {
    counts.push(buf.readUInt32LE(tocOffset + 4 * c));
    offsets.push(buf.readUInt32LE(tocOffset + 4 * n + 4 * c));
    formatHashes[c] = buf.readUInt32LE(tocOffset + 12 * n + 4 * c);
  }
  const dataStart = (newFormat ? 12 : 8) + (newFormat ? 16 : 12) * n;
  const byId = new Map<number, [number, string]>();
  const byGroup: Record<number, Map<number, string>> = {};
  for (let c = 0; c < n; c++) {
    for (let i = 0, o = dataStart + offsets[c]; i < counts[c]; i++, o += 12) {
      const group = buf.readInt32LE(o),
        id = buf.readInt32LE(o + 4);
      const p = buf.readInt32LE(o + 8) + offsets[c] + dataStart + 12 * counts[c];
      let e = p;
      while (e < buf.length && buf[e] !== 0 && e - p < 256) e++;
      const name = buf.str(p, e).trim();
      byId.set(id, [group, name]);
      (byGroup[group] ??= new Map()).set(id, name);
    }
  }
  return { byId, byGroup, formatHashes };
}

export function readReplacedSnos(buf0: Uint8Array): Record<number, string> {
  const buf = bytes(buf0);
  const out: Record<number, string> = {};
  const n = buf.readUInt32LE(4);
  for (let i = 0; i < n; i++) out[buf.readInt32LE(8 + i * 24 + 4)] = buf.hex(8 + i * 24 + 8, 8 + i * 24 + 16);
  return out;
}

export function readEncryptedSnos(buf0: Uint8Array): Record<number, [number, string]> {
  const buf = bytes(buf0);
  const out: Record<number, [number, string]> = {};
  const n = buf.readUInt32LE(4);
  for (let i = 0; i < n; i++)
    out[buf.readInt32LE(8 + i * 16 + 4)] = [buf.readInt32LE(8 + i * 16), buf.hex(8 + i * 16 + 8, 8 + i * 16 + 16)];
  return out;
}

/** Combined meta container (StringList-Text-enUS.dat etc.): signature 0x44CF00F5. */
export function* iterCombinedMeta(buf0: Uint8Array, snoGroup: number): Generator<[number, Bytes]> {
  const buf = bytes(buf0);
  if (buf.readUInt32LE(0) !== 0x44cf00f5) throw new Error("bad combined meta signature");
  const count = buf.readUInt32LE(4);
  const entries: [number, number][] = [];
  for (let i = 0; i < count; i++) entries.push([buf.readInt32LE(8 + i * 8), buf.readUInt32LE(12 + i * 8)]);
  let off = 8 + count * 8;
  for (const [sno, size] of entries) {
    off = Math.floor((off + 7) / 8) * 8;
    if (snoGroup !== 42) off += 8;
    const id = buf.readInt32LE(off);
    if (id !== sno) throw new Error(`combined meta: expected sno ${sno} at ${off}, got ${id}`);
    yield [sno, buf.subarray(off, off + size) as Bytes];
    off += size;
  }
}

// ------------------------------------------------------------------------------------------------

const H = {
  DT_NULL: 1028442418,
  DT_POLYMORPHIC_VARIABLEARRAY: 1683664497,
  DT_STRING_FORMULA: 2450313795,
  DT_VARIABLEARRAY: 3244749660,
  DT_TAGMAP: 3493213809,
  DT_CSTRING: 3846829457,
  DT_CHARARRAY: 2175310548,
  DT_FIXEDARRAY: 2388214534,
  DT_OPTIONAL: 3121633597,
  DT_SNO_NAME: 3339108615,
  DT_RANGE: 3877855748,
  DT_BINDABLEPROPERTY: 322094989,
  POLY_BASE: 0x5d4bac71,
};

export interface MetaReaderOpts {
  definitions: Definitions;
  /** eAttrib -> name */
  attributes?: Record<number, string>;
  toc: CoreToc;
  /** group number -> name */
  snoGroupNames: Record<number, string>;
  replacedSnos?: Record<number, string>;
  encryptedSnos?: Record<number, unknown>;
  /** gbType -> { hash: name } */
  gbid?: Record<number, Record<number, string>>;
}

export class MetaReader {
  defs: Definitions;
  attributes: Record<number, string>;
  toc: CoreToc;
  snoGroupNames: Record<number, string>;
  replacedSnos: Record<number, string>;
  encryptedSnos: Record<number, unknown>;
  gbid: Record<number, Record<number, string>>;
  fieldNames: Record<number, string> = {};
  typeForFormat: Record<number, number> = {};
  typeByName: Record<string, number> = {};
  errors = 0;
  formatFallbacks = 0;

  constructor({ definitions, attributes = {}, toc, snoGroupNames, replacedSnos = {}, encryptedSnos = {}, gbid = {} }: MetaReaderOpts) {
    this.defs = definitions;
    this.attributes = attributes;
    this.toc = toc;
    this.snoGroupNames = snoGroupNames;
    this.replacedSnos = replacedSnos;
    this.encryptedSnos = encryptedSnos;
    this.gbid = gbid;
    for (const [th, t] of Object.entries(definitions)) {
      if (t.fields) for (const f of t.fields) this.fieldNames[f.hash] = f.name;
      if (t.dwFormatHash) this.typeForFormat[t.dwFormatHash >>> 0] = Number(th);
      if (t.name) this.typeByName[t.name] = Number(th);
    }
  }

  type(h: number): DefType {
    const t = this.defs[h];
    if (!t) throw new Error("unknown type hash " + h);
    return t;
  }

  basicAlign(t: DefType, hs: number[], inTagMap: boolean): number {
    switch (t.hash) {
      case H.DT_POLYMORPHIC_VARIABLEARRAY:
      case H.DT_STRING_FORMULA:
      case H.DT_VARIABLEARRAY:
      case H.DT_TAGMAP:
      case H.DT_CSTRING:
        return inTagMap ? 4 : 8;
      case H.DT_CHARARRAY:
        return 1;
      case H.DT_FIXEDARRAY:
      case H.DT_OPTIONAL:
      case H.DT_RANGE:
        return this.align(hs[1]);
      case H.DT_SNO_NAME:
        return 4;
      case H.DT_BINDABLEPROPERTY:
        return 8;
      default:
        return t.size as number;
    }
  }

  align(hs0: number | number[], inTagMap = false): number {
    const hs = Array.isArray(hs0) ? hs0 : [hs0];
    const t = this.type(hs[0]);
    if (!Array.isArray(t.fields)) return t.type === "basic" ? this.basicAlign(t, hs, inTagMap) : 4;
    return Math.max(...t.fields.map((f) => this.align(f.type)));
  }

  sno(raw: number, groupHint?: number): SnoRef | null {
    if (raw === -1 || raw === 0) return null;
    const e = this.toc.byId.get(raw);
    const g = e ? e[0] : groupHint || -1;
    const out: SnoRef = { sno: raw, name: e ? e[1] : null, group: this.snoGroupNames[g] || g };
    if (this.encryptedSnos[raw]) out.encrypted = true;
    return out;
  }

  /** Returns [value, readLength]. */
  read(file: Bytes, hs0: number | number[], off: number, field: FieldLike): [any, number] {
    const hs = Array.isArray(hs0) ? hs0 : [hs0];
    if (hs[0] === H.DT_NULL) return [undefined, 0];
    const t = this.type(hs[0]);
    if (t.type === "complex") {
      const obj: Record<string, any> = {};
      for (const f of t.fields!) {
        const [v] = this.read(file, f.type, off + f.offset, f);
        obj[f.name] = v;
      }
      if (obj.eAttribute !== undefined && obj.eAttribute !== null && obj.eAttribute !== -1 && this.attributes[obj.eAttribute])
        obj.eAttribute_name = this.attributes[obj.eAttribute];
      if (t.name === "GBIDHeader" && typeof obj.szName === "string") obj.gbid = gbidHash(obj.szName);
      return [obj, t.size as number];
    }
    if (t.type !== "basic") throw new Error("Unhandled type " + t.name);
    const fl = field ? field.flags || 0 : 0;
    const bit1 = !!field && field.serializedBitCount === 1;
    switch (t.name) {
      case "DT_BYTE": {
        const v = file.readUInt8(off);
        return [bit1 ? !!v : v, 1];
      }
      case "DT_WORD": {
        const v = file.readUInt16LE(off);
        return [bit1 ? !!v : v, 2];
      }
      case "DT_ENUM":
        return [file.readInt32LE(off), 4];
      case "DT_INT": {
        const v = file.readInt32LE(off);
        return [bit1 ? !!v : v, 4];
      }
      case "DT_UINT": {
        const v = file.readUInt32LE(off);
        return [bit1 ? !!v : v, 4];
      }
      case "DT_STARTLOC_NAME":
        return [file.readUInt32LE(off), 4];
      case "DT_FLOAT":
        return [Number(file.readFloatLE(off).toPrecision(7)), 4];
      case "DT_INT64":
      case "DT_ACD_NETWORK_NAME":
      case "DT_SHARED_SERVER_DATA_ID":
        return [file.readBigUInt64LE(off).toString(16), 8];
      case "DT_OPTIONAL": {
        const [v] = this.read(file, hs.slice(1), off, field);
        return [file.readInt32LE(off) ? v : null, 4];
      }
      case "DT_SNO":
        return [this.sno(file.readInt32LE(off), field ? field.group : undefined), 4];
      case "DT_SNO_NAME":
        return [this.sno(file.readInt32LE(off + 4), file.readInt32LE(off)), 8];
      case "DT_GBID": {
        const raw = file.readUInt32LE(off);
        if (raw === 0xffffffff) return [null, 4];
        const group = (field && field.group) as number;
        const name = this.gbid[group] && this.gbid[group][raw];
        return [name ? { gbid: raw, name, group } : { gbid: raw, group }, 4];
      }
      case "DT_RANGE": {
        const [a, la] = this.read(file, hs.slice(1), off, field);
        const [b, lb] = this.read(file, hs.slice(1), off + la, field);
        return [{ min: a, max: b }, la + lb];
      }
      case "DT_FIXEDARRAY": {
        const arr: any[] = [];
        let len = 0;
        for (let c = 0; c < field!.arrayLength!; c++) {
          const [v, l] = this.read(file, hs.slice(1), off + len, field);
          arr.push(v);
          len += l;
        }
        return [arr, len];
      }
      case "DT_CHARARRAY": {
        let n = field!.arrayLength!;
        while (n > 0 && file[off + n - 1] === 0) n--;
        return [file.str(off, off + n), Math.max(0, field!.arrayLength!)];
      }
      case "DT_RGBACOLOR":
        return [{ r: file[off], g: file[off + 1], b: file[off + 2], a: file[off + 3] }, 4];
      case "DT_RGBACOLORVALUE":
        return [{ r: file.readFloatLE(off), g: file.readFloatLE(off + 4), b: file.readFloatLE(off + 8), a: file.readFloatLE(off + 12) }, 16];
      case "DT_BCVEC2I":
        return [{ x: file.readInt32LE(off), y: file.readInt32LE(off + 4) }, 8];
      case "DT_VECTOR2D":
        return [{ x: file.readFloatLE(off), y: file.readFloatLE(off + 4) }, 8];
      case "DT_VECTOR3D":
        return [{ x: file.readFloatLE(off), y: file.readFloatLE(off + 4), z: file.readFloatLE(off + 8) }, 12];
      case "DT_VECTOR4D":
        return [{ x: file.readFloatLE(off), y: file.readFloatLE(off + 4), z: file.readFloatLE(off + 8), w: file.readFloatLE(off + 12) }, 16];
      case "DT_CSTRING": {
        const so = file.readInt32LE(off + 8);
        let sz = file.readInt32LE(off + 12);
        if (sz < 1 || so < 1 || so + sz > file.length) return ["", 16];
        while (sz > 0 && file[so + sz - 1] === 0) sz--;
        return [file.str(so, so + sz), 16];
      }
      case "DT_STRING_FORMULA": {
        const fo = file.readInt32LE(off + 8);
        let fsz = file.readInt32LE(off + 12);
        if (fo < 1 || fsz < 1 || fo + fsz > file.length) return ["", 32];
        while (fsz > 0 && file[fo + fsz - 1] === 0) fsz--;
        return [file.str(fo, fo + fsz).trim(), 32];
      }
      case "DT_TAGMAP":
        return [this.readTagMap(file, off), 16];
      case "DT_VARIABLEARRAY": {
        if (fl & 0x200000 || fl & 0x400000) return [null, 16]; // external payload data
        let dOff = file.readInt32LE(off + 8),
          dSize = file.readInt32LE(off + 12);
        if (file.readInt32LE(off) || file.readInt32LE(off + 4)) {
          this.errors++;
          return [null, 16];
        }
        if (dSize < 1) return [[], 16];
        if (dOff < 1 || dOff + dSize > file.length) {
          this.errors++;
          return [null, 16];
        }
        const arr: any[] = [];
        while (dSize > 0) {
          const [v, l] = this.read(file, hs.slice(1), dOff, field);
          if (l < 1) break;
          arr.push(v);
          dOff += l;
          dSize -= l;
        }
        return [arr, 16];
      }
      case "DT_POLYMORPHIC_VARIABLEARRAY": {
        if (fl & 0x200000 || fl & 0x400000) return [null, 24];
        let dOff = file.readInt32LE(off + 8),
          dSize = file.readInt32LE(off + 12);
        const count = file.readInt32LE(off + 16);
        if (file.readInt32LE(off) || file.readInt32LE(off + 4) || file.readInt32LE(off + 20) || count >= 1000) {
          this.errors++;
          return [null, 24];
        }
        if (dSize < 1 || count < 1) return [[], 24];
        if (dOff < 1 || dOff + dSize > file.length) {
          this.errors++;
          return [null, 24];
        }
        dOff += count * 8;
        dSize -= count * 8;
        const arr: any[] = [];
        for (let c = 0; c < count && dSize > 0; c++) {
          const [base] = this.read(file, [H.POLY_BASE], dOff, field);
          const polyType = base.dwType;
          const [v, l] = this.read(file, [polyType, ...hs.slice(1)], dOff, field);
          if (v && typeof v === "object") v.__type = this.defs[polyType] ? this.defs[polyType].name : polyType;
          arr.push(v);
          dOff += l;
          dSize -= l;
          if (l < 1) break;
        }
        return [arr, 24];
      }
      case "DT_BINDABLEPROPERTY": {
        let len = 48;
        const [v, l] = this.read(file, hs.slice(1), off + 48, field);
        len += l;
        if ((off + len) % 8) len += 4;
        return [v, len];
      }
      default:
        throw new Error("Unhandled basic type " + t.name);
    }
  }

  readTagMap(file: Bytes, off: number): Record<string, any> | null {
    let dOff = file.readInt32LE(off + 8);
    const dSize = file.readInt32LE(off + 12);
    if (dSize < 1 || dOff < 1 || dOff + dSize > file.length) return null;
    const count = file.readInt32LE(dOff);
    dOff += 4;
    const infos: { nameHash: number; types: number[]; name: string }[] = [];
    for (let c = 0; c < count; c++) {
      const info = { nameHash: file.readUInt32LE(dOff), types: [file.readUInt32LE(dOff + 4)], name: "" };
      dOff += 8;
      for (let ti = 0; ti < 2; ti++) {
        const t = this.defs[info.types[ti]];
        if (!t || !((t.flags ?? 0) & 0x8000)) break;
        if (ti >= 1 && info.types[0] === H.DT_BINDABLEPROPERTY && info.types[1] === H.DT_CSTRING) break;
        info.types.push(file.readUInt32LE(dOff));
        dOff += 4;
      }
      info.name = this.fieldNames[info.nameHash] || "unk_" + info.nameHash.toString(16);
      infos.push(info);
    }
    const out: Record<string, any> = {};
    for (const info of infos) {
      const a = this.align(info.types, true);
      if (dOff % a) dOff += a - (dOff % a);
      const [v, l] = this.read(file, info.types, dOff, { type: info.types, hash: info.nameHash, name: info.name });
      if (l < 1) break;
      out[info.name] = v;
      dOff += l;
    }
    return out;
  }

  /**
   * Parse a standalone meta file (0xDEADBEEF header) or a combined-container sub-buffer.
   * `asType` (a definitions.json type name) is used only when the file's format hash has no
   * matching type, i.e. the definitions are older than the game build for that group. The
   * caller must validate the result; `formatFallbacks` counts how often this happened.
   */
  parseMeta(buf0: Uint8Array, { standalone = true, group = null as number | null, asType = null as string | null } = {}): any {
    const buf = bytes(buf0);
    let body: Bytes = buf,
      fmt: number | undefined;
    if (standalone) {
      if (buf.readUInt32LE(0) !== 0xdeadbeef) throw new Error("bad meta signature");
      fmt = buf.readUInt32LE(4);
      body = buf.subarray(16) as Bytes;
      if (!fmt) fmt = this.toc.formatHashes[(group ?? (this.toc.byId.get(body.readInt32LE(0)) || [])[0]) as number];
    } else {
      fmt = this.toc.formatHashes[group as number];
    }
    let th: number | undefined = this.typeForFormat[(fmt as number) >>> 0];
    if (th === undefined && asType) {
      th = this.typeByName[asType];
      if (th !== undefined) this.formatFallbacks++;
    }
    if (th === undefined) throw new Error("no type for format hash " + ((fmt as number) >>> 0).toString(16));
    const [v] = this.read(body, [th], 0, null);
    return v;
  }
}
