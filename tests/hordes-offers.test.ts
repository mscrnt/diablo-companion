// Infernal Offers as two players in one party read them (2026-10-15 test): Kenneth and his wife got different
// picks. Each app kept the three offers its own camera read most often (there are four), and the offer a player
// stands next to shows its effects instead of its title, so it went missing. 35 real offer screens, OCR text only.
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { byRank, findOffers, rankRemembered, rememberOffers, type Remembered } from "../src/lib/hordes";
import { loadStaticData } from "../src/lib/names";

beforeAll(() => loadStaticData());

const screens: { at: string; ocr: string[] }[] = JSON.parse(readFileSync(new URL("./fixtures/hordes/offer-screens-2026-10-15.json", import.meta.url), "utf8"));
const read = (s: { ocr: string[] }) =>
  findOffers(
    s.ocr.map((text, i) => ({ text, x: 0, y: i * 20, w: 100, h: 18 })) as any,
    { x: 0, y: 0 },
    "balanced",
  );
const at = (t: string) => screens.find((s) => s.at.includes(t))!;
/** the screens of one offer screen (wave), in order */
const wave = (from: string, to: string) => screens.filter((s) => s.at.slice(11, 19) >= from && s.at.slice(11, 19) <= to);
const keys = (xs: { key: string }[]) => xs.map((o) => o.key).sort();

describe("the offer you stand next to", () => {
  it("is read from its effects when its title is replaced", () => {
    // "Soulspires spawn less often / Soulspires grant 2.5x Aether": the best offer of the wave
    expect(keys(read(at("04-23-04")))).toContain("PreciousSpires");
  });

  it("tells similar offers apart by their numbers", () => {
    // 2.25x is The Treasured Spires, not The Precious (2.5x) or The Coveted (2x)
    const k = keys(read(at("04-31-59")));
    expect(k).toContain("TreasuredSpires");
    expect(k).not.toContain("PreciousSpires");
    expect(k).not.toContain("CovetedSpires");
  });

  it("tells apart two offers with the same title", () => {
    // "The Summoned Hellborne" that spawns "with Aether Events", not the one "hunting you"
    const k = keys(read(at("04-30-32")));
    expect(k).toContain("SummonedHellborne");
    expect(k).not.toContain("SkulkingHellborne");
  });
});

describe("a wave's four offers", () => {
  const want: [string, string, string[]][] = [
    ["04:21:00", "04:21:59", ["CorruptingSpires", "FiendishLegions", "RagingHellfire", "ThrivingMasses"]],
    ["04:22:30", "04:23:59", ["AnchoredMasses", "HellishMasses", "PreciousSpires", "TransitiveSpires"]],
    ["04:24:00", "04:24:59", ["AmbushingHellborne", "EmpoweredElites", "FiendishLegions", "PreciousSpires"]],
    ["04:33:00", "04:33:59", ["AmbushingHellborne", "GestatingMasses", "HellishMasses", "ThrivingMasses"]],
  ].map(([a, b, k]) => [String(a).replace(/:/g, "-"), String(b).replace(/:/g, "-"), k as string[]]);

  it("are all found across the screen's reads, and nothing else", () => {
    for (const [from, to, k] of want) {
      const m: Remembered = new Map();
      for (const s of wave(from, to)) rememberOffers(m, read(s));
      expect(keys(rankRemembered(m, [])), from).toEqual(k);
    }
  });

  it("two players reading different frames get the same ranking", () => {
    for (const [from, to] of want) {
      const frames = wave(from, to);
      const a: Remembered = new Map();
      const b: Remembered = new Map();
      // one player sees the screen from one side, the other from the other: same frames, other order and counts
      for (const s of frames) rememberOffers(a, read(s));
      for (const s of [...frames].reverse().concat(frames.slice(-1))) rememberOffers(b, read(s));
      expect(rankRemembered(b, []).map((o) => o.key), from).toEqual(rankRemembered(a, []).map((o) => o.key));
    }
  });

  it("The Precious Spires comes first when it's offered", () => {
    for (const [from, to, k] of want.filter(([, , k]) => k.includes("PreciousSpires"))) {
      const m: Remembered = new Map();
      for (const s of wave(from, to)) rememberOffers(m, read(s));
      expect(rankRemembered(m, [])[0].key, `${from} ${k}`).toBe("PreciousSpires");
    }
  });
});

it("ties keep a fixed order", () => {
  const xs = [
    { key: "ThrivingMasses", score: 3.4 },
    { key: "FiendishLegions", score: 3.4 },
    { key: "RagingHellfire", score: 3.6 },
  ];
  expect([...xs].sort(byRank).map((o) => o.key)).toEqual(["RagingHellfire", "FiendishLegions", "ThrivingMasses"]);
  expect([...xs].reverse().sort(byRank).map((o) => o.key)).toEqual(["RagingHellfire", "FiendishLegions", "ThrivingMasses"]);
});
