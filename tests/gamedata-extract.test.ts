// The extractor end to end, on a tiny game-data fixture built here by hand: a CoreTOC with two
// groups, one StringList container and one Affix meta file, read through an in-memory GameDataIO.
//
// Nothing here comes from Diablo IV.
import { describe, expect, it } from "vitest";
import { extract, evalArithmetic, plain, resolveText } from "../src/lib/gamedata/extract";
import { genHordes, genMapPois, genOcrVocab } from "../src/lib/gamedata/gen";
import { parseBuildInfo, type GameDataIO } from "../src/lib/gamedata/io";
import { needsReread, type CacheManifest } from "../src/lib/gamedata/pipeline";
import type { Definitions } from "../src/lib/gamedata/d4meta";

// ------------------------------------------------------------------------------------------------
// fixture builders

function buf(len: number) {
  const b = new Uint8Array(len);
  const dv = new DataView(b.buffer);
  return {
    b,
    i32: (at: number, v: number) => dv.setInt32(at, v, true),
    u32: (at: number, v: number) => dv.setUint32(at, v, true),
    f32: (at: number, v: number) => dv.setFloat32(at, v, true),
    ascii: (at: number, s: string) => {
      for (let i = 0; i < s.length; i++) b[at + i] = s.charCodeAt(i);
    },
  };
}

/**
 * A CoreTOC.dat. In the real file a group's column index is its group number, so this pads every
 * group up to the highest one asked for.
 */
function coreToc(groups: Record<number, [number, string][]>, formatHashes: Record<number, number> = {}) {
  const n = Math.max(...Object.keys(groups).map(Number)) + 1;
  const cols = Array.from({ length: n }, (_, g) => groups[g] ?? []);
  const pools = cols.map((rows) => rows.map(([, name]) => name + "\0").join(""));
  const offsets: number[] = [];
  let at = 0;
  for (let g = 0; g < n; g++) {
    offsets.push(at);
    at += 12 * cols[g].length + pools[g].length;
  }
  const dataStart = 12 + 16 * n;
  const w = buf(dataStart + at);
  w.u32(0, 0xbcde6611);
  w.u32(4, n);
  for (let g = 0; g < n; g++) {
    w.u32(8 + 4 * g, cols[g].length);
    w.u32(8 + 4 * n + 4 * g, offsets[g]);
    w.u32(8 + 12 * n + 4 * g, formatHashes[g] ?? 0);
  }
  for (let g = 0; g < n; g++) {
    const base = dataStart + offsets[g];
    const pool = base + 12 * cols[g].length;
    let nameAt = 0;
    cols[g].forEach(([id, name], i) => {
      w.i32(base + 12 * i, g);
      w.i32(base + 12 * i + 4, id);
      w.i32(base + 12 * i + 8, nameAt);
      w.ascii(pool + nameAt, name + "\0");
      nameAt += name.length + 1;
    });
  }
  return w.b;
}

/** An "n entries, none of them" table, the shape EncryptedSNOs.dat and friends have. */
const emptyTable = () => buf(8).b;

const STRINGLIST_FMT = 0x5151_5151;
const AFFIX_FMT = 0xaff1_0000;

/** One StringList sub-buffer: [sno][pad][arStrings ptr] then the label/text pairs and the pool. */
function stringListBody(sno: number, strings: [string, string][]) {
  const HEAD = 24; // snoThis(4) + pad(4) + arStrings(16)
  const ENTRY = 32; // szLabel(16) + szText(16)
  const pool: string[] = [];
  let poolAt = HEAD + ENTRY * strings.length;
  const parts: { at: number; s: string }[] = [];
  const w = buf(poolAt + strings.flatMap(([a, b]) => [a, b]).join("").length);
  w.i32(0, sno);
  w.i32(8, 0);
  w.i32(12, 0);
  w.i32(16, HEAD); // data offset
  w.i32(20, ENTRY * strings.length); // data size
  strings.forEach(([label, text], i) => {
    const e = HEAD + ENTRY * i;
    for (const [off, s] of [
      [e + 8, label],
      [e + 24, text],
    ] as [number, string][]) {
      w.i32(off, poolAt);
      w.i32(off + 4, s.length);
      parts.push({ at: poolAt, s });
      poolAt += s.length;
    }
  });
  for (const p of parts) w.ascii(p.at, p.s);
  void pool;
  return w.b;
}

