import { describe, expect, it } from "vitest";
import { parseQuery, shape, upstreamUrl } from "../src/filters-core";

const P = (s: string) => new URLSearchParams(s);

describe("filter search parameters", () => {
  it("accepts what the app sends, with defaults", () => {
    expect(parseQuery(P("class=Rogue&season=15&sort=popular&q=Heartseeker  Endgame"))).toEqual({
      ok: true,
      value: { q: "heartseeker endgame", class: "rogue", season: 15, sort: "popular", page: 1, perPage: 20 },
    });
    expect(parseQuery(P(""))).toMatchObject({ ok: true, value: { sort: "newest", page: 1, perPage: 20 } });
    expect(parseQuery(P("class=all")).ok).toBe(true);
  });
  it("rejects anything else", () => {
    for (const s of ["class=wizard", "season=0", "season=abc", "sort=random", "page=0", "page=51", "per_page=100", "game=d2r", "q=" + "x".repeat(81), "q=<script>", "api_key=x"])
      expect(parseQuery(P(s)).ok, s).toBe(false);
  });
  it("builds one upstream URL per search, always for Diablo IV", () => {
    const a = parseQuery(P("season=15&class=rogue&sort=popular"));
    const b = parseQuery(P("sort=popular&class=rogue&season=15"));
    if (!a.ok || !b.ok) throw new Error("parse");
    expect(upstreamUrl("https://diablofilter.com/api/v1/filters.php", a.value)).toBe("https://diablofilter.com/api/v1/filters.php?class=rogue&season=15&game=d4&sort=popular&page=1&per_page=20");
    expect(upstreamUrl("u", a.value)).toBe(upstreamUrl("u", b.value));
  });
});

describe("response shaping", () => {
  const upstream = {
    success: true,
    data: [
      {
        id: 123,
        title: "Heartseeker Endgame",
        class: "rogue",
        season: 15,
        game: "d4",
        author: { name: "Example Creator", username: "examplecreator", url: "https://diablofilter.com/u/examplecreator" },
        url: "https://diablofilter.com/filter/heartseeker-endgame",
        created_at: "2026-10-01T18:22:05Z",
        updated_at: "2026-10-08T09:14:40Z",
        code: "SHOULD-NEVER-PASS-THROUGH",
      },
      { id: 124, title: "No link", author: { name: "X" } },
      { id: 125, title: "Off-site link", author: { name: "X" }, url: "https://evil.example/f" },
    ],
    pagination: { page: 1, per_page: 20, total: 3, total_pages: 1, has_more: false },
  };
  it("keeps only the agreed fields, never a code", () => {
    const out = shape(upstream)!;
    expect(out.filters).toEqual([
      {
        id: 123,
        title: "Heartseeker Endgame",
        class: "rogue",
        season: 15,
        author: { name: "Example Creator", url: "https://diablofilter.com/u/examplecreator" },
        url: "https://diablofilter.com/filter/heartseeker-endgame",
        updatedAt: "2026-10-08T09:14:40Z",
      },
    ]);
    expect(JSON.stringify(out)).not.toContain("SHOULD-NEVER-PASS-THROUGH");
    expect(out.source).toEqual({ name: "DiabloFilter.com", url: "https://diablofilter.com" });
  });
  it("treats an error body as no result", () => {
    expect(shape({ success: false, error: { code: "invalid_key" } })).toBeNull();
    expect(shape(null)).toBeNull();
  });
});
