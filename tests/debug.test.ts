// Debug system: the pure parts (event ring, file rotation and pruning, truncation, redaction).
import { describe, expect, it } from "vitest";
import {
  EventRing,
  REDACTED,
  cssToScreen,
  currentPart,
  eventLine,
  eventsFileKey,
  eventsFileName,
  issueUrl,
  markStamp,
  planEventsPrune,
  planMarksPrune,
  redactSettings,
  scrub,
  secretValues,
  splitBudget,
  truncate,
} from "../src/lib/debugcore";
import { defaultSettings, freeNewBinding } from "../src/lib/store";

const MB = 1024 * 1024;

describe("event ring", () => {
  it("keeps only the last window of events", () => {
    const r = new EventRing(90_000, 1000);
    for (let t = 0; t <= 200_000; t += 1000) r.push({ ts: t, src: "a", type: "tick" });
    const all = r.all(200_000);
    expect(all[0].ts).toBe(110_000);
    expect(all[all.length - 1].ts).toBe(200_000);
    expect(r.size).toBe(91);
  });

  it("caps the count and stays in order across compaction", () => {
    const r = new EventRing(1e9, 100);
    for (let i = 0; i < 5000; i++) r.push({ ts: i, src: "a", type: String(i) });
    const all = r.all(5000);
    expect(all).toHaveLength(100);
    expect(all.map((e) => e.ts)).toEqual(Array.from({ length: 100 }, (_, i) => 4900 + i));
  });

  it("returns events since a time", () => {
    const r = new EventRing();
    [1000, 2000, 3000].forEach((ts) => r.push({ ts, src: "a", type: "x" }));
    expect(r.since(2000).map((e) => e.ts)).toEqual([2000, 3000]);
  });
});

describe("event files", () => {
  const d = new Date(2026, 9, 10, 14, 3, 22, 7);

  it("names files by local day and part", () => {
    expect(eventsFileName(d)).toBe("events-2026-10-10.jsonl");
    expect(eventsFileName(d, 2)).toBe("events-2026-10-10.2.jsonl");
    expect(eventsFileKey("events-2026-10-10.2.jsonl")).toEqual(["2026-10-10", 2]);
    expect(eventsFileKey("state.json")).toBeNull();
  });

  it("continues today's newest part, or starts the next when it's full", () => {
    const files = [
      { name: "events-2026-10-09.jsonl", size: 9 * MB },
      { name: "events-2026-10-10.jsonl", size: 8 * MB },
      { name: "events-2026-10-10.1.jsonl", size: 3 * MB },
    ];
    expect(currentPart(files, "2026-10-10", 8 * MB)).toEqual({ part: 1, size: 3 * MB });
    expect(currentPart([...files, { name: "events-2026-10-10.1.jsonl", size: 8 * MB }].slice(1), "2026-10-10", 8 * MB).part).toBe(2);
    expect(currentPart(files, "2026-10-11")).toEqual({ part: 0, size: 0 });
  });

  it("prunes the oldest files to fit the budget, never the newest", () => {
    const files = [
      { name: "events-2026-10-10.1.jsonl", size: 4 * MB },
      { name: "events-2026-10-08.jsonl", size: 4 * MB },
      { name: "events-2026-10-10.jsonl", size: 4 * MB },
      { name: "events-2026-10-09.jsonl", size: 4 * MB },
      { name: "state.json", size: 1 * MB },
    ];
    expect(planEventsPrune(files, 9 * MB)).toEqual(["events-2026-10-08.jsonl", "events-2026-10-09.jsonl"]);
    expect(planEventsPrune(files, 100 * MB)).toEqual([]);
    expect(planEventsPrune([{ name: "events-2026-10-10.jsonl", size: 50 * MB }], 1 * MB)).toEqual([]);
  });

  it("splits test mode's budget between events and frames", () => {
    expect(splitBudget(500)).toEqual({ eventsMB: 50, framesMB: 450 });
    expect(splitBudget(200)).toEqual({ eventsMB: 20, framesMB: 180 });
    expect(splitBudget(50).eventsMB).toBe(10);
    expect(splitBudget(5000).eventsMB).toBe(100);
  });

  it("keeps the newest marks", () => {
    const names = Array.from({ length: 33 }, (_, i) => markStamp(new Date(2026, 9, 10, 12, 0, i)));
    const old = planMarksPrune([...names].reverse(), 30);
    expect(old).toEqual(names.slice(0, 3));
    expect(markStamp(d)).toBe("2026-10-10T14-03-22-007");
  });
});

