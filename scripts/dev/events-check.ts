// Is our world event prediction (src/lib/timers.ts) still right? Run it after a patch, a season start, or when a
// "probably" zone looks off. Reads the Worker's research recordings (research/events/<day>/<HHMM>-current.json,
// downloaded from MinIO into a folder) or any .jsonl of { data: { world_boss, helltide, legion } } rows, scores the
// predictor week by week, and says which number to change when Blizzard's side has moved.
//   node scripts/dev/run.mjs events-check <folder or .jsonl> [--days 28]
// Getting the recordings (on the MinIO host, with the Python SDK; credentials from the container's env, never saved):
//   docker run --rm --network host -v "$PWD/events:/out" -e K="$(docker exec minio printenv MINIO_ROOT_USER)" \
//     -e S="$(docker exec minio printenv MINIO_ROOT_PASSWORD)" python:3-slim sh -c 'pip -q install minio && python -c "
//   import os; from minio import Minio
//   m = Minio(\"localhost:9000\", os.environ[\"K\"], os.environ[\"S\"], secure=False)
//   for o in m.list_objects(\"d4-companion\", prefix=\"research/events/\", recursive=True):
//       m.fget_object(\"d4-companion\", o.object_name, \"/out/\" + o.object_name.split(\"research/events/\")[1])"'
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  HELLTIDE_ZONES, HELLTIDE_ZONES_SINCE, WB_EPOCH, WB_MAYBE, WB_ROTATION, WB_ZONE_CYCLE, WB_ZONE_PHASE, WB_ZONE_WEEK0, ZONES,
  predictHelltideZone, predictWorldBoss, predictWorldBossZone,
} from "../../src/lib/timers";

const args = process.argv.slice(2);
const src = args.find((a) => !a.startsWith("--"));
if (!src) throw new Error("usage: events-check <folder of recordings or .jsonl> [--days 28]");
const days = Number(args[args.indexOf("--days") + 1]) || 28;

// ---- read every snapshot: { seen, world_boss, helltide, legion }
type Snap = { seen: number; wb?: any; ht?: any; lg?: any };
const snaps: Snap[] = [];
const S = (iso: string) => Date.parse(iso) / 1000;
const addSnap = (seenIso: string | undefined, d: any) => d && seenIso && snaps.push({ seen: S(seenIso), wb: d.world_boss, ht: d.helltide, lg: d.legion });
const walk = (p: string): string[] => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : [p]);
for (const f of walk(src)) {
  if (f.endsWith(".jsonl")) {
    for (const line of readFileSync(f, "utf8").split("\n")) {
      if (!line.trim()) continue;
      const r = JSON.parse(line);
      addSnap(r.data?.fetchedAt ?? r.at ?? r.committed, r.data);
    }
  } else if (f.endsWith("-current.json")) {
    const r = JSON.parse(readFileSync(f, "utf8"));
    addSnap(r.at, r.data);
  }
}
if (!snaps.length) throw new Error(`no recordings found in ${src}`);
const latest = Math.max(...snaps.map((s) => s.seen));
const from = latest - days * 86400;
console.log(`${snaps.length} snapshots, ${new Date(Math.min(...snaps.map((s) => s.seen)) * 1000).toISOString().slice(0, 16)} to ${new Date(latest * 1000).toISOString().slice(0, 16)}; checking the last ${days} days`);

// ---- what was showing at each event: helltides while running, world bosses within an hour before (or just after)
const BASE = new Set(["fractured_peaks", "scosglen", "dry_steppes", "kehjistan", "hawezar"]);
const EXP = new Set(["nahantu", "skovos"]);
const helltides = new Map<number, string>();
const bosses = new Map<number, { lead: number; boss: string; zone?: string; exp: boolean }>();
const legions = new Set<number>();
for (const s of snaps) {
  if (s.ht?.startTime && s.ht.zone) {
    const t = S(s.ht.startTime);
    if (s.seen >= t && s.seen < t + 3300 && t >= from) helltides.set(t, ZONES[s.ht.zone] ?? s.ht.zone);
  }
  for (const k of ["startTime", "nextTime"]) if (s.lg?.[k] && S(s.lg[k]) >= from) legions.add(S(s.lg[k]));
  if (s.wb?.startTime && s.wb.boss) {
    const t = S(s.wb.startTime);
    const lead = (t - s.seen) / 3600;
    if (lead > 1 || lead < -0.25 || t < from) continue;
    const zones: { id: string; boss?: string }[] = s.wb.zone ?? [];
    // the base zone whose boss matches (old entries linger in the list); an expansion zone at all
    const base = zones.filter((z) => BASE.has(z.id));
    const zone = (base.find((z) => z.boss === s.wb.boss) ?? base[0])?.id;
    const prev = bosses.get(t);
    if (!prev || lead < prev.lead) bosses.set(t, { lead, boss: s.wb.boss, zone: zone && ZONES[zone], exp: zones.some((z) => EXP.has(z.id)) });
  }
}

