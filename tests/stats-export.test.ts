import { describe, expect, it } from "vitest";
import { bestsCsv, bestsOf, characterCsv, clock, csvCell, highestTier, localTime, lootCsv, lootJson, runsCsv, splitsCsv, statsFiles, toCsv } from "../src/lib/exportcore";
import type { JudgeResult, Run } from "../src/lib/types";

const T0 = new Date(2026, 9, 17, 20, 0, 0).getTime(); // local time, so the expected strings don't depend on the time zone
const min = 60_000;

const run = (p: Partial<Run> & { activity: string; start: number; end?: number }): Run => ({ id: `r${p.start}`, splits: [], deaths: 0, ...p });

const runs: Run[] = [
  run({ activity: "The Pit", tier: "T85", start: T0, end: T0 + 4 * min + 5000, success: true, splits: [{ label: "Guardian", at: T0 + 3 * min }], deaths: 1 }),
  run({ activity: "The Pit", tier: "T85", start: T0 + 10 * min, end: T0 + 13 * min, success: true }),
  run({ activity: "The Pit", tier: "T90", start: T0 + 20 * min, end: T0 + 26 * min, success: true }),
  run({ activity: "The Pit", tier: "T95", start: T0 + 30 * min, end: T0 + 32 * min, success: false, deaths: 3 }),
  run({ activity: "Helltide", start: T0 + 40 * min, end: T0 + 100 * min, success: true }),
];

const judged = (p: Partial<JudgeResult> = {}): JudgeResult => ({
  id: "j1",
  at: T0,
  item: {
    name: "Ring of Starless Skies",
    rarity: "Unique",
    itemType: "Ring",
    slot: "ring",
    itemPower: 800,
    affixes: [
      { text: "+12% Critical Strike Chance", greater: true },
      { text: "Resource Cost Reduction, 10%", greater: false },
    ],
    rawText: "RING OF STARLESS SKIES\nsecret OCR text",
    compare: { name: "Old Ring", rarity: "Legendary", itemType: "Ring", slot: "ring", itemPower: 750, affixes: [], rawText: "old raw" },
  },
  verdict: "WEAR",
  action: "Wear it.",
  score: 0.9,
  slot: "ring1",
  reasons: [],
  matched: ["Critical Strike Chance"],
  missing: ["Maximum Life"],
  greaterOnTargets: 1,
  thumb: "data:image/jpeg;base64,AAAA",
  ms: 120,
  ...p,
});