describe("truncation", () => {
  it("shortens strings and arrays and drops images", () => {
    const t = truncate(
      { text: "x".repeat(500), lines: Array.from({ length: 40 }, (_, i) => i), image: "A".repeat(5000), url: "data:image/jpeg;base64,AAAA", fn: () => 1, n: 1 / 3 },
      { str: 100, arr: 5 },
    ) as Record<string, unknown>;
    expect(String(t.text)).toMatch(/^x{100}… \[500 chars\]$/);
    expect(t.lines).toEqual([0, 1, 2, 3, 4, "… +35 more"]);
    expect(t.image).toBe("[image 5000 chars]");
    expect(t.url).toMatch(/^\[image/);
    expect("fn" in t).toBe(false);
    expect(t.n).toBe(0.333);
  });

  it("stops at a depth and keeps errors readable", () => {
    expect(truncate({ a: { b: { c: { d: 1 } } } }, { depth: 2 })).toEqual({ a: { b: "[object]" } });
    const e = truncate(new Error("boom")) as Record<string, unknown>;
    expect(e.message).toBe("boom");
  });

  it("produces JSON that round-trips", () => {
    const v = truncate({ a: [1, "two", null, { b: true }], c: NaN });
    expect(JSON.parse(JSON.stringify(v))).toEqual({ a: [1, "two", null, { b: true }], c: "NaN" });
  });
});

describe("secrets", () => {
  const s = structuredClone(defaultSettings);
  s.llm.apiKey = "sk-live-123456789";
  s.llm.baseUrl = "http://192.168.1.20:8000/v1";
  s.alerts.discordWebhook = "https://discord.com/api/webhooks/123/abcDEF";
  s.obs.password = "hunter22";

  it("redacts the settings secrets and keeps the rest", () => {
    const r = redactSettings(s);
    expect(r.llm.apiKey).toBe(REDACTED);
    expect(r.llm.baseUrl).toBe(REDACTED);
    expect(r.alerts.discordWebhook).toBe(REDACTED);
    expect(r.obs.password).toBe(REDACTED);
    expect(r.llm.model).toBe(s.llm.model);
    expect(r.hotkeys).toEqual(s.hotkeys);
    // the original is untouched
    expect(s.obs.password).toBe("hunter22");
    const text = JSON.stringify(r);
    for (const v of ["sk-live-123456789", "192.168.1.20", "abcDEF", "hunter22"]) expect(text).not.toContain(v);
  });

  it("leaves unset secrets empty", () => {
    const r = redactSettings(defaultSettings);
    expect(r.llm.apiKey).toBe("");
    expect(r.alerts.discordWebhook).toBe("");
  });

  it("scrubs secret values, webhooks and bearer tokens from free text", () => {
    const sec = secretValues(s);
    const msg = 'POST https://discordapp.com/api/webhooks/999/xyz failed; Authorization: Bearer sk-live-123456789; obs "hunter22"';
    const out = scrub(msg, sec);
    expect(out).not.toMatch(/xyz|sk-live|hunter22/);
    expect(out).toContain("[discord-webhook]");
  });

  it("scrubs event lines", () => {
    const line = eventLine({ ts: Date.UTC(2026, 9, 10), src: "error", type: "console.warn", data: { msg: "discord webhook failed https://discord.com/api/webhooks/123/abcDEF" } }, secretValues(s));
    expect(line).not.toContain("abcDEF");
    expect(JSON.parse(line)).toMatchObject({ ts: "2026-10-10T00:00:00.000Z", src: "error", type: "console.warn" });
  });
});

describe("overlay coordinates", () => {
  it("maps overlay CSS px to screen px through the origin and DPI scale", () => {
    expect(cssToScreen({ x: 100, y: 50, w: 300, h: 120 }, [2560, 0], 1.5)).toEqual({ x: 2710, y: 75, w: 450, h: 180 });
  });
});

describe("issue link", () => {
  it("pre-fills a GitHub issue without uploading anything", () => {
    const u = new URL(issueUrl({ version: "0.2.0", zipName: "sanctuary-debug-x.zip", included: ["state", "events"] }));
    expect(u.origin + u.pathname).toBe("https://github.com/mscrnt/diablo-companion/issues/new");
    expect(u.searchParams.get("body")).toContain("sanctuary-debug-x.zip");
    expect(u.searchParams.get("body")).toContain("v0.2.0");
  });

  it("after sending, names the report ID instead of asking for the zip", () => {
    const body = new URL(issueUrl({ version: "0.2.0", reportId: "01K7ABCDEF", included: ["state"] })).searchParams.get("body")!;
    expect(body).toContain("Report ID: `01K7ABCDEF`");
    expect(body).not.toMatch(/drag/i);
  });
});

describe("mark-moment binding", () => {
  it("defaults to a key and chord no other action uses", () => {
    const { hotkeys, padChords } = defaultSettings;
    expect(hotkeys.markMoment).toBeTruthy();
    expect(Object.entries(hotkeys).filter(([, k]) => k === hotkeys.markMoment)).toHaveLength(1);
    const key = (c: string[]) => [...c].sort().join("+");
    expect(Object.values(padChords).filter((c) => c.length && key(c) === key(padChords.markMoment))).toHaveLength(1);
  });

  it("starts unbound when an update's default collides with the user's own binding", () => {
    const m = structuredClone(defaultSettings);
    m.hotkeys.clip = m.hotkeys.markMoment;
    m.padChords.clip = [...m.padChords.markMoment];
    const out = freeNewBinding(m, { hotkeys: { clip: m.hotkeys.clip }, padChords: { clip: m.padChords.clip } }, "markMoment");
    expect(out.hotkeys.markMoment).toBe("");
    expect(out.padChords.markMoment).toEqual([]);
    // a fresh install (nothing persisted) keeps the defaults
    expect(freeNewBinding(structuredClone(defaultSettings), undefined, "markMoment").hotkeys.markMoment).toBe(defaultSettings.hotkeys.markMoment);
  });
});