/** A combined meta container (the shape StringList-Text-enUS.dat has). */
function combinedMeta(bodies: [number, Uint8Array][]) {
  const head = 8 + bodies.length * 8;
  const starts: number[] = [];
  let at = head;
  for (const [, body] of bodies) {
    at = Math.ceil(at / 8) * 8;
    starts.push(at);
    at += body.length;
  }
  const w = buf(at);
  w.u32(0, 0x44cf00f5);
  w.u32(4, bodies.length);
  bodies.forEach(([sno, body], i) => {
    w.i32(8 + i * 8, sno);
    w.u32(12 + i * 8, body.length);
    w.b.set(body, starts[i]);
  });
  return w.b;
}

/** A standalone Affix meta file. */
function affixMeta(sno: number, { staticValues = [0.25, 10], tempered = true } = {}) {
  const HEAD = 16;
  const SIZE = 40; // eMagicType(4) bIsTempered(1) pad(3) arStaticValues(16) nItemPowerMin/Max(8) + pad
  const dataAt = SIZE;
  const w = buf(HEAD + dataAt + staticValues.length * 4);
  w.u32(0, 0xdeadbeef);
  w.u32(4, AFFIX_FMT);
  w.i32(HEAD + 0, 3); // eMagicType: legendary
  w.b[HEAD + 4] = tempered ? 1 : 0;
  w.i32(HEAD + 8, 0);
  w.i32(HEAD + 12, 0);
  w.i32(HEAD + 16, dataAt);
  w.i32(HEAD + 20, staticValues.length * 4);
  w.i32(HEAD + 24, 300); // nItemPowerMin
  w.i32(HEAD + 28, 800); // nItemPowerMax
  staticValues.forEach((v, i) => w.f32(HEAD + dataAt + i * 4, v));
  w.i32(HEAD + 32, sno);
  return w.b;
}

const DEFS: Definitions = {
  1: { name: "DT_INT", type: "basic", size: 4 },
  2: { name: "DT_FLOAT", type: "basic", size: 4 },
  3: { name: "DT_CSTRING", type: "basic", size: 16 },
  4: { name: "DT_VARIABLEARRAY", type: "basic", size: 16 },
  5: { name: "DT_BYTE", type: "basic", size: 1 },
  6: { name: "DT_ENUM", type: "basic", size: 4 },
  200: {
    name: "StringEntry",
    type: "complex",
    size: 32,
    fields: [
      { name: "szLabel", hash: 1, offset: 0, type: 3 },
      { name: "szText", hash: 2, offset: 16, type: 3 },
    ],
  },
  201: {
    name: "StringListDefinition",
    type: "complex",
    size: 24,
    dwFormatHash: STRINGLIST_FMT,
    fields: [
      { name: "snoThis", hash: 3, offset: 0, type: 1 },
      { name: "arStrings", hash: 4, offset: 8, type: [4, 200] },
    ],
  },
  202: {
    name: "AffixDefinition",
    type: "complex",
    size: 40,
    dwFormatHash: AFFIX_FMT,
    fields: [
      { name: "eMagicType", hash: 5, offset: 0, type: 6 },
      { name: "bIsTemperedAffix", hash: 6, offset: 4, type: 5, serializedBitCount: 1 },
      { name: "arStaticValues", hash: 7, offset: 8, type: [4, 2] },
      { name: "nItemPowerMin", hash: 8, offset: 24, type: 1 },
      { name: "nItemPowerMax", hash: 9, offset: 28, type: 1 },
    ],
  },
};

