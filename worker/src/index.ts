// Sanctuary Toolkit debug-report upload. The app POSTs a zip here; this Worker validates it and writes
// it to MinIO with an upload-only key that lives in the Cloudflare Secrets Store. The app never holds
// storage credentials. Optionally (flag, off by default) it opens a GitHub issue for the report and, in a
// private repo, attaches the zip to that day's release; a daily cron deletes releases after KEEP_DAYS.
import { AwsClient } from "aws4fetch";
import { batchKey, deleteIssue, deleteKey, isInstallId, parseBatch } from "./judgements";
import { checkSize, deleteOn, expiredReleaseTags, isZip, issueFor, objectKey, parseMeta, releaseTag, ulid, type ReportMeta } from "./validate";

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
  /** "on": attach each zip to a daily release in the (private) repo, deleted after KEEP_DAYS */
  GITHUB_ZIPS: string;
  KEEP_DAYS: string;
  S3_ACCESS_KEY: SecretsStoreSecret;
  S3_SECRET_KEY: SecretsStoreSecret;
  /** only bound once the token exists in the Secrets Store (see wrangler.toml) */
  GITHUB_TOKEN?: SecretsStoreSecret;
  /** per-IP burst limit (Workers Rate Limiting) */
  BURST: RateLimit;
  /** hourly per-IP and daily counters */
  COUNTERS: KVNamespace;
  /** shared judgements: per-IP burst limit (no KV: batches come every few minutes from every player) */
  JUDGE_BURST: RateLimit;
  /** shared judgements: largest batch in bytes */
  JUDGE_MAX_BYTES: string;
  /** label for "delete my data" issues (must exist in the repo) */
  GITHUB_DELETE_LABELS: string;
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
    if (url.pathname !== "/report" && url.pathname !== "/judgements" && url.pathname !== "/judgements/delete") return fail(404, "not found");
    if (req.method !== "POST") return fail(405, "use POST");

    const ip = req.headers.get("cf-connecting-ip") ?? "unknown";
    const who = await ipHash(ip, env.IP_SALT);
    if (url.pathname === "/judgements") return judgements(req, env, who);
    if (url.pathname === "/judgements/delete") return deleteJudgements(req, env, ctx, who);
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
    if (env.GITHUB_ISSUES === "on" && env.GITHUB_TOKEN) ctx.waitUntil(openIssue(env, id, meta.value, body, key, day, now).catch((e) => console.log("issue failed", String(e))));

    return json(201, { id });
  },

  async scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(cleanUp(env).catch((e) => console.log("cleanup failed", String(e))));
  },
};

const storage = async (env: Env) =>
  new AwsClient({ accessKeyId: await env.S3_ACCESS_KEY.get(), secretAccessKey: await env.S3_SECRET_KEY.get(), service: "s3", region: env.S3_REGION });
const objectUrl = (env: Env, key: string) => `${env.S3_ENDPOINT.replace(/\/$/, "")}/${env.S3_BUCKET}/${key}`;

/** A JSON body up to `max` bytes, or the response that refuses it. */
async function readJson(req: Request, max: number): Promise<{ ok: true; value: unknown } | { ok: false; res: Response }> {
  if ((req.headers.get("content-type") ?? "").split(";")[0].trim() !== "application/json") return { ok: false, res: fail(415, "send JSON") };
  const declared = checkSize(req.headers.get("content-length"), max);
  if (!declared.ok) return { ok: false, res: fail(declared.status, declared.error) };
  const text = await req.text();
  if (text.length > max) return { ok: false, res: fail(413, "too large") };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch {
    return { ok: false, res: fail(400, "not JSON") };
  }
}

