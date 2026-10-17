import { describe, expect, it } from "vitest";
import { fmtCountdown, localSchedule, predictHelltideZone, predictWorldBoss, predictWorldBossZone } from "../src/lib/timers";

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

// World events predicted with no outside service: checked against what we saw ourselves (2026-10-13 to 10-17).
const at = (iso: string) => Date.parse(iso) / 1000;

describe("world bosses", () => {
  it("the boss of each spawn we saw", () => {
    const seen: [string, string][] = [
      ["2026-10-13T09:00:00Z", "Avarice"],
      ["2026-10-16T07:00:00Z", "Wandering Death"],
      ["2026-10-17T04:00:00Z", "Azmodan"],
      ["2026-10-17T07:30:00Z", "Wandering Death"],
      ["2026-10-17T11:00:00Z", "Wandering Death"],
      ["2026-10-17T14:30:00Z", "Avarice"],
      ["2026-10-17T18:00:00Z", "Avarice"],
      ["2026-10-17T21:30:00Z", "Ashava"],
    ];
    for (const [t, boss] of seen) expect(predictWorldBoss(at(t)).boss, t).toBe(boss);
  });

  it("the slot that isn't settled says so (2026-10-16 03:30 was Azmodan)", () => {
    expect(predictWorldBoss(at("2026-10-16T03:30:00Z"))).toMatchObject({ boss: "Wandering Death", maybe: "Azmodan" });
  });

  it("every 4th spawn also spawns in Nahantu or Skovos", () => {
    expect(predictWorldBoss(at("2026-10-17T11:00:00Z")).expansion).toBe(true); // Kehjistan + Nahantu
    expect(predictWorldBoss(at("2026-10-13T09:00:00Z")).expansion).toBe(true); // Fractured Peaks + Skovos
    expect(predictWorldBoss(at("2026-10-17T07:30:00Z")).expansion).toBe(false);
    expect(predictWorldBoss(at("2026-10-17T14:30:00Z")).expansion).toBe(false);
  });

  it("the schedule names them, every 3h30m", () => {
    const wb = localSchedule(Date.parse("2026-10-17T06:00:00Z"), 12).filter((e) => e.kind === "worldBoss");
    expect(wb.map((e) => [new Date(e.start).toISOString().slice(11, 16), e.name])).toEqual([
      ["07:30", "Wandering Death"],
      ["11:00", "Wandering Death"],
      ["14:30", "Avarice"],
    ]);
    expect(wb[1].zone).toMatch(/Nahantu or Skovos/);
  });

  it("the likely main zone, where our data settled it (about 2 in 3 right)", () => {
    // near-spawn zones: 2026-10-17 07:30 Scosglen, 11:00 Kehjistan (+ Nahantu), 2026-10-16 03:30 Hawezar
    expect(predictWorldBossZone(at("2026-10-17T07:30:00Z"))).toBe("Scosglen");
    expect(predictWorldBossZone(at("2026-10-17T11:00:00Z"))).toBe("Kehjistan");
    expect(predictWorldBossZone(at("2026-10-16T03:30:00Z"))).toBe("Hawezar");
    // an unsettled slot gives no guess
    expect(predictWorldBossZone(at("2026-10-17T04:00:00Z"))).toBeUndefined();
    const wb = localSchedule(Date.parse("2026-10-17T06:00:00Z"), 6).filter((e) => e.kind === "worldBoss");
    expect(wb[0].zone).toBe("probably Scosglen");
    expect(wb[1].zone).toBe("probably Kehjistan, also Nahantu or Skovos");
  });
});

describe("helltides", () => {
  it("the zone of each hour we saw", () => {
    const seen: [string, string][] = [
      ["2026-10-13T05:00:00Z", "Dry Steppes"],
      ["2026-10-16T03:00:00Z", "Dry Steppes"],
      ["2026-10-16T04:00:00Z", "Kehjistan"],
      ["2026-10-16T05:00:00Z", "Hawezar"],
      ["2026-10-17T04:00:00Z", "Dry Steppes"],
      ["2026-10-17T05:00:00Z", "Kehjistan"],
      ["2026-10-17T06:00:00Z", "Hawezar"],
    ];
    for (const [t, zone] of seen) expect(predictHelltideZone(at(t)), t).toBe(zone);
  });

  it("no guess before the current cycle began", () => {
    expect(predictHelltideZone(at("2026-04-01T00:00:00Z"))).toBeUndefined();
  });
});