const VENDOR: Record<string, string> = {
  "definitions.json": JSON.stringify(DEFS),
  "json/snoFileInfo.json": JSON.stringify({ 42: ["StringList"], 104: ["Affix"] }),
  "attributeList.json": JSON.stringify({ a: { eAttrib: 1, name: "Armor" } }),
  "buildVersion.txt": "9.9.9.1\n",
};

const AFFIX_SNO = 777;
const STL_SNO = 4242;

/** A GameDataIO over two Maps, so the extractor can run with no filesystem at all. */
function memoryIo(files: Record<string, Uint8Array>) {
  const written = new Map<string, string>();
  const cascCalls: { names: string[]; mode: string }[] = [];
  const io: GameDataIO = {
    async read(rel) {
      return files[rel] ?? null;
    },
    async readMany(rels) {
      return rels.map((r) => files[r] ?? null);
    },
    async list(rel) {
      return Object.keys(files)
        .filter((f) => f.startsWith(rel + "/") && !f.slice(rel.length + 1).includes("/"))
        .map((f) => f.slice(rel.length + 1));
    },
    async vendor(rel) {
      return VENDOR[rel];
    },
    async write(rel, text) {
      written.set(rel, text);
    },
    async clean() {},
    async cleanRaw() {},
    async casc(names, mode) {
      cascCalls.push({ names, mode });
      return { failed: 0 };
    },
    async rawBytes() {
      return 123;
    },
    progress() {},
    async tick() {},
  };
  return { io, written, cascCalls };
}

const fixture = () => ({
  "base/CoreTOC.dat": coreToc({ 20: [], 42: [[STL_SNO, "Affix_TestAffix"]], 104: [[AFFIX_SNO, "TestAffix"]] }, { 42: STRINGLIST_FMT }),
  "base/CoreTOCReplacedSnosMapping.dat": emptyTable(),
  "base/EncryptedSNOs.dat": emptyTable(),
  "base/StringList-Text-enUS.dat": combinedMeta([
    [
      STL_SNO,
      stringListBody(STL_SNO, [
        ["Name", "of the Test"],
        ["Desc", "{c_important}Lucky Hit:{/c} up to a [Affix.\"Static Value 0\"*100|1%|] chance"],
      ]),
    ],
  ]),
  [`base/meta/${AFFIX_SNO}`]: affixMeta(AFFIX_SNO),
});

// ------------------------------------------------------------------------------------------------

