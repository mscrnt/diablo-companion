# Sanctuary Toolkit Workers

Two small Cloudflare Workers live here, sharing one package. Debug-report upload (`wrangler.toml`) is below; the DiabloFilter search proxy (`wrangler.filters.toml`) has its own section at the end.

## Debug-report upload

When a player clicks **Send report**, the app POSTs the debug zip here. The Worker validates it and stores it in MinIO with an upload-only key from the Cloudflare Secrets Store. The app never holds storage credentials.

```
app ── POST /report (zip + X-Report-Meta) ──▶ Worker ── SigV4 PUT ──▶ s3.mscrnt.com/d4-companion/debug/<date>/<id>.zip
                                               │
                                               └─ optional: GitHub issue (flag, off by default)
```

## Request

`POST https://reports.mscrnt.com/report`

- `Content-Type: application/zip`, body = the zip (max 25 MB)
- `X-Report-Meta: {"version":"0.2.0","os":"windows-11","screenshots":false}`
  - `version` must be `x.y.z`, or a pre-release `x.y.z-alpha.N`, `-beta.N` or `-rc.N`
  - `os` must be one of `windows-10`, `windows-11`, `windows`

Response `201 {"id":"01K7…"}`. Errors return `{"error":"…"}` with:
- 400: bad metadata or not a zip
- 413: too big
- 415: wrong content type
- 429: rate limited
- 502: storage failed

The Worker checks, in order:
1. Per-IP burst limit: 2 per minute (Rate Limiting binding).
2. Metadata, content type, declared and actual size, and the zip magic bytes `PK\x03\x04`.
3. Per-IP 5 per hour and a global 300 per day (KV counters, approximate).
4. ID generated server-side (ULID); key `debug/<UTC date>/<id>.zip`.
5. Then the optional GitHub issue, after the write, capped at 20 per day.

IPs are only stored as salted hashes, in counters that expire within two days.

**Rate limits in front of the Worker:**
- A Cloudflare **WAF rule** on `reports.mscrnt.com` blocks more than 5 requests per 10 s per IP (429, `retry-after: 10`) before the Worker runs.
- The `BURST` binding is a loose extra guard. It counts per machine and syncs asynchronously, and in testing caught about 1 request in 15.
- The KV hourly and daily caps are the real per-IP limits. In testing, the 6th valid report in an hour was refused.

## Deployed

- `https://reports.mscrnt.com/report`, a custom domain. It's the **only** public way in: `workers_dev` and `preview_urls` are off, because those URLs would bypass the WAF rule.
- KV namespace `COUNTERS`: `f4aad7f13293465c9ba4178afacc2040`.
- Deploy by hand, or from CI on `main` only. Never from a `pull_request` or `pull_request_target` workflow: this repo is public.

## One-time setup

```sh
cd worker
npm install
npx wrangler login                          # opens the browser
npx wrangler kv namespace create COUNTERS   # paste the id into wrangler.toml
npx wrangler secret put IP_SALT             # any long random string
```

`wrangler dev --remote` doesn't work with the Secrets Store binding (the preview fails with an internal error). To test a change against the real bindings before it takes traffic:
1. Set `preview_urls = true` and run `npx wrangler versions upload`.
2. Test the preview URL: the first 8 characters of the version ID, then `-sanctuary-reports.kenneth-a89.workers.dev`.
3. Set `preview_urls = false` again and run `npm run deploy`.

Test with:

```sh
# a valid report
curl -s -X POST https://reports.mscrnt.com/report \
  -H "content-type: application/zip" \
  -H 'x-report-meta: {"version":"0.2.0","os":"windows-11","screenshots":false}' \
  --data-binary @some-debug-report.zip
# → {"id":"01K…"}; the object appears under d4-companion/debug/<date>/
```

Afterwards, delete the test keys from `COUNTERS` (`npx wrangler kv key list --namespace-id … --remote`, then `kv key delete`) so the hourly and daily caps aren't used up.

## Turning on GitHub issues

1. Create a fine-grained token in GitHub: one repository, **Issues: read and write**.
2. Add it to the Secrets Store `mscrnt` as `D4_COMPANION_GITHUB_TOKEN`, scoped to workers.
3. In `wrangler.toml`: uncomment the `GITHUB_TOKEN` binding, set `GITHUB_ISSUES = "on"`, `GITHUB_REPO`, and `GITHUB_REPO_PRIVATE`.
   - With `"false"` (public repo), the issue has only the report ID, version, OS and size.
4. `npm run deploy`.

## Rules

- Never commit credentials. The MinIO and GitHub keys live only in the Secrets Store, and `IP_SALT` is a Worker secret.
- The MinIO user can only `PutObject` under `d4-companion/debug/*`. If the Worker ever needs to read, use a separate key; don't widen this one.

## DiabloFilter search proxy (`wrangler.filters.toml`)

The app searches public DiabloFilter.com loot filters through this Worker. DiabloFilter agreed to it on 2026-10-11, and the API key lives only in the Secrets Store as `D4_COMPANION_DIABLOFILTER_KEY`.

`GET https://filters.mscrnt.com/filters?q=&class=&season=&sort=&page=&per_page=`

- **Parameters:** `class` is one of `barbarian`, `druid`, `necromancer`, `paladin`, `rogue`, `sorcerer`, `spiritborn`, `warlock` or `all`. `sort` is `newest`, `updated` or `popular`. `season` is 1 to 99, `page` 1 to 50 and `per_page` 1 to 50. `q` is up to 80 characters of letters, digits and simple punctuation. The game is always `d4`.
- **Response:** `{ filters: [{ id, title, class, season, author: { name, url }, url, updatedAt }], page, totalPages, hasMore, source }`. Only these fields are passed on. **Filter codes never are**: players copy them from the filter page at `url`.
- **Showing results (agreed):** credit "by [author name]" on every filter, link each to its `url`, and show "via DiabloFilter.com" linking to the site.
- **Cache:** each result page is cached for 1 hour, the maximum DiabloFilter allows. Filters deleted or made private upstream drop out when the cache expires.
- **Limits:** DiabloFilter allows 120 requests a minute and 15,000 a day. This Worker stays under them with:
  - the cache
  - an `UPSTREAM` binding of 100 uncached searches a minute overall
  - a loose per-IP binding
  - backing off: when DiabloFilter answers 429, it doesn't call them again until their `Retry-After` has passed

  It deliberately uses no KV, because the free plan allows 1,000 KV writes a day.
- **Never** scrape DiabloFilter pages; this API is the only automated access agreed.

Setup: add the key to the Secrets Store, then `npm run deploy:filters`. That creates `filters.mscrnt.com` as the Worker's custom domain. Add a WAF rate-limit rule on that host, like the one on `reports.mscrnt.com`.