describe("CSV cells", () => {
  it("quotes commas, quotes and line breaks", () => {
    expect(csvCell("plain")).toBe("plain");
    expect(csvCell("a, b")).toBe('"a, b"');
    expect(csvCell('say "hi"')).toBe('"say ""hi"""');
    expect(csvCell("two\nlines")).toBe('"two\nlines"');
    expect(csvCell(" padded")).toBe('" padded"');
  });

  it("writes numbers, booleans and blanks", () => {
    expect(csvCell(12.5)).toBe("12.5");
    expect(csvCell(NaN)).toBe("");
    expect(csvCell(null)).toBe("");
    expect(csvCell(undefined)).toBe("");
    expect(csvCell(true)).toBe("true");
  });

  it("keeps text that looks like a formula as text, but not negative numbers", () => {
    expect(csvCell("=HYPERLINK(1)")).toBe("'=HYPERLINK(1)");
    expect(csvCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(csvCell("+cmd")).toBe("'+cmd");
    expect(csvCell("-12%")).toBe("-12%");
    expect(csvCell("+5 to Skeletal Warriors")).toBe("+5 to Skeletal Warriors");
  });

  it("builds a file with a header and CRLF lines", () => {
    expect(toCsv(["a", "b"], [[1, "x,y"], [null, "z"]])).toBe('a,b\r\n1,"x,y"\r\n,z\r\n');
  });
});

describe("times", () => {
  it("formats durations as a clock", () => {
    expect(clock(0)).toBe("0:00");
    expect(clock(4 * min + 5000)).toBe("4:05");
    expect(clock(3723_000)).toBe("1:02:03");
  });

  it("writes local times a spreadsheet can read", () => {
    expect(localTime(T0)).toBe("2026-10-17 20:00:00");
    expect(localTime(null)).toBe("");
  });
});

describe("runs and splits", () => {
  it("one row per finished run", () => {
    const lines = runsCsv([...runs, run({ activity: "The Pit", start: T0 + 200 * min })]).trim().split("\r\n");
    expect(lines[0]).toBe("started,ended,activity,tier,result,seconds,time,deaths,splits,notes,id");
    expect(lines).toHaveLength(1 + runs.length); // the unfinished run is left out
    expect(lines[1]).toBe(`2026-10-17 20:00:00,2026-10-17 20:04:05,The Pit,T85,cleared,245,4:05,1,Guardian 3:00,,r${T0}`);
    expect(lines[4]).toContain(",abandoned,");
  });

  it("one row per split, with the time from the start and from the split before", () => {
    const r = run({ activity: "The Pit", tier: "T85", start: T0, end: T0 + 5 * min, splits: [{ label: "Guardian", at: T0 + 2 * min }, { label: "Boss", at: T0 + 4 * min + 30_000 }] });
    const lines = splitsCsv([r]).trim().split("\r\n");
    expect(lines).toHaveLength(3);
    expect(lines[2]).toBe(`2026-10-17 20:00:00,The Pit,T85,2,Boss,2026-10-17 20:04:30,270,4:30,150,r${T0}`);
  });
});

describe("bests", () => {
  it("fastest and average clear per activity and tier, abandoned runs not timed", () => {
    const b = bestsOf(runs);
    expect(b.map((x) => `${x.activity} ${x.tier}`)).toEqual(["Helltide ", "The Pit T95", "The Pit T90", "The Pit T85"]);
    const t85 = b.find((x) => x.tier === "T85")!;
    expect(t85).toMatchObject({ runs: 2, cleared: 2, bestMs: 3 * min, bestAt: T0 + 10 * min, deaths: 1 });
    expect(t85.avgMs).toBe(Math.round((4 * min + 5000 + 3 * min) / 2));
    const t95 = b.find((x) => x.tier === "T95")!;
    expect(t95).toMatchObject({ runs: 1, cleared: 0, bestMs: null, avgMs: null, deaths: 3 });
    expect(bestsCsv(b).split("\r\n")[4]).toBe("The Pit,T85,2,2,180,3:00,2026-10-17 20:10:00,212.5,3:33,1");
  });

  it("the highest Pit tier cleared (not the abandoned one)", () => {
    expect(highestTier(runs, "The Pit")).toEqual({ tier: "T90", bestMs: 6 * min, at: T0 + 20 * min });
    expect(highestTier(runs, "Helltide")).toBeNull();
  });
});

describe("loot", () => {
  it("leaves out thumbnails and raw OCR text", () => {
    const j = lootJson(judged());
    expect(j).not.toHaveProperty("thumb");
    expect(j.item).not.toHaveProperty("rawText");
    expect(j.item.compare).not.toHaveProperty("rawText");
    expect(j.item.compare?.name).toBe("Old Ring");
    expect(j.judged).toBe(new Date(T0).toISOString());
    expect(JSON.stringify(j)).not.toMatch(/base64|secret OCR|old raw/);
  });

  it("one row per judged item", () => {
    const lines = lootCsv([judged()]).trim().split("\r\n");
    expect(lines[1]).toBe(
      '2026-10-17 20:00:00,Ring of Starless Skies,Unique,Ring,ring1,800,WEAR,Wear it.,0.9,Critical Strike Chance,Maximum Life,1,"+12% Critical Strike Chance (greater); Resource Cost Reduction, 10%",,false',
    );
  });
});

describe("character", () => {
  it("stats, skills and glyphs in one table", () => {
    const csv = characterCsv({
      stats: { "Maximum Life": "12,345", "Critical Strike Chance": "45.2%" },
      statsAt: T0,
      skills: { "bone-spear": { name: "Bone Spear", rank: 5, bonus: 3, total: 8, max: 5, at: T0 } },
      glyphs: { exploit: { name: "Exploit", level: 46, at: T0, active: true } },
    });
    const lines = csv.trim().split("\r\n");
    expect(lines[0]).toBe("kind,name,value,points_spent,from_gear,max,active,read_at");
    expect(lines[1]).toBe('stat,Maximum Life,"12,345",,,,,2026-10-17 20:00:00');
    expect(lines[3]).toBe("skill,Bone Spear,8,5,3,5,,2026-10-17 20:00:00");
    expect(lines[4]).toBe("glyph,Exploit,46,,,,true,2026-10-17 20:00:00");
  });
});

describe("the export", () => {
  it("a JSON with everything and a CSV per table", () => {
    const files = statsFiles({ runs, loot: [judged()], character: { stats: {}, statsAt: 0, skills: {}, glyphs: {} }, version: "0.3.0", now: T0 });
    expect(files.map((f) => f.name)).toEqual(["stats.json", "runs.csv", "splits.csv", "bests.csv", "loot.csv", "character.csv"]);
    const json = JSON.parse(files[0].text);
    expect(json.version).toBe("0.3.0");
    expect(json.runs).toHaveLength(5);
    expect(json.runs[0].splits[0]).toEqual({ label: "Guardian", at: new Date(T0 + 3 * min).toISOString(), fromStartMs: 3 * min });
    expect(json.bests.pitHighestTier.tier).toBe("T90");
    expect(json.character.statsRead).toBeNull();
    expect(files[0].text).not.toMatch(/base64|secret OCR/);
    for (const f of files.slice(1)) expect(f.text.startsWith("﻿")).toBe(true);
  });
});