describe("extract", () => {
  it("turns a game-data fixture into the documents the app reads", async () => {
    const { io, written } = memoryIo(fixture());
    const out = await extract({ io, build: { version: "9.9.9.9", buildKey: "abc" }, skipCasc: true });

    const affixes = out.docs["affixes.json"];
    expect(affixes.build).toBe("9.9.9.9");
    expect(affixes.count).toBe(1);
    const a = affixes.entries[0];
    expect(a.sno).toBe(AFFIX_SNO);
    expect(a.id).toBe("TestAffix");
    expect(a.name).toBe("of the Test");
    expect(a.magicType).toBe(3);
    expect(a.itemPower).toEqual([300, 800]);
    expect(a.tempered).toBe(true);
    expect(a.staticValues).toEqual([0.25, 10]);
    // the description's [...] block is filled in from the static values, and plain text strips tags
    expect(a.descResolved).toBe("{c_important}Lucky Hit:{/c} up to a 25% chance");
    expect(a.descPlain).toBe("Lucky Hit: up to a 25% chance");

    // the string list went into strings/affixes.json, and the manifest counted everything
    expect(Object.keys(out.docs["strings/affixes.json"])).toEqual(["Affix_TestAffix"]);
    expect(out.docs["strings/affixes.json"].Affix_TestAffix.Name).toBe("of the Test");
    expect(out.manifest.counts).toMatchObject({ affixes: 1, stringLists: 1, strings: 2 });
    expect(out.manifest.definitionsBuild).toBe("9.9.9.1");
    expect(out.manifest.parseErrors).toBe(0);
    expect(out.manifest.readerSoftErrors).toBe(0);

    // every document was written, pretty-printed with a single space, newline terminated
    expect(written.get("affixes.json")!.startsWith('{\n "build": "9.9.9.9"')).toBe(true);
    expect(written.get("affixes.json")!.endsWith("\n")).toBe(true);
    expect([...written.keys()]).toContain("manifest.json");
  });

  it("asks cascx for the core files first and then only the groups it parses", async () => {
    const { io, cascCalls } = memoryIo(fixture());
    await extract({ io, build: { version: "9.9.9.9" } });
    expect(cascCalls[0].mode).toBe("mask");
    expect(cascCalls[0].names).toContain("base:CoreTOC.dat");
    expect(cascCalls[1].mode).toBe("list");
    // only the Affix entry exists in the fixture TOC; "\\" is how CASC spells the meta folder
    expect(cascCalls[1].names).toEqual([`base:meta\\${AFFIX_SNO}`]);
  });

  it("will not start without the files everything else is read through", async () => {
    const files = fixture();
    delete (files as Record<string, unknown>)["base/CoreTOC.dat"];
    const { io } = memoryIo(files);
    await expect(extract({ io, build: { version: "9.9.9.9" }, skipCasc: true })).rejects.toThrow(/CoreTOC/);
  });

  it("does not write what the host said it does not want", async () => {
    const { io, written } = memoryIo(fixture());
    await extract({ io, build: { version: "9.9.9.9" }, skipCasc: true, keep: (rel) => rel === "affixes.json" });
    expect([...written.keys()]).toEqual(["affixes.json"]);
  });
});

// ------------------------------------------------------------------------------------------------

describe("text helpers", () => {
  it("strips the game's markup", () => {
    expect(plain("{c_important}Thorns{/c}")).toBe("Thorns");
    expect(plain("+[{VALUE}|1%|] Armor")).toBe("+# Armor");
    expect(plain("{if:mythic}A{else}B{/if}")).toBe("AB");
    expect(plain(null)).toBe(null);
  });

  it("fills in values it can work out, and leaves the rest alone", () => {
    expect(resolveText('[Affix."Static Value 0"*100|1%|]', [0.25])).toBe("25%");
    expect(resolveText("[{VALUE}*2]", [], { VALUE: 3 })).toBe("6");
    // an unknown token stays as it was
    expect(resolveText('[Affix."Static Value 3"*100|1%|]', [0.25])).toBe('[Affix."Static Value 3"*100|1%|]');
    expect(resolveText("[SomeFormula(x)]", [1])).toBe("[SomeFormula(x)]");
  });

  it("evaluates only arithmetic", () => {
    const cases: [string, number][] = [
      ["1+2", 3],
      ["2*3+1", 7],
      ["1+2*3", 7],
      ["(1+2)*3", 9],
      ["10/4", 2.5],
      ["-3+1", -2],
      ["2*-3", -6],
      ["1-2-3", -4],
      ["8/2/2", 2],
      ["0.25*100", 25],
    ];
    for (const [src, want] of cases) expect(evalArithmetic(src), src).toBeCloseTo(want, 10);
    for (const bad of ["", "()", "1+", "x", "1 2", "fetch(1)", "1)"]) expect(() => evalArithmetic(bad), bad).toThrow();
  });
});

