// The binary side of the game-data reader, on buffers we build here by hand.
//
// Nothing in this file comes from Diablo IV: every fixture is written below from the format the
// reader expects, so the tests can live in the repo and run in CI without the game.
import { describe, expect, it } from "vitest";
import { bytes, Bytes } from "../src/lib/gamedata/bytes";
import { djbHash, gbidHash, iterCombinedMeta, MetaReader, readCoreToc, readEncryptedSnos, readReplacedSnos, type Definitions } from "../src/lib/gamedata/d4meta";

/** A little buffer writer, so the fixtures read like the format they describe. */
class W {
  buf = new Uint8Array(4096);
  dv = new DataView(this.buf.buffer);
  at = 0;
  u32(v: number, at = this.at) {
    this.dv.setUint32(at, v, true);
    this.at = Math.max(this.at, at + 4);
    return this;
  }
  i32(v: number, at = this.at) {
    this.dv.setInt32(at, v, true);
    this.at = Math.max(this.at, at + 4);
    return this;
  }
  f32(v: number, at = this.at) {
    this.dv.setFloat32(at, v, true);
    this.at = Math.max(this.at, at + 4);
    return this;
  }
  ascii(s: string, at = this.at) {
    for (let i = 0; i < s.length; i++) this.buf[at + i] = s.charCodeAt(i);
    this.at = Math.max(this.at, at + s.length);
    return this;
  }
  zeros(n: number) {
    this.at += n;
    return this;
  }
  done(len = this.at) {
    return this.buf.subarray(0, len);
  }
}

// ------------------------------------------------------------------------------------------------

describe("Bytes", () => {
  it("reads little-endian numbers, text and hex", () => {
    const w = new W().u32(0xdeadbeef).i32(-7).f32(1.5).ascii("Hi");
    const b = bytes(w.done(14));
    expect(b.readUInt32LE(0)).toBe(0xdeadbeef);
    expect(b.readInt32LE(4)).toBe(-7);
    expect(b.readFloatLE(8)).toBe(1.5);
    expect(b.str(12, 14)).toBe("Hi");
    expect(b.hex(4, 8)).toBe("f9ffffff");
  });

  it("keeps working after subarray, and decodes UTF-8", () => {
    const word = new TextEncoder().encode("Grüße"); // 7 bytes for 5 characters
    const u8 = new Uint8Array([...new TextEncoder().encode("xx "), ...word, ...new TextEncoder().encode(" xx")]);
    const sub = bytes(u8).subarray(3, 3 + word.length) as Bytes;
    expect(sub).toBeInstanceOf(Bytes);
    expect(sub.str()).toBe("Grüße");
    expect(sub.length).toBe(7);
  });
});

describe("hashes", () => {
  it("matches the game's djb2 variant", () => {
    // h = 0; h = h*33 + c  (no lower-casing), as unsigned 32-bit
    const byHand = (s: string) => {
      let h = 0n;
      for (const ch of s) h = (h * 33n + BigInt(ch.charCodeAt(0))) & 0xffffffffn;
      return Number(h);
    };
    for (const s of ["", "a", "Affix_Armor", "Tag_Earthquake", "LostCache_Scos_01"]) expect(djbHash(s)).toBe(byHand(s));
  });

  it("lower-cases for GBID hashes", () => {
    expect(gbidHash("Affix_Armor")).toBe(djbHash("affix_armor"));
    expect(gbidHash("AFFIX_ARMOR")).toBe(gbidHash("affix_armor"));
  });
});

// ------------------------------------------------------------------------------------------------
// CoreTOC: [magic][groupCount][counts][offsets][spare][formatHashes] then, per group, an entry
// table of [group, id, nameOffset] followed by that group's name pool.

const FORMAT_HASH = 0xabcd1234;

function coreToc() {
  const n = 1;
  const dataStart = 12 + 16 * n;
  const w = new W();
  w.u32(0xbcde6611, 0).u32(n, 4);
  w.u32(2, 8); // counts[0]
  w.u32(0, 12); // offsets[0]
  w.u32(0, 16); // spare
  w.u32(FORMAT_HASH, 8 + 12 * n); // formatHashes[0]
  const names = dataStart + 12 * 2;
  // [group, id, nameOffset] x 2
  w.i32(104, dataStart).i32(1234, dataStart + 4).i32(0, dataStart + 8);
  w.i32(104, dataStart + 12).i32(5678, dataStart + 16).i32(6, dataStart + 20);
  w.ascii("Alpha\0", names).ascii("Beta\0", names + 6);
  return w.done(names + 11);
}

