// Sanctuary Toolkit → DiabloFilter search proxy. The app calls GET /filters; this Worker holds the
// DiabloFilter API key (Secrets Store), caches each result page for up to an hour, and passes on only the
// fields DiabloFilter agreed we may show (no filter codes: players copy those from the filter page).
// No KV: limits come from rate-limit bindings, the cache, and backing off whenever DiabloFilter says 429.
import { parseQuery, shape, upstreamUrl } from "./filters-core";

export interface Env {
  DF_API_URL: string;
  CACHE_SECONDS: string;
  DIABLOFILTER_KEY: SecretsStoreSecret;
  /** uncached searches per IP (loose; the zone's WAF rule is the strict per-IP limit) */
  PER_IP: RateLimit;
  /** all uncached searches together, kept under DiabloFilter's per-minute limit */
  UPSTREAM: RateLimit;
}

const UA = "Mozilla/5.0 (compatible; SanctuaryToolkit-FilterWorker/1.0; +https://github.com/mscrnt/diablo-companion)";
const CACHE_HOST = "https://filters-cache.sanctuary.invalid";
const PAUSE_KEY = `${CACHE_HOST}/paused`;

const json = (status: number, body: unknown, extra: Record<string, string> = {}) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...extra } });
const fail = (status: number, error: string, extra: Record<string, string> = {}) => json(status, { error }, { "cache-control": "no-store", ...extra });

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/filters") return fail(404, "not found");
    if (req.method !== "GET") return fail(405, "use GET");
    const parsed = parseQuery(url.searchParams);
    if (!parsed.ok) return fail(400, parsed.error);

    const upstream = upstreamUrl(env.DF_API_URL, parsed.value);
    const cache = caches.default;
    const key = new Request(`${CACHE_HOST}/filters?${upstream.split("?")[1]}`);
    const hit = await cache.match(key);
    if (hit) return new Response(hit.body, { status: 200, headers: { "content-type": "application/json", "cache-control": "private, max-age=300", "x-cache": "HIT" } });

    // DiabloFilter told us to slow down: don't call them again until their Retry-After has passed
    const paused = await cache.match(PAUSE_KEY);
    if (paused) return fail(503, "filter search is busy, try again in a minute", { "retry-after": paused.headers.get("x-retry-after") ?? "60" });

    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    if (!(await env.PER_IP.limit({ key: ip })).success) return fail(429, "too many searches, try again in a minute", { "retry-after": "60" });
    if (!(await env.UPSTREAM.limit({ key: "diablofilter" })).success) return fail(503, "filter search is busy, try again in a minute", { "retry-after": "60" });

    const res = await fetch(upstream, { headers: { "x-api-key": await env.DIABLOFILTER_KEY.get(), accept: "application/json", "user-agent": UA } });
    if (res.status === 429) {
      const wait = Math.min(Math.max(Number(res.headers.get("retry-after")) || 60, 10), 3600);
      ctx.waitUntil(cache.put(PAUSE_KEY, new Response("paused", { headers: { "cache-control": `public, max-age=${wait}`, "x-retry-after": String(wait) } })));
      return fail(503, "filter search is busy, try again in a minute", { "retry-after": String(wait) });
    }
    if (res.status === 400) return fail(400, "DiabloFilter didn't accept that search");
    if (!res.ok) {
      console.log("diablofilter error", res.status, (await res.text()).slice(0, 200));
      return fail(502, "filter search is unavailable right now");
    }
    const out = shape(await res.json().catch(() => null));
    if (!out) return fail(502, "filter search is unavailable right now");

    const body = JSON.stringify(out);
    // our copy for up to an hour (DiabloFilter allows it); filters removed upstream drop out when it expires
    ctx.waitUntil(cache.put(key, new Response(body, { headers: { "content-type": "application/json", "cache-control": `public, max-age=${Number(env.CACHE_SECONDS) || 3600}` } })));
    return new Response(body, { status: 200, headers: { "content-type": "application/json", "cache-control": "private, max-age=300", "x-cache": "MISS" } });
  },
};