describe("parseBuildInfo", () => {
  const file = [
    "Branch!STRING:0|Active!DEC:1|Build Key!HEX:16|CDN Key!HEX:16|Tags!STRING:0|Version!STRING:0|Product!STRING:0",
    "eu|0|aaaa|bbbb|Windows|3.2.2.73764|fenris",
    "us|1|cccc|dddd|Windows enUS|3.2.3.73883|fenris",
  ].join("\r\n");

  it("takes the active row", () => {
    expect(parseBuildInfo(file)).toEqual({
      version: "3.2.3.73883",
      buildKey: "cccc",
      cdnKey: "dddd",
      branch: "us",
      product: "fenris",
      tags: "Windows enUS",
    });
  });

  it("falls back to the first row when none is marked active", () => {
    expect(parseBuildInfo(file.replace("us|1|", "us|0|")).version).toBe("3.2.2.73764");
  });
});

describe("needsReread", () => {
  const cache: CacheManifest = {
    v: 1, build: "3.2.3.73883", buildKey: "cccc", definitionsBuild: "3.2.1.73552", read: 1, files: ["affixes.json"], counts: {},
  };
  const build = { version: "3.2.3.73883", buildKey: "cccc" };

  it("is happy when the cache matches the install", () => {
    expect(needsReread(cache, build, "3.2.1.73552")).toBe(false);
    expect(needsReread(cache, build)).toBe(false);
  });

  it("notices a patch", () => {
    expect(needsReread(cache, { version: "3.2.4.74000", buildKey: "eeee" }, "3.2.1.73552")).toBe(true);
  });

  it("notices a rebuild that kept the version string", () => {
    expect(needsReread(cache, { version: "3.2.3.73883", buildKey: "ffff" })).toBe(true);
  });

  it("notices newer bundled type definitions", () => {
    expect(needsReread(cache, build, "3.3.0.80000")).toBe(true);
  });

  it("wants a read when there is nothing cached, or the cache is half-written", () => {
    expect(needsReread(null, build)).toBe(true);
    expect(needsReread(undefined, build)).toBe(true);
    expect(needsReread({ ...cache, v: 0 as 1 }, build)).toBe(true);
    expect(needsReread({ ...cache, files: [] }, build)).toBe(true);
  });
});

// ------------------------------------------------------------------------------------------------