describe("readCoreToc", () => {
  it("reads ids, names and the per-group format hash", () => {
    const toc = readCoreToc(coreToc());
    expect(toc.byId.get(1234)).toEqual([104, "Alpha"]);
    expect(toc.byId.get(5678)).toEqual([104, "Beta"]);
    expect([...toc.byGroup[104].entries()]).toEqual([
      [1234, "Alpha"],
      [5678, "Beta"],
    ]);
    expect(toc.formatHashes[104]).toBeUndefined(); // format hashes are indexed by group ORDER
    expect(toc.formatHashes[0]).toBe(FORMAT_HASH);
  });
});

describe("readEncryptedSnos / readReplacedSnos", () => {
  it("maps sno to its group and key hash", () => {
    const w = new W().u32(0, 0).u32(2, 4);
    // [group, sno, 8-byte key] x 2
    w.i32(104, 8).i32(1234, 12).ascii("\x01\x02\x03\x04\x05\x06\x07\x08", 16);
    w.i32(73, 24).i32(9999, 28).ascii("\xaa\xbb\xcc\xdd\xee\xff\x00\x11", 32);
    const out = readEncryptedSnos(w.done(40));
    expect(out[1234]).toEqual([104, "0102030405060708"]);
    expect(out[9999][0]).toBe(73);
  });

  it("maps a replaced sno to its hash", () => {
    const w = new W().u32(0, 0).u32(1, 4);
    w.i32(0, 8).i32(4242, 12).ascii("\x0f\x0e\x0d\x0c\x0b\x0a\x09\x08", 16);
    expect(readReplacedSnos(w.done(32))[4242]).toBe("0f0e0d0c0b0a0908");
  });
});

describe("iterCombinedMeta", () => {
  it("walks a StringList container and 8-aligns each entry", () => {
    const w = new W().u32(0x44cf00f5, 0).u32(2, 4);
    w.i32(11, 8).u32(8, 12); // entry 0: sno 11, 8 bytes
    w.i32(22, 16).u32(16, 20); // entry 1: sno 22, 16 bytes
    w.i32(11, 24).u32(0xaaaa, 28);
    w.i32(22, 32).u32(0xbbbb, 36).zeros(8);
    const got = [...iterCombinedMeta(w.done(48), 42)];
    expect(got.map(([sno]) => sno)).toEqual([11, 22]);
    expect(got[0][1].length).toBe(8);
    expect(got[0][1].readUInt32LE(4)).toBe(0xaaaa);
    expect(got[1][1].length).toBe(16);
  });

  it("refuses a buffer that is not a container", () => {
    expect(() => [...iterCombinedMeta(new W().u32(1).done(4), 42)]).toThrow(/signature/);
  });
});

// ------------------------------------------------------------------------------------------------
// MetaReader on a synthetic type

const DEFS: Definitions = {
  10: { name: "DT_INT", type: "basic", size: 4 },
  11: { name: "DT_FLOAT", type: "basic", size: 4 },
  12: { name: "DT_CSTRING", type: "basic", size: 16 },
  13: { name: "DT_SNO", type: "basic", size: 4 },
  14: { name: "DT_VARIABLEARRAY", type: "basic", size: 16 },
  15: { name: "DT_BYTE", type: "basic", size: 1 },
  100: {
    name: "TestDefinition",
    type: "complex",
    size: 48,
    dwFormatHash: FORMAT_HASH,
    fields: [
      { name: "nCount", hash: 1, offset: 0, type: 10 },
      { name: "flValue", hash: 2, offset: 4, type: 11 },
      { name: "szName", hash: 3, offset: 8, type: 12 },
      { name: "snoThing", hash: 4, offset: 24, type: 13, group: 104 },
      { name: "bFlag", hash: 6, offset: 28, type: 15, serializedBitCount: 1 },
      { name: "arNumbers", hash: 5, offset: 32, type: [14, 10] },
    ],
  },
};

/** A standalone meta file: [0xdeadbeef][formatHash][8 spare] then the struct, offsets body-relative. */
function metaFile({ sno = 1234, extOffset = 56 } = {}) {
  const w = new W();
  w.u32(0xdeadbeef, 0).u32(FORMAT_HASH, 4).zeros(8);
  const B = 16; // the body starts here
  w.i32(7, B + 0); // nCount
  w.f32(1.5, B + 4); // flValue
  w.i32(48, B + 8 + 8).i32(5, B + 8 + 12); // szName: 5 bytes at body offset 48
  w.i32(sno, B + 24); // snoThing
  w.buf[B + 28] = 1; // bFlag
  w.i32(0, B + 32).i32(0, B + 36).i32(extOffset, B + 40).i32(12, B + 44); // arNumbers: 12 bytes
  w.ascii("Hello", B + 48);
  w.i32(1, B + 56).i32(2, B + 60).i32(3, B + 64);
  return w.done(B + 68);
}

