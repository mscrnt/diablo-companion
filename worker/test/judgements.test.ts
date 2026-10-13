import { describe, expect, it } from "vitest";
import { MAX_ITEMS, batchKey, deleteIssue, deleteKey, isInstallId, parseBatch } from "../src/judgements";

const NOW = Date.parse("2026-10-13T12:00:00Z");
const INSTALL = "3f6c2a1e-8b4d-4c5e-9a7f-1b2c3d4e5f60";
const ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d";
const JPEG = "/9j/4AAQSkZJRgABAQ==";
const judgement = (over: Record<string, unknown> = {}) => ({ kind: "judgement", id: ID, at: NOW - 60_000, data: { verdict: "SELL" }, ...over });
const batch = (over: Record<string, unknown> = {}) => ({ v: 1, install: INSTALL, version: "0.2.4", os: "windows-11", items: [judgement()], ...over });

describe("judgement batches", () => {
  it("accepts what the app sends", () => {
    const r = parseBatch(batch({ items: [judgement({ images: { tooltip: JPEG, equipped: JPEG } }), { kind: "feedback", id: ID, at: NOW, signal: "wrong", note: "it's a seal" }] }), NOW);
    expect(r).toMatchObject({ ok: true, value: { install: INSTALL, version: "0.2.4", os: "windows-11" } });
    if (r.ok) expect(r.value.items.map((i) => i.kind)).toEqual(["judgement", "feedback"]);
  });

  it("keeps only the fields it knows", () => {
    const r = parseBatch(batch({ items: [judgement({ extra: "x", ip: "1.2.3.4" })], battletag: "Someone#1234" }), NOW);
    expect(r.ok && JSON.stringify(r.value)).not.toMatch(/Someone|1\.2\.3\.4|extra/);
  });

  it("rejects anything else", () => {
    const cases: unknown[] = [
      null,
      [],
      batch({ v: 2 }),
      batch({ install: "not-a-uuid" }),
      batch({ install: INSTALL.toUpperCase() }),
      batch({ version: "0.2" }),
      batch({ os: "linux" }),
      batch({ items: [] }),
      batch({ items: Array.from({ length: MAX_ITEMS + 1 }, judgement) }),
      batch({ items: [judgement({ id: "x" })] }),
      batch({ items: [judgement({ at: NOW + 2 * 86_400_000 })] }),
      batch({ items: [judgement({ at: NOW - 8 * 86_400_000 })] }),
      batch({ items: [judgement({ data: "text" })] }),
      batch({ items: [judgement({ data: { big: "x".repeat(70_000) } })] }),
      batch({ items: [judgement({ images: { tooltip: "iVBORw0KGgo=" } })] }), // a png
      batch({ items: [judgement({ images: { screenshot: JPEG } })] }),
      batch({ items: [judgement({ images: { tooltip: "/9j/" + "A".repeat(410_000) } })] }),
      batch({ items: [{ kind: "feedback", id: ID, at: NOW, signal: "meh" }] }),
      batch({ items: [{ kind: "feedback", id: ID, at: NOW, signal: "wrong", note: "x".repeat(301) }] }),
      batch({ items: [{ kind: "other", id: ID, at: NOW }] }),
    ];
    for (const c of cases) expect(parseBatch(c, NOW).ok, JSON.stringify(c).slice(0, 120)).toBe(false);
  });

  it("install ids are random v4 UUIDs", () => {
    expect(isInstallId(INSTALL)).toBe(true);
    expect(isInstallId("00000000-0000-0000-0000-000000000000")).toBe(false);
  });
});

describe("where batches go", () => {
  it("one folder per install a day, under the report prefix", () => {
    expect(batchKey("debug/", INSTALL, "01ABC", new Date(NOW))).toBe(`debug/judgements/2026-10-13/${INSTALL}/01ABC.json`);
    expect(deleteKey("debug", INSTALL)).toBe(`debug/judgements-deleted/${INSTALL}.json`);
  });

  it("a delete request lists the commands that remove that install's batches", () => {
    const { title, body } = deleteIssue(INSTALL, "debug/", "d4-companion", new Date(NOW));
    expect(title).toContain(INSTALL);
    expect(body).toContain(`c.list_objects("d4-companion", prefix="debug/judgements/", recursive=True) if "/${INSTALL}/" in o.object_name`);
    expect(body).toContain("remove_object");
    expect(body).not.toMatch(/key="[A-Za-z0-9]{8,}"/);
  });
});