/** POST /judgements: one batch of shared judgements from a player who opted in, stored as one object. */
async function judgements(req: Request, env: Env, who: string): Promise<Response> {
  if (!(await env.JUDGE_BURST.limit({ key: who })).success) return fail(429, "too many batches, try again in a minute");
  const body = await readJson(req, Number(env.JUDGE_MAX_BYTES) || 8 * 1024 * 1024);
  if (!body.ok) return body.res;
  const now = new Date();
  const batch = parseBatch(body.value, now.getTime());
  if (!batch.ok) return fail(batch.status, batch.error);
  const id = ulid(now.getTime());
  const key = batchKey(env.S3_PREFIX, batch.value.install, id, now);
  const put = await (await storage(env)).fetch(objectUrl(env, key), {
    method: "PUT",
    body: JSON.stringify({ receivedAt: now.toISOString(), ...batch.value }),
    headers: { "content-type": "application/json", "user-agent": UA, "x-amz-meta-app-version": batch.value.version },
  });
  if (!put.ok) {
    console.log("judgement write failed", put.status, (await put.text()).slice(0, 300));
    return fail(502, "couldn't store the batch, try again later");
  }
  return json(201, { id, items: batch.value.items.length });
}

/**
 * POST /judgements/delete `{ v: 1, install }`: "delete my data". The storage key can only write, so this leaves a
 * marker and opens a private issue with the commands that delete that install's batches.
 */
async function deleteJudgements(req: Request, env: Env, ctx: ExecutionContext, who: string): Promise<Response> {
  if (!(await env.BURST.limit({ key: who })).success) return fail(429, "too many requests, try again in a minute");
  const body = await readJson(req, 1024);
  if (!body.ok) return body.res;
  const install = (body.value as { install?: unknown } | null)?.install;
  if (!isInstallId(install)) return fail(400, "bad install id");
  const now = new Date();
  const put = await (await storage(env)).fetch(objectUrl(env, deleteKey(env.S3_PREFIX, install)), {
    method: "PUT",
    body: JSON.stringify({ install, requestedAt: now.toISOString() }),
    headers: { "content-type": "application/json", "user-agent": UA },
  });
  if (!put.ok) return fail(502, "couldn't record the request, try again later");
  if (env.GITHUB_TOKEN && env.GITHUB_REPO_PRIVATE === "true")
    ctx.waitUntil(
      (async () => {
        const token = await env.GITHUB_TOKEN!.get();
        const { title, body: text } = deleteIssue(install, env.S3_PREFIX, env.S3_BUCKET, now);
        const labels = (env.GITHUB_DELETE_LABELS ?? "").split(",").map((l) => l.trim()).filter(Boolean);
        const res = await gh(env, token, "/issues", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ title, body: text, ...(labels.length ? { labels } : {}) }) });
        if (!res.ok) console.log("delete issue failed", res.status, (await res.text()).slice(0, 300));
      })().catch((e) => console.log("delete issue failed", String(e))),
    );
  return json(202, { ok: true });
}

/** A GitHub API call with the Worker's token. `path` is relative to the repo unless it's a full URL. */
function gh(env: Env, token: string, path: string, init: RequestInit = {}): Promise<Response> {
  const url = /^https:/.test(path) ? path : `https://api.github.com/repos/${env.GITHUB_REPO}${path}`;
  return fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/vnd.github+json",
      "x-github-api-version": "2022-11-28",
      "user-agent": UA,
      ...(init.headers as Record<string, string> | undefined),
    },
  });
}

const keepDays = (env: Env) => Number(env.KEEP_DAYS) || 30;
/** Zips only ever go to a private repo, and only with the flag on. */
const zipsOn = (env: Env) => env.GITHUB_ZIPS === "on" && env.GITHUB_REPO_PRIVATE === "true";

