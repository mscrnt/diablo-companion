// DiabloFilter search proxy: the pure parts (parameter checks, cache key, response shaping), unit tested.
// Agreement with DiabloFilter (2026-10-11): filter CODES stay on their site. We pass on title, class,
// season, author and the filter page link only, cache up to an hour, and credit the author.

export const CLASSES = ["barbarian", "druid", "necromancer", "paladin", "rogue", "sorcerer", "spiritborn", "warlock", "all"] as const;
export const SORTS = ["newest", "updated", "popular"] as const;

export interface FilterQuery {
  q?: string;
  class?: (typeof CLASSES)[number];
  season?: number;
  sort: (typeof SORTS)[number];
  page: number;
  perPage: number;
}

export type Parsed = { ok: true; value: FilterQuery } | { ok: false; error: string };

/** Validate the app's query string. Anything unexpected is rejected, so the upstream only sees clean requests. */
export function parseQuery(params: URLSearchParams): Parsed {
  const known = new Set(["q", "class", "season", "sort", "page", "per_page"]);
  for (const k of params.keys()) if (!known.has(k)) return { ok: false, error: `unknown parameter: ${k}` };
  const q = (params.get("q") ?? "").trim().replace(/\s+/g, " ");
  if (q.length > 80) return { ok: false, error: "search text is too long" };
  // letters, digits and a little punctuation (titles like "Heartseeker Endgame", "T4 Pit farm")
  if (q && !/^[\p{L}\p{N} '’&+.\-]+$/u.test(q)) return { ok: false, error: "search text has unsupported characters" };
  const cls = params.get("class")?.toLowerCase();
  if (cls && !(CLASSES as readonly string[]).includes(cls)) return { ok: false, error: "unknown class" };
  const seasonRaw = params.get("season");
  const season = seasonRaw ? Number(seasonRaw) : undefined;
  if (seasonRaw && (!Number.isInteger(season) || season! < 1 || season! > 99)) return { ok: false, error: "bad season" };
  const sort = (params.get("sort") ?? "newest").toLowerCase();
  if (!(SORTS as readonly string[]).includes(sort)) return { ok: false, error: "unknown sort" };
  const page = Number(params.get("page") ?? 1);
  if (!Number.isInteger(page) || page < 1 || page > 50) return { ok: false, error: "bad page" };
  const perPage = Number(params.get("per_page") ?? 20);
  if (!Number.isInteger(perPage) || perPage < 1 || perPage > 50) return { ok: false, error: "bad per_page" };
  return { ok: true, value: { q: q ? q.toLowerCase() : undefined, class: cls as FilterQuery["class"], season, sort: sort as FilterQuery["sort"], page, perPage } };
}

/** The upstream request URL, with parameters in a fixed order (also used as the cache key). */
export function upstreamUrl(base: string, f: FilterQuery): string {
  const p = new URLSearchParams();
  if (f.q) p.set("q", f.q);
  if (f.class) p.set("class", f.class);
  if (f.season) p.set("season", String(f.season));
  p.set("game", "d4");
  p.set("sort", f.sort);
  p.set("page", String(f.page));
  p.set("per_page", String(f.perPage));
  return `${base}?${p.toString()}`;
}

export interface FilterOut {
  id: number;
  title: string;
  class: string;
  season: number | null;
  author: { name: string; url: string | null };
  url: string;
  updatedAt: string | null;
}

export interface SearchOut {
  filters: FilterOut[];
  page: number;
  totalPages: number;
  hasMore: boolean;
  source: { name: "DiabloFilter.com"; url: "https://diablofilter.com" };
}

const str = (v: unknown, max = 200): string | null => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const onSite = (v: unknown): string | null => {
  const s = str(v, 300);
  return s && /^https:\/\/diablofilter\.com\//.test(s) ? s : null;
};

/**
 * Keep only the fields we agreed to show, from a successful upstream response. Unknown fields (anything
 * that could ever carry a filter code) are dropped; a filter without a title, author or page link is skipped.
 */
export function shape(body: unknown): SearchOut | null {
  if (!body || typeof body !== "object" || (body as { success?: unknown }).success !== true) return null;
  const b = body as { data?: unknown; pagination?: Record<string, unknown> };
  const rows = Array.isArray(b.data) ? b.data : [];
  const filters: FilterOut[] = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    const x = r as Record<string, unknown>;
    const author = (x.author ?? {}) as Record<string, unknown>;
    const title = str(x.title);
    const name = str(author.name) ?? str(author.username);
    const url = onSite(x.url);
    if (typeof x.id !== "number" || !title || !name || !url) continue;
    filters.push({
      id: x.id,
      title,
      class: str(x.class, 20) ?? "all",
      season: typeof x.season === "number" ? x.season : null,
      author: { name, url: onSite(author.url) },
      url,
      updatedAt: str(x.updated_at, 40),
    });
  }
  const pg = b.pagination ?? {};
  return {
    filters,
    page: typeof pg.page === "number" ? pg.page : 1,
    totalPages: typeof pg.total_pages === "number" ? pg.total_pages : 1,
    hasMore: pg.has_more === true,
    source: { name: "DiabloFilter.com", url: "https://diablofilter.com" },
  };
}