function reader(extra: Partial<ConstructorParameters<typeof MetaReader>[0]> = {}) {
  return new MetaReader({ definitions: DEFS, toc: readCoreToc(coreToc()), snoGroupNames: { 104: "Affix" }, ...extra });
}

describe("MetaReader.parseMeta", () => {
  it("reads every basic type the app relies on", () => {
    expect(reader().parseMeta(metaFile())).toEqual({
      nCount: 7,
      flValue: 1.5,
      szName: "Hello",
      snoThing: { sno: 1234, name: "Alpha", group: "Affix" },
      bFlag: true,
      arNumbers: [1, 2, 3],
    });
  });

  it("marks a reference to a file this build keeps encrypted", () => {
    const v = reader({ encryptedSnos: { 1234: [104, "00"] } }).parseMeta(metaFile());
    expect(v.snoThing.encrypted).toBe(true);
  });

  it("keeps the id of a reference the TOC does not list, and names the group from the field", () => {
    const v = reader().parseMeta(metaFile({ sno: 4321 }));
    expect(v.snoThing).toEqual({ sno: 4321, name: null, group: "Affix" });
  });

  it("has no group at all for an unlisted reference whose field does not name one", () => {
    const defs: Definitions = { ...DEFS, 100: { ...DEFS[100], fields: DEFS[100].fields!.map((f) => (f.name === "snoThing" ? { ...f, group: undefined } : f)) } };
    const mr = new MetaReader({ definitions: defs, toc: readCoreToc(coreToc()), snoGroupNames: { 104: "Affix" } });
    expect(mr.parseMeta(metaFile({ sno: 4321 })).snoThing).toEqual({ sno: 4321, name: null, group: -1 });
  });

  it("reads 0 and -1 references as nothing at all", () => {
    expect(reader().parseMeta(metaFile({ sno: 0 })).snoThing).toBeNull();
    expect(reader().parseMeta(metaFile({ sno: -1 })).snoThing).toBeNull();
  });

  it("counts a bad array offset as a soft error instead of throwing", () => {
    const mr = reader();
    const v = mr.parseMeta(metaFile({ extOffset: 1 << 20 })); // past the end of the file
    expect(v.arNumbers).toBeNull();
    expect(mr.errors).toBe(1);
  });

  it("refuses a file that is not a meta file", () => {
    expect(() => reader().parseMeta(new W().u32(1).u32(2).zeros(40).done())).toThrow(/signature/);
  });

  it("refuses a format hash no bundled definition describes", () => {
    const w = new W();
    w.u32(0xdeadbeef, 0).u32(0x11111111, 4).zeros(60);
    expect(() => reader().parseMeta(w.done())).toThrow(/no type for format hash/);
  });

  it("falls back to a named type when the build is newer than the definitions, and counts it", () => {
    const w = new W();
    w.u32(0xdeadbeef, 0).u32(0x11111111, 4).zeros(8);
    w.i32(7, 16).f32(1.5, 20).i32(0, 40).i32(0, 44).i32(1234, 16 + 24);
    const mr = reader();
    expect(mr.parseMeta(w.done(16 + 68), { asType: "TestDefinition" }).nCount).toBe(7);
    expect(mr.formatFallbacks).toBe(1);
  });

  it("resolves a GBID to its GameBalance name", () => {
    const defs: Definitions = {
      ...DEFS,
      20: { name: "DT_GBID", type: "basic", size: 4 },
      101: { name: "GbidHolder", type: "complex", size: 4, dwFormatHash: 0x55555555, fields: [{ name: "gbidFamily", hash: 9, offset: 0, type: 20, group: 18 }] },
    };
    const name = "Affix_Armor";
    const mr = new MetaReader({
      definitions: defs,
      toc: readCoreToc(coreToc()),
      snoGroupNames: { 104: "Affix" },
      gbid: { 18: { [gbidHash(name)]: name } },
    });
    const w = new W();
    w.u32(0xdeadbeef, 0).u32(0x55555555, 4).zeros(8).u32(gbidHash(name), 16);
    expect(mr.parseMeta(w.done(20))).toEqual({ gbidFamily: { gbid: gbidHash(name), name, group: 18 } });
    // 0xFFFFFFFF means "no gbid"
    const w2 = new W();
    w2.u32(0xdeadbeef, 0).u32(0x55555555, 4).zeros(8).u32(0xffffffff, 16);
    expect(mr.parseMeta(w2.done(20))).toEqual({ gbidFamily: null });
  });
});