const mod = (a: number, n: number) => ((a % n) + n) % n;
const nOf = (t: number) => Math.round((t - WB_EPOCH) / 12600);
const weekOf = (t: number) => Math.floor((t - WB_ZONE_WEEK0) / (7 * 86400));
const pct = (a: number, b: number) => (b ? `${a}/${b} (${Math.round((100 * a) / b)}%)` : "none");
const byWeek = new Map<string, Record<string, [number, number]>>();
const tally = (t: number, k: string, ok: boolean) => {
  const w = new Date((WB_ZONE_WEEK0 + weekOf(t) * 7 * 86400) * 1000).toISOString().slice(0, 10);
  const r = byWeek.get(w) ?? {};
  (r[k] ??= [0, 0])[1]++;
  if (ok) r[k][0]++;
  byWeek.set(w, r);
};

for (const [t, zone] of helltides) tally(t, "helltide", predictHelltideZone(t) === zone);
for (const t of legions) tally(t, "legion", mod(t, 1500) === 1200);
for (const [t, b] of bosses) {
  const p = predictWorldBoss(t);
  tally(t, "boss", p.boss === b.boss || p.maybe === b.boss);
  tally(t, "expansion", p.expansion === b.exp || (!p.expansion && b.exp)); // a lingering expansion entry isn't a miss
  const z = predictWorldBossZone(t);
  if (z && b.zone) tally(t, "zone", z === b.zone);
}
console.log("\nweek of      helltide        legion          boss            zone            expansion");
for (const [w, r] of [...byWeek].sort()) console.log(w.padEnd(13) + ["helltide", "legion", "boss", "zone", "expansion"].map((k) => pct(...(r[k] ?? [0, 0])).padEnd(16)).join(""));

// ---- what to change if something moved (fit on the last 14 days)
const recent = latest - 14 * 86400;
const advice: string[] = [];
{
  const hs = [...helltides].filter(([t]) => t >= recent && t >= HELLTIDE_ZONES_SINCE);
  const fit = (k: number) => hs.filter(([t, z]) => HELLTIDE_ZONES[mod(Math.floor(t / 3600) + k, 5)] === z).length;
  const best = [0, 1, 2, 3, 4].sort((a, b) => fit(b) - fit(a))[0];
  if (hs.length && fit(best) > fit(0)) advice.push(`Helltide cycle moved by ${best} hour(s): ${fit(best)}/${hs.length} with HELLTIDE_ZONES rotated left by ${best}, ${fit(0)}/${hs.length} now. Set HELLTIDE_ZONES_SINCE to when it changed.`);
  const odd = hs.filter(([, z]) => !HELLTIDE_ZONES.includes(z)).length;
  if (odd) advice.push(`${odd} recent helltides were in a zone outside the cycle: the zone list itself changed.`);
}
{
  const bs = [...bosses].filter(([t]) => t >= recent);
  const fit = (s: number) => bs.filter(([t, b]) => { const slot = mod(nOf(t) + s, 15); return WB_ROTATION[slot] === b.boss || WB_MAYBE[slot] === b.boss; }).length;
  const best = [...Array(15).keys()].sort((a, b) => fit(b) - fit(a))[0];
  if (bs.length && fit(best) > fit(0)) advice.push(`Boss rotation moved by ${best} slot(s): ${fit(best)}/${bs.length} shifted, ${fit(0)}/${bs.length} now. Shift WB_EPOCH by ${best} * 12600 or rotate WB_ROTATION.`);
  const zs = bs.filter(([, b]) => b.zone);
  const zfit = (c: number) => zs.filter(([t, b]) => WB_ZONE_CYCLE[mod(nOf(t) + 7 * weekOf(t) + c, 15)] === b.zone).length;
  const zbest = [...Array(15).keys()].sort((a, b) => zfit(b) - zfit(a))[0];
  if (zs.length && zbest !== WB_ZONE_PHASE && zfit(zbest) > zfit(WB_ZONE_PHASE)) advice.push(`World boss zone phase moved: WB_ZONE_PHASE = ${zbest} fits ${zfit(zbest)}/${zs.length} of the last 14 days, ${WB_ZONE_PHASE} (now) fits ${zfit(WB_ZONE_PHASE)}.`);
}
console.log("\n" + (advice.length ? advice.map((a) => "CHANGE: " + a).join("\n") : "Nothing moved in the last 14 days: the predictor matches."));
