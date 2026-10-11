# Debug-report upload Worker

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
  - `version` must match `x.y.z`
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

## One-time setup

```sh
cd worker
npm install
npx wrangler login                          # opens the browser
npx wrangler kv namespace create COUNTERS   # paste the id into wrangler.toml
npx wrangler secret put IP_SALT             # any long random string
npm run dev                                 # wrangler dev --remote: real bindings, real MinIO
```

Test against the dev URL wrangler prints (replace the port if different):

```sh
# a valid report
curl -s -X POST http://localhost:8787/report \
  -H "content-type: application/zip" \
  -H 'x-report-meta: {"version":"0.2.0","os":"windows-11","screenshots":false}' \
  --data-binary @some-debug-report.zip
# → {"id":"01K…"}; the object appears under d4-companion/debug/<date>/
```

Then `npm run deploy`. That creates `reports.mscrnt.com` as a custom domain on the Worker.

## Turning on GitHub issues

1. Create a fine-grained token in GitHub: one repository, **Issues: read and write**.
2. Add it to the Secrets Store `mscrnt` as `D4_COMPANION_GITHUB_TOKEN`, scoped to workers.
3. In `wrangler.toml`: uncomment the `GITHUB_TOKEN` binding, set `GITHUB_ISSUES = "on"`, `GITHUB_REPO`, and `GITHUB_REPO_PRIVATE`.
   - With `"false"` (public repo), the issue has only the report ID, version, OS and size.
4. `npm run deploy`.

## Rules

- Never commit credentials. The MinIO and GitHub keys live only in the Secrets Store, and `IP_SALT` is a Worker secret.
- The MinIO user can only `PutObject` under `d4-companion/debug/*`. If the Worker ever needs to read, use a separate key; don't widen this one.