describe("the app's generated tables", () => {
  const docs = {
    "strings/actors.json": {
      Actor_BSK_PylChoiceGizmo_Test: { ShortenedName: "Test Offer", Name: "{c_bad}Bane line{/c}\nBoon line one\nBoon line two" },
      Actor_BSK_UniqueOpChest_Test: { Name: "Chest of Testing\nOpening requires 25 Burning Aether" },
      Actor_BSK_UniqueOpChestCheap_Test: { Name: "Cheap chest" },
      Actor_Other: { Name: "Not an offer" },
    },
    "strings/items.json": {
      Item_BountyMeta_Cache_Test: { Name: "Test Cache", Description: "A cache" },
      Item_BountyMeta_Cache_Test_Ancestral: { Name: "Ancestral Test Cache", Description: "A better cache" },
      Item_BountyMeta_Cache_Bloodied_Test: { Name: "Skipped" },
    },
    "strings/ui.json": { UIToolTips: { EmptySocket: "Empty Socket", ItemPower: "Item Power {VALUE}" }, HeroDetailsEntries: {}, HeroDetails: {} },
    "strings/powers.json": {
      SkillTagNames: { SKILL_TAG_BONE: "Bone" },
      SkillTags: { Skill_Occult_TagName: "Occult", Keyword_Vulnerable_TagName: "Vulnerable", Subpower_Thing_TagName: "Thing" },
      SpiritbornMechanic: { Eagle: "Eagle" },
      PaladinOath: { Oath1Name: "Zealot", Oath1Desc: "not a tag" },
      AttributeDescriptions: { Armor: "+[{VALUE}] Armor" },
    },
    "strings/affixes.json": {},
    "strings/paragon.json": {},
    "strings/recipes.json": {},
    "affixes.json": { entries: [{ id: "A", magicType: 3, name: "of Thorns", descPlain: "Thorny", attributes: [{ attribute: "Armor", text: "+[{VALUE}] Armor" }] }] },
    "aspects.json": { entries: [{ name: "of Berserk Ripping", descPlain: "Rips" }] },
    "uniques.json": { entries: [{ name: "Tyrael's Might", flavor: "A flavour line", forcedAffixes: [], inherentAffixes: [] }] },
    "items.json": { entries: [{ name: "Grand Helm", itemTypeName: "Helm" }], itemTypes: { Helm: "Helm" } },
    "gems_runes.json": { gems: [], runes: [] },
    "charms.json": { charms: [], setBonuses: [] },
    "powers.json": { skills: [{ id: "Necromancer_BonePrison", name: "Bone Prison", desc: "Bones" }] },
  };

  it("reads the Hordes offers, chests and whisper caches", () => {
    const h = genHordes(docs);
    expect(h.offers).toEqual([{ key: "Test", title: "Test Offer", bane: "Bane line", boon: "Boon line one Boon line two" }]);
    // the "Cheap" variants and anything that is not a chest are left out
    expect(h.chests).toEqual([{ key: "BSK_UniqueOpChest_Test", name: "Chest of Testing", detail: "Opening requires 25 Burning Aether", cost: 25 }]);
    expect(h.whisperCaches.map((c) => [c.key, c.tier])).toEqual([
      ["Test", "normal"],
      ["Test_Ancestral", "ancestral"],
    ]);
  });

  it("slims the map down to the kinds the app draws", () => {
    const map = {
      build: "9.9.9.9",
      projection: { span: 100, artSize: 4096, artCenter: { x: 1, y: 2 } },
      regions: { Scosglen: "Scosglen" },
      entries: [
        { kind: "waypoint", name: "Cerrigar", region: "Scosglen", x: 10.4, y: -3.6, key: "Cerrigar", precision: "exact" },
        { kind: "helltide_chest", name: "Helltide chest spawn point", region: "Scosglen", x: 1, y: 2, key: "k", markerSet: 5, markerId: 9, extra: { tier: "t3" } },
        { kind: "side_quest", name: "A Quest", region: "Scosglen", x: 1, y: 2, key: "QST_A", precision: "approx" },
        { kind: "portal", name: "Dropped", region: "Scosglen", x: 0, y: 0, key: "p" },
        { kind: "waypoint", name: "No region", region: null, x: 0, y: 0, key: "n" },
      ],
    };
    const out = genMapPois(map);
    expect(out.pois).toEqual([
      { k: "waypoint", n: "Cerrigar", r: "Scosglen", x: 10, y: -4, id: "Cerrigar" },
      { k: "helltide_chest", r: "Scosglen", x: 1, y: 2, id: "5:9", t: "t3" },
      { k: "side_quest", n: "A Quest", r: "Scosglen", x: 1, y: 2, id: "QST_A", a: 1 },
    ]);
    expect(out.projection).toEqual({ span: 100, artSize: 4096, artCenter: { x: 1, y: 2 } });
  });

  it("builds the OCR vocabulary from the game's own words only", () => {
    const v = genOcrVocab(docs, "9.9.9.9");
    expect(v.meta.source).toBe("game files 9.9.9.9");
    expect(v.words.split(" ")).toContain("thorns");
    expect(v.words.split(" ")).toContain("tyrael's");
    expect(v.words.split(" ")).toContain("berserk");
    expect(v.stats).toContain("armor");
    // skill tags come from four game lists; keywords and sub-powers are not tags
    expect(v.stats).toContain("to bone skills");
    expect(v.stats).toContain("to occult skills");
    expect(v.stats).toContain("to eagle skills");
    expect(v.stats).toContain("to zealot skills");
    expect(v.stats).not.toContain("to vulnerable skills");
    expect(v.stats).not.toContain("to thing skills");
    // a skill's own name, for "+3 to Bone Prison"
    expect(v.stats).toContain("to bone prison");
    expect(v.ui).toContain("Empty Socket");
    expect(v.types).toContain("Helm");
  });
});
