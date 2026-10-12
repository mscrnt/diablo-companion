// Everything the Worker checks before it stores a report. Pure functions, so they're unit tested.

/** Operating systems the app reports itself as. Anything else is rejected. */
export const OS_ALLOW = ["windows-10", "windows-11", "windows"] as const;
export type Os = (typeof OS_ALLOW)[number];

export interface ReportMeta {
  version: string;
  os: Os;
  screenshots: boolean;
}

export type Check<T> = { ok: true; value: T } | { ok: false; status: number; error: string };

const bad = (status: number, error: string): Check<never> => ({ ok: false, status, error });

/** The `X-Report-Meta` header: `{"version":"0.2.0","os":"windows-11","screenshots":false}`. */
export function parseMeta(header: string | null): Check<ReportMeta> {
  if (!header || header.length > 512) return bad(400, "missing or oversized X-Report-Meta");
  let raw: unknown;
  try {
    raw = JSON.parse(header);
  } catch {
    return bad(400, "X-Report-Meta is not JSON");
  }
  if (!raw || typeof raw !== "object") return bad(400, "X-Report-Meta must be an object");
  const m = raw as Record<string, unknown>;
  // x.y.z, or a pre-release build: x.y.z-alpha.N / -beta.N / -rc.N
  if (typeof m.version !== "string" || !/^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/.test(m.version)) return bad(400, "bad version");
  if (typeof m.os !== "string" || !(OS_ALLOW as readonly string[]).includes(m.os)) return bad(400, "bad os");
  if (m.screenshots !== undefined && typeof m.screenshots !== "boolean") return bad(400, "bad screenshots flag");
  return { ok: true, value: { version: m.version, os: m.os as Os, screenshots: m.screenshots === true } };
}

/** A zip starts with a local file header: `PK\x03\x04`. */
export function isZip(bytes: Uint8Array): boolean {
  return bytes.length >= 22 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04;
}

/** Size gate, first on the declared length (before reading), then on what actually arrived. */
export function checkSize(declared: string | null, max: number): Check<number | null> {
  if (declared == null) return { ok: true, value: null };
  const n = Number(declared);
  if (!Number.isFinite(n) || n < 0) return bad(400, "bad Content-Length");
  if (n > max) return bad(413, `report is larger than ${Math.round(max / 1024 / 1024)} MB`);
  return { ok: true, value: n };
}

const CROCKFORD = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

/** ULID: 10 characters of millisecond time + 16 of randomness, sortable by time. Made here, never by the client. */
export function ulid(now = Date.now(), rand: (n: number) => Uint8Array = (n) => crypto.getRandomValues(new Uint8Array(n))): string {
  let t = now;
  let time = "";
  for (let i = 0; i < 10; i++) {
    time = CROCKFORD[t % 32] + time;
    t = Math.floor(t / 32);
  }
  const r = rand(16);
  let random = "";
  for (let i = 0; i < 16; i++) random += CROCKFORD[r[i] % 32];
  return time + random;
}

/** Where the zip goes: `debug/2026-10-11/<id>.zip` (UTC date). */
export function objectKey(prefix: string, id: string, now = new Date()): string {
  return `${prefix.replace(/\/?$/, "/")}${now.toISOString().slice(0, 10)}/${id}.zip`;
}

/**
 * The GitHub issue for a report. A public repo gets metadata only: no zip, no storage key or link and
 * nothing the client typed. A private repo also gets the screenshots flag, the storage key and the time.
 */
export function issueFor(
  id: string,
  meta: ReportMeta,
  size: number,
  key: string,
  isPrivate: boolean,
  at = new Date(),
  download?: { url: string; until: string },
): { title: string; body: string } {
  const kb = Math.max(1, Math.round(size / 1024));
  const rows = [
    ["Report ID", `\`${id}\``],
    ["App version", meta.version],
    ["OS", meta.os],
    ["Size", `${kb} KB`],
  ];
  if (isPrivate) rows.push(["Screenshots", meta.screenshots ? "yes" : "no"], ["Stored at", `\`${key}\``], ["Received", at.toISOString()]);
  // the zip itself only ever goes to a private repo
  if (isPrivate && download) rows.push(["Download", `[${id}.zip](${download.url}) (deleted on ${download.until})`]);
  const table = ["| | |", "|---|---|", ...rows.map(([k, v]) => `| ${k} | ${v} |`)].join("\n");
  return { title: `Debug report ${id}`, body: `A debug report was sent from Sanctuary Toolkit.\n\n${table}\n` };
}

/** The release that holds one day's report zips (private repo only). */
export const releaseTag = (day: string) => `reports-${day}`;

/** The day a report received on `day` is deleted: `keepDays` later (YYYY-MM-DD). */
export function deleteOn(day: string, keepDays: number): string {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + keepDays);
  return d.toISOString().slice(0, 10);
}

/** Of these release tags, the report days that are `keepDays` old or older on `now` and must go. */
export function expiredReleaseTags(tags: string[], now: Date, keepDays: number): string[] {
  const today = now.toISOString().slice(0, 10);
  return tags.filter((t) => {
    const m = t.match(/^reports-(\d{4}-\d{2}-\d{2})$/);
    return !!m && deleteOn(m[1], keepDays) <= today;
  });
}
