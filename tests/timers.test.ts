import { describe, expect, it } from "vitest";
import { fmtCountdown, localSchedule } from "../src/lib/timers";

describe("local event schedule", () => {
  const t0 = Date.UTC(2026, 9, 10, 4, 0, 0);
  const ev = localSchedule(t0, 12);
  const s = (ms: number) => Math.floor(ms / 1000);

  it("is sorted", () => {
    expect(ev.map((e) => e.start)).toEqual([...ev.map((e) => e.start)].sort((a, b) => a - b));
  });

  it("world boss every 3h30m", () => {
    const wb = ev.filter((e) => e.kind === "worldBoss");
    expect(wb.length).toBeGreaterThanOrEqual(3);
    for (const e of wb) expect(s(e.start) % 12600).toBe(10800);
  });

  it("legion every 25 minutes", () => {
    for (const e of ev.filter((e) => e.kind === "legion")) expect(s(e.start) % 1500).toBe(1200);
  });

  it("helltide on the hour, ending at :55", () => {
    const ht = ev.filter((e) => e.kind === "helltide");
    expect(ht).toHaveLength(12);
    for (const e of ht) {
      expect(s(e.start) % 3600).toBe(0);
      expect(e.end! - e.start).toBe(55 * 60 * 1000);
    }
  });

  it("formats countdowns", () => {
    expect(fmtCountdown(65_000)).toMatch(/1:05|1m/);
    expect(fmtCountdown(3 * 3600_000 + 54 * 60_000)).toMatch(/3h ?54m/);
  });
});
