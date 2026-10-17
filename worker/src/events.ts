// World event recorder (research, private): what helltides.com predicts and reports, kept in our own storage so
// we can work out the rotation ourselves. The app never reads this or helltides.com (Kenneth, 2026-10-17: the
// app runs our own prediction; this only records history to derive and check it). Pure functions, unit tested.

export interface BossPrediction {
  /** ISO start time */
  start: string;
  boss: string;
  zones: { id: string; name: string; whisper: boolean }[];
}

/**
 * The upcoming world bosses on helltides.com/schedule. The page is a Nuxt app: its data sits in
 * `<script id="__NUXT_DATA__">` as a flat array where objects and arrays point at other entries by index.
 */
export function parseSchedule(html: string): BossPrediction[] {
  const m = html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
  if (!m) throw new Error("no __NUXT_DATA__ on the schedule page");
  const a: unknown[] = JSON.parse(m[1]);
  const seen = new Map<number, unknown>();
  const WRAP = new Set(["ShallowReactive", "Reactive", "Ref", "ShallowRef", "EmptyRef", "EmptyShallowRef"]);
  const r = (i: unknown): unknown => {
    if (typeof i !== "number") return i;
    if (seen.has(i)) return seen.get(i);
    const v = a[i];
    if (Array.isArray(v)) {
      if (typeof v[0] === "string" && WRAP.has(v[0])) {
        const x = r(v[1]);
        seen.set(i, x);
        return x;
      }
      const out: unknown[] = [];
      seen.set(i, out);
      for (const k of v) out.push(r(k));
      return out;
    }
    if (v && typeof v === "object") {
      const o: Record<string, unknown> = {};
      seen.set(i, o);
      for (const [k, x] of Object.entries(v)) o[k] = r(x);
      return o;
    }
    seen.set(i, v);
    return v;
  };
  const find = (o: unknown, depth = 0): Record<string, unknown> | null => {
    if (!o || typeof o !== "object" || depth > 8) return null;
    const rec = o as Record<string, unknown>;
    if (Array.isArray(rec.world_boss) && Array.isArray(rec.helltide)) return rec;
    for (const v of Object.values(rec)) {
      const f = find(v, depth + 1);
      if (f) return f;
    }
    return null;
  };
  const s = find(r(0));
  if (!s) throw new Error("no world_boss list in the schedule data");
  return (s.world_boss as Record<string, unknown>[])
    .filter((w) => typeof w.startTime === "string" && typeof w.boss === "string")
    .map((w) => ({
      start: w.startTime as string,
      boss: w.boss as string,
      zones: ((w.zone as Record<string, unknown>[] | undefined) ?? []).map((z) => ({ id: String(z.id ?? ""), name: String(z.name ?? ""), whisper: z.isWhisper === true })),
    }));
}

/** One recording: what was read and when. */
export interface EventRecord {
  at: string;
  kind: "schedule" | "current";
  data: unknown;
}

/**
 * Where a recording goes in storage: `research/events/2026-10-17/0605-current.json` (UTC). One object per read:
 * the storage key can only write, so nothing is appended, and research/ has no expiry (debug/ is deleted after 30 days).
 */
export function recordKey(prefix: string, kind: EventRecord["kind"], at: Date): string {
  const iso = at.toISOString();
  return `${prefix.replace(/\/?$/, "/")}${iso.slice(0, 10)}/${iso.slice(11, 13)}${iso.slice(14, 16)}-${kind}.json`;
}

/** Which job a cron run is: the hourly current-event read, and the schedule read every 6 hours. */
export function jobsFor(cron: string, at: Date): { current: boolean; schedule: boolean } {
  if (cron !== "5 * * * *") return { current: false, schedule: false };
  return { current: true, schedule: at.getUTCHours() % 6 === 0 };
}
