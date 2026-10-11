// Sanctuary Toolkit debug-report upload. The app POSTs a zip here; this Worker validates it and writes
// it to MinIO with an upload-only key that lives in the Cloudflare Secrets Store. The app never holds
// storage credentials. Optionally (flag, off by default) it opens a GitHub issue for the report.
import { AwsClient } from "aws4fetch";
import { checkSize, isZip, issueFor, objectKey, parseMeta, ulid, type ReportMeta } from "./validate";

export interface Env {
  S3_ENDPOINT: string;
  S3_BUCKET: string;
  S3_PREFIX: string;
  S3_REGION: string;
  MAX_BYTES: string;
  PER_IP_PER_HOUR: string;
  DAILY_CAP: string;
  IP_SALT: string;
  GITHUB_ISSUES: string;
  GITHUB_REPO: string;
  GITHUB_REPO_PRIVATE: string;
  GITHUB_DAILY_CAP: string;
  GITHUB_LABELS: string;
  S3_ACCESS_KEY: SecretsStoreSecret;
  S3_SECRET_KEY: SecretsStoreSecret;
  /** only bound once the token exists in the Secrets Store (see wrangler.toml) */
  GITHUB_TOKEN?: SecretsStoreSecret;
  /** per-IP burst limit (Workers Rate Limiting) */
  BURST: RateLimit;
  /** hourly per-IP and daily counters */
  COUNTERS: KVNamespace;
}

// s3.mscrnt.com sits behind Cloudflare's Browser Integrity Check, which rejects requests without a real-looking UA
const UA = "Mozilla/5.0 (compatible; SanctuaryToolkit-ReportWorker/1.0; +https://github.com/mscrnt/diablo-companion)";

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const fail = (status: number, error: string) => json(status, { error });

async function ipHash(ip: string, salt: string): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(`${salt}:${ip}`));
  return [...new Uint8Array(d).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Read a counter, refuse if it's at the cap, otherwise bump it. KV is eventually consistent, so caps are approximate. */
async function bump(kv: KVNamespace, key: string, cap: number, ttl: number): Promise<boolean> {
  const n = Number((await kv.get(key)) ?? 0);
  if (n >= cap) return false;
  await kv.put(key, String(n + 1), { expirationTtl: ttl });
  return true;
}

export default {
  async fetch(req: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(req.url);
    if (url.pathname !== "/report") return fail(404, "not found");
    if (req.method !== "POST") return fail(405, "use POST");

    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const who = await ipHash(ip, env.IP_SALT);
    if (!(await env.BURST.limit({ key: who })).success) return fail(429, "too many reports, try again in a minute");

    const meta = parseMeta(req.headers.get("x-report-meta"));
    if (!meta.ok) return fail(meta.status, meta.error);
    if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/zip") return fail(415, "send the report as application/zip");
    const max = Number(env.MAX_BYTES);
    const declared = checkSize(req.headers.get("content-length"), max);
    if (!declared.ok) return fail(declared.status, declared.error);

    const body = new Uint8Array(await req.arrayBuffer());
    if (body.byteLength > max) return fail(413, `report is larger than ${Math.round(max / 1024 / 1024)} MB`);
    if (!isZip(body)) return fail(400, "not a zip file");

    // caps are counted for every valid attempt, so a failing upload can't be retried endlessly
    const now = new Date();
    const hour = now.toISOString().slice(0, 13);
    const day = now.toISOString().slice(0, 10);
    if (!(await bump(env.COUNTERS, `ip:${who}:${hour}`, Number(env.PER_IP_PER_HOUR), 3700))) return fail(429, "too many reports this hour, try again later");
    if (!(await bump(env.COUNTERS, `day:${day}`, Number(env.DAILY_CAP), 2 * 86400))) return fail(429, "the report service is full for today, try again tomorrow");

    const id = ulid(now.getTime());
    const key = objectKey(env.S3_PREFIX, id, now);
    const aws = new AwsClient({ accessKeyId: await env.S3_ACCESS_KEY.get(), secretAccessKey: await env.S3_SECRET_KEY.get(), service: "s3", region: env.S3_REGION });
    // path-style: https://s3.mscrnt.com/<bucket>/<key>
    const put = await aws.fetch(`${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`, {
      method: "PUT",
      body,
      headers: {
        "content-type": "application/zip",
        "user-agent": UA,
        "x-amz-meta-app-version": meta.value.version,
        "x-amz-meta-os": meta.value.os,
        "x-amz-meta-screenshots": String(meta.value.screenshots),
      },
    });
    if (!put.ok) {
      console.log("storage write failed", put.status, (await put.text()).slice(0, 300));
      return fail(502, "couldn't store the report, try again later");
    }

    // optional, after the report is safely stored; never delays or fails the upload
    if (env.GITHUB_ISSUES === "on" && env.GITHUB_TOKEN) ctx.waitUntil(openIssue(env, id, meta.value, body.byteLength, key, day).catch((e) => console.log("issue failed", String(e))));

    return json(201, { id });
  },
};

async function openIssue(env: Env, id: string, meta: ReportMeta, size: number, key: string, day: string): Promise<void> {
  if (!(await bump(env.COUNTERS, `gh:${day}`, Number(env.GITHUB_DAILY_CAP), 2 * 86400))) return;
  const token = await env.GITHUB_TOKEN!.get();
  const { title, body } = issueFor(id, meta, size, key, env.GITHUB_REPO_PRIVATE === "true");
  const labels = env.GITHUB_LABELS.split(",").map((l) => l.trim()).filter(Boolean);
  const res = await fetch(`https://api.github.com/repos/${env.GITHUB_REPO}/issues`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      "content-type": "application/json",
    },
    body: JSON.stringify({ title, body, ...(labels.length ? { labels } : {}) }),
  });
  if (!res.ok) console.log("github issue failed", res.status, (await res.text()).slice(0, 300));
}