/** That day's release (a pre-release tagged reports-YYYY-MM-DD), created on the day's first report. */
async function dayRelease(env: Env, token: string, day: string): Promise<{ id: number }> {
  const tag = releaseTag(day);
  for (let attempt = 0; attempt < 2; attempt++) {
    const got = await gh(env, token, `/releases/tags/${tag}`);
    if (got.ok) return (await got.json()) as { id: number };
    const made = await gh(env, token, "/releases", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        tag_name: tag,
        target_commitish: "main",
        name: `Reports ${day}`,
        body: `Debug report zips received on ${day} (UTC). This release and its files are deleted on ${deleteOn(day, keepDays(env))}.`,
        prerelease: true,
      }),
    });
    if (made.ok) return (await made.json()) as { id: number };
    // another report created it at the same moment: read it again
    if (made.status !== 422) throw new Error(`release create failed ${made.status} ${(await made.text()).slice(0, 200)}`);
  }
  throw new Error("release not found after create");
}

/** Attach the report's zip to its day's release; the link for the issue. */
async function attachZip(env: Env, token: string, id: string, day: string, zip: Uint8Array): Promise<{ url: string; until: string }> {
  const rel = await dayRelease(env, token, day);
  const up = await gh(env, token, `https://uploads.github.com/repos/${env.GITHUB_REPO}/releases/${rel.id}/assets?name=${id}.zip`, {
    method: "POST",
    headers: { "content-type": "application/zip" },
    body: zip,
  });
  if (!up.ok) throw new Error(`asset upload failed ${up.status} ${(await up.text()).slice(0, 200)}`);
  const asset = (await up.json()) as { browser_download_url: string };
  return { url: asset.browser_download_url, until: deleteOn(day, keepDays(env)) };
}

async function openIssue(env: Env, id: string, meta: ReportMeta, zip: Uint8Array, key: string, day: string, at: Date): Promise<void> {
  if (!(await bump(env.COUNTERS, `gh:${day}`, Number(env.GITHUB_DAILY_CAP), 2 * 86400))) return;
  const token = await env.GITHUB_TOKEN!.get();
  // a failed upload still opens the issue (the zip is safe in storage either way)
  const download = zipsOn(env) ? await attachZip(env, token, id, day, zip).catch((e) => void console.log("zip upload failed", String(e))) : undefined;
  const { title, body } = issueFor(id, meta, zip.byteLength, key, env.GITHUB_REPO_PRIVATE === "true", at, download ?? undefined);
  const labels = env.GITHUB_LABELS.split(",").map((l) => l.trim()).filter(Boolean);
  const res = await gh(env, token, "/issues", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ title, body, ...(labels.length ? { labels } : {}) }),
  });
  if (!res.ok) console.log("github issue failed", res.status, (await res.text()).slice(0, 300));
}

/** Daily: delete each day's release (and its zips and tag) once it's `KEEP_DAYS` old, matching storage. */
async function cleanUp(env: Env): Promise<void> {
  if (!zipsOn(env) || !env.GITHUB_TOKEN) return;
  const token = await env.GITHUB_TOKEN.get();
  const releases: { id: number; tag_name: string }[] = [];
  for (let page = 1; page <= 5; page++) {
    const res = await gh(env, token, `/releases?per_page=100&page=${page}`);
    if (!res.ok) throw new Error(`release list failed ${res.status}`);
    const batch = (await res.json()) as { id: number; tag_name: string }[];
    releases.push(...batch);
    if (batch.length < 100) break;
  }
  const expired = new Set(expiredReleaseTags(releases.map((r) => r.tag_name), new Date(), keepDays(env)));
  for (const r of releases.filter((x) => expired.has(x.tag_name))) {
    const del = await gh(env, token, `/releases/${r.id}`, { method: "DELETE" });
    if (!del.ok && del.status !== 404) console.log("release delete failed", r.tag_name, del.status);
    const ref = await gh(env, token, `/git/refs/tags/${r.tag_name}`, { method: "DELETE" });
    if (!ref.ok && ref.status !== 404 && ref.status !== 422) console.log("tag delete failed", r.tag_name, ref.status);
  }
  if (expired.size) console.log("deleted report releases", [...expired].join(", "));
}
