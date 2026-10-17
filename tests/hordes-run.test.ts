// Timing Infernal Hordes runs from the quest tracker, on reads from two real runs (2026-10-15, 2026-10-17) and on
// a dense replay built from their lines (the app reads the tracker every 2 s).
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { readHordesTracker, stepHordes, trackerWave, type HordesAction, type HordesRead, type HordesTracker } from "../src/lib/hordes";
import { isPersonalLine } from "../src/lib/privacy";

const fx: { runs: { name: string; reads: { at: string; src: string; lines: string[] }[] }[] } = JSON.parse(
  readFileSync(new URL("./fixtures/hordes/tracker-runs.json", import.meta.url), "utf8"),
);
const L = (s: string) => s.split(" | ").map((text) => ({ text }));

/** What the actions do to the run timer (like useRuns, without the store). */
function timer() {
  const t: HordesTracker = { run: null, endSeen: 0 };
  const runs: { start: number; splits: { label: string; at: number }[]; end?: number; success?: boolean; deaths: number }[] = [];
  let active: (typeof runs)[number] | null = null;
  const apply = (a: HordesAction, now: number) => {
    if (a.kind === "start" && !active) runs.push((active = { start: a.at, splits: [], deaths: 0 }));
    else if (a.kind === "split") active?.splits.push({ label: a.label, at: now });
    else if (a.kind === "death" && active) active.deaths += a.n;
    else if (a.kind === "discard" && active) {
      runs.pop();
      active = null;
    } else if (a.kind === "finish" && active) {
      active.end = a.at;
      active.success = a.success;
      active = null;
    }
  };
  return {
    t,
    runs,
    feed(read: HordesRead | null, now: number) {
      for (const a of stepHordes(t, read, now, !active)) apply(a, now);
    },
  };
}

const ms = (iso: string) => Date.parse(iso);

describe("reading the Hordes tracker", () => {
  it("reads wave, phase, torment and revives the way OCR sees them", () => {
    expect(readHordesTracker(L("WAVE; 0/ 10 | Torment X1 | The Infernal Hordes | Select an Infernal Offer • | Onslaught | Revives remaining: 4"))).toEqual({
      wave: 0,
      waves: 10,
      phase: "offer",
      torment: "XI",
      revives: 4,
    });
    expect(readHordesTracker(L("WAVE; 2/10 | xo:50 | 25 | Torment X1 | The Infernal Hordes | Slay monsters to draw out Aether • | Onslaught"))).toMatchObject({ wave: 2, phase: "wave" });
    expect(readHordesTracker(L("WAVE; 3/10 | 134 | Torment X1 | The Infernal Hordes | Slay monsters-to out Aether | Stay neat Lthe Souls15ire and slay foes: 0/15"))!.phase).toBe("wave");
    expect(readHordesTracker(L("WAVE; 10/10 | 1,234 | Torment X1 | The Infernal Hordes | Defeat théFell Council | Onslaught"))!.phase).toBe("council");
    expect(readHordesTracker(L("WAVE; 10/10 | 105 | Spoils of Materials | Torment X1 | The Infernal Hordes | Dungeon cleared"))!.phase).toBe("cleared");
    expect(readHordesTracker(L("WAVE; 4/ 10 | 313 | Torment X1 | The Infernal Hordes | Select an Inferfial Offer •"))!.phase).toBe("offer");
  });

  it("the council's name over its NPCs isn't the council fight", () => {
    expect(readHordesTracker(L("WAVE: 6/10 | 432 | 'Torment XI | The Infernal Hordes | Onslaught | THE FELL COUNCIL"))!.phase).toBeNull();
  });

  it("isn't the Hordes without the wave line, or on the key's tooltip", () => {
    expect(readHordesTracker(L("Torment X1 | Face the Infernal Hordes | Face the Infernal Hordes and survive the | final assault."))).toBeNull();
    expect(readHordesTracker(L("Cursed Shrine | Defeat 5 waves: 1/5"))).toBeNull();
    expect(trackerWave("WAVE; 2/ 10")).toBe(2);
  });

  it("the fixture names no player", () => {
    for (const r of fx.runs) for (const read of r.reads) for (const l of read.lines) expect(isPersonalLine(l), l).toBe(false);
  });
});

describe("timing real runs", () => {
  it("2026-10-17: starts on wave 1, one split per wave, finishes on the clear", () => {
    const tm = timer();
    const reads = fx.runs.find((r) => r.name === "2026-10-17")!.reads;
    for (const r of reads) tm.feed(readHordesTracker(r.lines.map((text) => ({ text }))), ms(r.at));
    // the end screen stays up while the Spoils are opened, then the tracker goes
    const end = ms(reads.at(-1)!.at);
    tm.feed(readHordesTracker(L(reads.at(-1)!.lines.join(" | "))), end + 8000);
    for (let k = 1; k <= 60; k++) tm.feed(null, end + 8000 + k * 2000);
    expect(tm.runs).toHaveLength(1);
    const run = tm.runs[0];
    // wave 1 was first read on the offer screen after it: it began when the first offer screen was last seen
    expect(run.start).toBe(ms("2026-10-17T06:04:51.408Z"));
    expect(run.end).toBe(ms("2026-10-17T06:22:09.523Z"));
    expect(run.success).toBe(true);
    expect(run.splits.map((s) => s.label)).toEqual(["Wave 1", "Wave 2", "Wave 3", "Wave 4", "Wave 5", "Wave 6", "Wave 7", "Wave 8", "Wave 9", "Wave 10"]);
    // wave 2 began at 06:07:05 (its countdown read 0:50)
    expect(run.splits[0].at).toBe(ms("2026-10-17T06:07:05.793Z"));
  });

  it("2026-10-15: sparse reads still give the waves and the Fell Council; gone for good ends it when last seen", () => {
    const tm = timer();
    const reads = fx.runs.find((r) => r.name === "2026-10-15")!.reads;
    for (const r of reads) tm.feed(readHordesTracker(r.lines.map((text) => ({ text }))), ms(r.at));
    const last = ms(reads.at(-1)!.at);
    for (let k = 1; k <= 50; k++) tm.feed(null, last + k * 2000);
    const run = tm.runs[0];
    expect(run.start).toBe(ms("2026-10-16T04:21:52.710Z"));
    expect(run.splits.map((s) => s.label)).toEqual(["Wave 1", "Wave 2", "Wave 3", "Wave 4", "Waves 5-9", "Wave 10"]);
    expect(run.end).toBe(last);
  });
});

