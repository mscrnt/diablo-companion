// "Export my stats": runs with splits, loot history, bests per activity and tier, and the mapped
// character, as JSON and CSV. Pure formatting; src/lib/export.ts saves the files. Nothing leaves the PC:
// no screenshots or item thumbnails, no raw OCR text.
import type { CharacterProfile } from "./charmap";
import type { JudgeResult, ParsedItem, Run } from "./types";

export type Cell = string | number | boolean | null | undefined;

/**
 * One CSV field: quoted when it holds a comma, quote or line break (or starts/ends with a space). Text
 * a spreadsheet would run as a formula ("=...", "@...", "+x", "-x") gets a leading ' so it stays text;
 * numbers like "-12%" are left alone.
 */
export function csvCell(v: Cell): string {
  if (v == null) return "";
  if (typeof v === "number") return Number.isFinite(v) ? String(v) : "";
  if (typeof v === "boolean") return v ? "true" : "false";
  let s = v;
  if (/^[=@\t\r]/.test(s) || /^[+-](?![\d.])/.test(s)) s = "'" + s;
  return /[",\r\n]|^\s|\s$/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** A CSV file (Excel style: CRLF line ends). */
export function toCsv(header: string[], rows: Cell[][]): string {
  return [header, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

const pad = (n: number) => String(n).padStart(2, "0");

/** Local date and time that spreadsheets read as one value: "2026-10-17 21:04:05". */
export function localTime(t: number | null | undefined): string {
  if (t == null || !Number.isFinite(t)) return "";
  const d = new Date(t);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

/** A duration as a clock: "4:05", "1:02:03". */
export function clock(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  return h ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

/** Seconds with one decimal. */
const secs = (ms: number) => Math.round(ms / 100) / 10;
const iso = (t: number | null | undefined) => (t == null || !Number.isFinite(t) ? null : new Date(t).toISOString());
const done = (runs: Run[]) => runs.filter((r) => r.end != null);
const result = (r: Run) => (r.success === false ? "abandoned" : "cleared");
/** "T85" → 85 (tiers sort by number, highest first) */
export const tierNumber = (tier: string | undefined) => {
  const m = tier?.match(/\d+/);
  return m ? Number(m[0]) : null;
};

// ---- runs -----------------------------------------------------------------------------------

export function runsCsv(runs: Run[]): string {
  return toCsv(
    ["started", "ended", "activity", "tier", "result", "seconds", "time", "deaths", "splits", "notes", "id"],
    done(runs).map((r) => [
      localTime(r.start),
      localTime(r.end),
      r.activity,
      r.tier ?? "",
      result(r),
      secs(r.end! - r.start),
      clock(r.end! - r.start),
      r.deaths ?? 0,
      r.splits.map((s) => `${s.label} ${clock(s.at - r.start)}`).join("; "),
      r.notes ?? "",
      r.id,
    ]),
  );
}

/** One row per split, with the time from the start and from the split before. */
export function splitsCsv(runs: Run[]): string {
  return toCsv(
    ["run_started", "activity", "tier", "split", "label", "at", "seconds_from_start", "time_from_start", "seconds_from_previous", "run_id"],
    done(runs).flatMap((r) =>
      r.splits.map((s, i) => [
        localTime(r.start),
        r.activity,
        r.tier ?? "",
        i + 1,
        s.label,
        localTime(s.at),
        secs(s.at - r.start),
        clock(s.at - r.start),
        secs(s.at - (i ? r.splits[i - 1].at : r.start)),
        r.id,
      ]),
    ),
  );
}

function runJson(r: Run) {
  return {
    id: r.id,
    activity: r.activity,
    tier: r.tier ?? "",
    started: iso(r.start),
    ended: iso(r.end),
    durationMs: r.end! - r.start,
    result: result(r),
    deaths: r.deaths ?? 0,
    splits: r.splits.map((s) => ({ label: s.label, at: iso(s.at), fromStartMs: s.at - r.start })),
    ...(r.notes ? { notes: r.notes } : {}),
    ...(r.loot?.length ? { loot: r.loot } : {}),
  };
}

// ---- bests ----------------------------------------------------------------------------------

export interface Best {
  activity: string;
  tier: string;
  runs: number;
  cleared: number;
  /** fastest clear */
  bestMs: number | null;
  bestAt: number | null;
  avgMs: number | null;
  deaths: number;
}

/** Per activity and tier: runs, clears, the fastest and the average clear (abandoned runs don't count for times). */
export function bestsOf(runs: Run[]): Best[] {
  const groups = new Map<string, Run[]>();
  for (const r of done(runs)) {
    const k = `${r.activity}\u0000${r.tier ?? ""}`;
    groups.set(k, [...(groups.get(k) ?? []), r]);
  }
  const out: Best[] = [];
  for (const list of groups.values()) {
    const ok = list.filter((r) => r.success !== false);
    const fastest = ok.reduce<Run | null>((a, r) => (!a || r.end! - r.start < a.end! - a.start ? r : a), null);
    out.push({
      activity: list[0].activity,
      tier: list[0].tier ?? "",
      runs: list.length,
      cleared: ok.length,
      bestMs: fastest ? fastest.end! - fastest.start : null,
      bestAt: fastest ? fastest.start : null,
      avgMs: ok.length ? Math.round(ok.reduce((a, r) => a + (r.end! - r.start), 0) / ok.length) : null,
      deaths: list.reduce((a, r) => a + (r.deaths ?? 0), 0),
    });
  }
  return out.sort((a, b) => a.activity.localeCompare(b.activity) || (tierNumber(b.tier) ?? -1) - (tierNumber(a.tier) ?? -1) || a.tier.localeCompare(b.tier));
}

/** The highest tier cleared in an activity ("The Pit"), or null. */
export function highestTier(runs: Run[], activity: string): { tier: string; bestMs: number; at: number } | null {
  let top: { tier: string; bestMs: number; at: number; n: number } | null = null;
  for (const r of done(runs)) {
    const n = tierNumber(r.tier);
    if (r.activity !== activity || r.success === false || n == null) continue;
    const ms = r.end! - r.start;
    if (!top || n > top.n || (n === top.n && ms < top.bestMs)) top = { tier: r.tier!, bestMs: ms, at: r.start, n };
  }
  return top && { tier: top.tier, bestMs: top.bestMs, at: top.at };
}

export function bestsCsv(bests: Best[]): string {
  return toCsv(
    ["activity", "tier", "runs", "cleared", "best_seconds", "best_time", "best_on", "average_seconds", "average_time", "deaths"],
    bests.map((b) => [
      b.activity,
      b.tier,
      b.runs,
      b.cleared,
      b.bestMs == null ? null : secs(b.bestMs),
      b.bestMs == null ? "" : clock(b.bestMs),
      localTime(b.bestAt),
      b.avgMs == null ? null : secs(b.avgMs),
      b.avgMs == null ? "" : clock(b.avgMs),
      b.deaths,
    ]),
  );
}

// ---- loot -----------------------------------------------------------------------------------

/** An item without its raw OCR text (also on the compared item). */
function cleanItem(item: ParsedItem): ParsedItem {
  const { rawText: _raw, compare, ...rest } = item;
  return { ...rest, ...(compare ? { compare: cleanItem(compare) } : {}) };
}

/** A judgement for the JSON file: no thumbnail, no raw text. */
export function lootJson(r: JudgeResult) {
  const { thumb: _thumb, item, at, ...rest } = r;
  return { ...rest, judged: iso(at), item: cleanItem(item) };
}

export function lootCsv(history: JudgeResult[]): string {
  return toCsv(
    ["judged", "item", "rarity", "type", "slot", "item_power", "verdict", "action", "score", "build_stats_matched", "build_stats_missing", "greater_affixes_wanted", "affixes", "aspect", "flagged"],
    history.map((r) => [
      localTime(r.at),
      r.item.name,
      r.item.rarity,
      r.item.itemType,
      r.slot ?? r.item.slot,
      r.item.itemPower,
      r.verdict,
      r.action ?? "",
      r.score,
      r.matched.join("; "),
      r.missing.join("; "),
      r.greaterOnTargets,
      r.item.affixes.map((a) => (a.greater ? `${a.text} (greater)` : a.text)).join("; "),
      r.item.aspect?.name ?? "",
      !!r.flagged,
    ]),
  );
}

// ---- character ------------------------------------------------------------------------------

export type CharacterData = Pick<CharacterProfile, "stats" | "statsAt" | "skills" | "glyphs">;

/** One row per stat, skill and glyph read from the game. */
export function characterCsv(c: CharacterData): string {
  const rows: Cell[][] = [
    ...Object.entries(c.stats).map(([k, v]): Cell[] => ["stat", k, v, null, null, null, null, localTime(c.statsAt || null)]),
    ...Object.values(c.skills).map((s): Cell[] => ["skill", s.name, s.total, s.rank, s.bonus, s.max, null, localTime(s.at)]),
    ...Object.values(c.glyphs).map((g): Cell[] => ["glyph", g.name, g.level, null, null, null, g.active ?? null, localTime(g.at)]),
  ];
  return toCsv(["kind", "name", "value", "points_spent", "from_gear", "max", "active", "read_at"], rows);
}

function characterJson(c: CharacterData) {
  return { statsRead: iso(c.statsAt || null), stats: c.stats, skills: c.skills, glyphs: c.glyphs };
}

// ---- all files ------------------------------------------------------------------------------

export interface StatsInput {
  runs: Run[];
  loot: JudgeResult[];
  character: CharacterData;
  version: string;
  now: number;
}

/** Every file of the export: one JSON with everything, and a CSV per table. */
export function statsFiles(x: StatsInput): { name: string; text: string }[] {
  const bests = bestsOf(x.runs);
  const pit = highestTier(x.runs, "The Pit");
  const json = {
    app: "Sanctuary Toolkit",
    version: x.version,
    exported: iso(x.now),
    runs: done(x.runs).map(runJson),
    bests: {
      pitHighestTier: pit && { tier: pit.tier, bestMs: pit.bestMs, on: iso(pit.at) },
      byActivity: bests.map((b) => ({ ...b, bestAt: iso(b.bestAt) })),
    },
    loot: x.loot.map(lootJson),
    character: characterJson(x.character),
  };
  // the BOM lets Excel open the CSVs as UTF-8 (item names, accents)
  const bom = "﻿";
  return [
    { name: "stats.json", text: JSON.stringify(json, null, 2) },
    { name: "runs.csv", text: bom + runsCsv(x.runs) },
    { name: "splits.csv", text: bom + splitsCsv(x.runs) },
    { name: "bests.csv", text: bom + bestsCsv(bests) },
    { name: "loot.csv", text: bom + lootCsv(x.loot) },
    { name: "character.csv", text: bom + characterCsv(x.character) },
  ];
}
