import { describe, expect, it } from "vitest";
import { jobsFor, parseSchedule, recordKey } from "../src/events";

// the shape of helltides.com/schedule's __NUXT_DATA__ (a flat devalue array), with made-up content
const payload = [
  ["ShallowReactive", 1],
  { data: 2 },
  ["Reactive", 3],
  { schedule: 4 },
  { world_boss: 5, legion: 14, helltide: 15 },
  [6, 11],
  { id: 7, boss: 8, type: 9, startTime: 10, zone: 12 },
  1792222200,
  "Wandering Death",
  "world_boss",
  "2026-10-17T07:30:00.000Z",
  { id: 7, boss: 8, type: 9, startTime: 16, zone: 17 },
  [13],
  { id: "scosglen", name: "Scosglen", isWhisper: false, boss: 8 },
  [],
  [],
  "2026-10-17T11:00:00.000Z",
  [18, 19],
  { id: "kehjistan", name: "Kehjistan", isWhisper: false },
  { id: "nahantu", name: "Nahantu", isWhisper: true },
];
const html = `<html><body><script type="application/json" data-nuxt-data="nuxt-app" id="__NUXT_DATA__">${JSON.stringify(payload)}</script></body></html>`;

describe("helltides schedule page", () => {
  it("reads the upcoming world bosses with their zones", () => {
    expect(parseSchedule(html)).toEqual([
      { start: "2026-10-17T07:30:00.000Z", boss: "Wandering Death", zones: [{ id: "scosglen", name: "Scosglen", whisper: false }] },
      {
        start: "2026-10-17T11:00:00.000Z",
        boss: "Wandering Death",
        zones: [
          { id: "kehjistan", name: "Kehjistan", whisper: false },
          { id: "nahantu", name: "Nahantu", whisper: true },
        ],
      },
    ]);
  });

  it("says so when the page changes shape", () => {
    expect(() => parseSchedule("<html></html>")).toThrow(/__NUXT_DATA__/);
    expect(() => parseSchedule(`<script id="__NUXT_DATA__">[{"x":1},2]</script>`)).toThrow(/world_boss/);
  });
});

describe("recordings", () => {
  it("one object per read, by UTC day and time, under the research prefix", () => {
    expect(recordKey("research/events/", "current", new Date("2026-10-17T06:05:09Z"))).toBe("research/events/2026-10-17/0605-current.json");
    expect(recordKey("research/events", "schedule", new Date("2026-10-17T23:59:00Z"))).toBe("research/events/2026-10-17/2359-schedule.json");
  });

  it("hourly current reads, the schedule every 6 hours, nothing for other crons", () => {
    expect(jobsFor("5 * * * *", new Date("2026-10-17T06:05:00Z"))).toEqual({ current: true, schedule: true });
    expect(jobsFor("5 * * * *", new Date("2026-10-17T07:05:00Z"))).toEqual({ current: true, schedule: false });
    expect(jobsFor("23 9 * * *", new Date("2026-10-17T09:23:00Z"))).toEqual({ current: false, schedule: false });
  });
});