describe("timing a run read every 2 s", () => {
  const offer = (w: number) => `WAVE: ${w}/10 | ${w * 90} | Torment XI | The Infernal Hordes | Select an Infernal Offer • | Onslaught | Revives remaining: ${w >= 6 ? 3 : 4}`;
  const fight = (w: number, revives = 4) => `WAVE: ${w}/10 | xo:${String(40 + (w % 10)).padStart(2, "0")} | ${w * 90} | Torment XI | The Infernal Hordes | Slay monsters to draw out Aether • | Onslaught | Revives remaining: ${revives}`;
  const council = "WAVE: 10/10 | 1,234 | Torment XI | The Infernal Hordes | Defeat the Fell Council | Onslaught | Revives remaining: 3";
  const cleared = "WAVE; 10/10 | 1,234 | Spoils of Materials | Torment X1 | The Infernal Hordes | Dungeon cleared | Onslaught | Revives remaining: 3";

  /** A full run: 20 s on the first offer, then 60 s per wave and 16 s per offer, the council 40 s, the end screen 30 s. */
  function script(): (string | null)[] {
    const out: string[] = [];
    const hold = (text: string, s: number) => {
      for (let k = 0; k < s / 2; k++) out.push(text);
    };
    hold(offer(0), 20);
    for (let w = 1; w <= 10; w++) {
      hold(fight(w, w >= 6 ? 3 : 4), 60);
      if (w < 10) hold(offer(w), 16);
    }
    hold(council, 40);
    hold(cleared, 30);
    return out;
  }

  function play(lines: (string | null)[], t0 = 1_800_000_000_000) {
    const tm = timer();
    lines.forEach((text, k) => tm.feed(text ? readHordesTracker(L(text)) : null, t0 + k * 2000));
    return { ...tm, t0, at: (k: number) => t0 + k * 2000 };
  }

  it("a whole run: wave splits at each wave's start, the council, the end at the clear", () => {
    const lines = [...script(), ...Array(60).fill(null)];
    const p = play(lines);
    expect(p.runs).toHaveLength(1);
    const run = p.runs[0];
    expect(run.start).toBe(p.at(10)); // the first read of wave 1
    expect(run.splits.map((s) => s.label)).toEqual([...Array.from({ length: 10 }, (_, i) => `Wave ${i + 1}`), "Fell Council"]);
    expect(run.splits[0].at).toBe(p.at(10 + 30 + 8)); // wave 2's first read
    const clearedAt = lines.indexOf(cleared);
    expect(run.end).toBe(p.at(clearedAt));
    expect(run.success).toBe(true);
    // a revive went in wave 6
    expect(run.deaths).toBe(1);
  });

  it("one misread wave number doesn't split, and the end screen never starts another run", () => {
    const lines = script();
    // a digit slip in wave 2, and a "1/10" read on the end screen
    lines[60] = fight(7);
    const clearedAt = lines.indexOf(cleared);
    lines[clearedAt + 5] = fight(1);
    const p = play([...lines, ...Array(60).fill(null)]);
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0].splits.map((s) => s.label).slice(0, 3)).toEqual(["Wave 1", "Wave 2", "Wave 3"]);
  });

  it("the tracker hidden for a minute (map, bag) keeps the run; gone for good ends it when last seen", () => {
    const lines = script().slice(0, 120); // into wave 2
    const hidden = [...lines, ...Array(30).fill(null), ...script().slice(120, 160), ...Array(50).fill(null)];
    const p = play(hidden);
    expect(p.runs).toHaveLength(1);
    expect(p.runs[0].success).toBe(false);
    expect(p.runs[0].end).toBe(p.at(120 + 30 + 40 - 1));
  });

  it("a stray wave 1 read is never a 2 second run", () => {
    const p = play([fight(1), ...Array(50).fill(null)]);
    expect(p.runs).toHaveLength(0);
  });

  it("a new run right after the last one (no clear seen) ends the old one and starts again", () => {
    const first = script().slice(0, 200); // into wave 3
    const p = play([...first, ...Array(10).fill(null), ...script().slice(0, 40), ...Array(50).fill(null)]);
    expect(p.runs).toHaveLength(2);
    expect(p.runs[0].end).toBe(p.at(199));
    expect(p.runs[1].start).toBe(p.at(200 + 10 + 10));
  });

  it("joining mid-run (app started late) times nothing", () => {
    const p = play([...script().slice(300), ...Array(10).fill(null)]);
    expect(p.runs).toHaveLength(0);
  });
});
