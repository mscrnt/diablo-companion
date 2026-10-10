// World event timers.
// Times are deterministic (verified against helltides.com, S15): world boss every
// 3h30m, legion every 25 min, helltide hourly for 55 min. Boss names and zones
// come from helltides.com's public Firebase RTDB (credit shown in the UI).
import { Diamond, Flame, Skull, Swords, type LucideIcon } from "lucide-react";
import { httpJson } from "./http";
import type { GameEvent } from "./types";

const WB_PERIOD = 12600;
const WB_OFFSET = 10800;
const LEGION_PERIOD = 1500;
const LEGION_OFFSET = 1200;
const HOUR = 3600;
const HELLTIDE_LEN = 3300;

const mod = (a: number, n: number) => ((a % n) + n) % n;

export const ZONES: Record<string, string> = {
  fractured_peaks: "Fractured Peaks",
  scosglen: "Scosglen",
  dry_steppes: "Dry Steppes",
  kehjistan: "Kehjistan",
  hawezar: "Hawezar",
  nahantu: "Nahantu",
  skovos: "Skovos",
};

const zoneName = (id?: string | null) => (id ? ZONES[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);

/** Locally computed schedule for the next `hours` hours. */
export function localSchedule(nowMs = Date.now(), hours = 12): GameEvent[] {
  const now = Math.floor(nowMs / 1000);
  const end = now + hours * 3600;
  const out: GameEvent[] = [];

  // include an event that started up to 15 min ago (boss still up / legion running)
  let wb = now - 900 + mod(WB_OFFSET - (now - 900), WB_PERIOD);
  for (; wb < end; wb += WB_PERIOD)
    out.push({ kind: "worldBoss", name: "World Boss", start: wb * 1000, end: (wb + 900) * 1000, source: "schedule" });

  let lg = now - 300 + mod(LEGION_OFFSET - (now - 300), LEGION_PERIOD);
  for (; lg < end; lg += LEGION_PERIOD)
    out.push({ kind: "legion", name: "Legion", start: lg * 1000, end: (lg + 300) * 1000, source: "schedule" });

  let ht = Math.floor(now / HOUR) * HOUR;
  for (; ht < end; ht += HOUR)
    out.push({ kind: "helltide", name: "Helltide", start: ht * 1000, end: (ht + HELLTIDE_LEN) * 1000, source: "schedule" });

  return out.sort((a, b) => a.start - b.start);
}

const RTDB_HOSTS = [
  "https://helltides-7e530-r1.firebaseio.com",
  "https://helltides-7e530-r2.firebaseio.com",
  "https://helltides-7e530-r3.firebaseio.com",
  "https://helltides-7e530-default-rtdb.firebaseio.com",
];
let hostIdx = Math.floor(Math.random() * 3);

async function rtdb<T>(node: string): Promise<T> {
  let lastErr: unknown;
  for (let i = 0; i < RTDB_HOSTS.length; i++) {
    const host = RTDB_HOSTS[(hostIdx + i) % RTDB_HOSTS.length];
    try {
      const r = await httpJson<T>(`${host}/${node}.json`, {
        headers: { "User-Agent": "diablo-companion/0.1 (personal use; credits helltides.com)" },
        timeoutMs: 10000,
      });
      hostIdx = (hostIdx + i) % RTDB_HOSTS.length;
      return r;
    } catch (e) {
      lastErr = e;
    }
  }
  throw lastErr;
}

export interface LiveInfo {
  worldBoss?: { boss: string; start: number; next?: number; zones: { name: string; boss: string; whisper?: boolean }[] };
  helltide?: { zone?: string; start: number; end: number };
  legion?: { start: number; next?: number; zone?: string };
  fetchedAt: number;
  error?: string;
}

export async function fetchLive(): Promise<LiveInfo> {
  const [wb, ht, lg] = await Promise.allSettled([
    rtdb<any>("world_boss"),
    rtdb<any>("helltide"),
    rtdb<any>("legion"),
  ]);
  const info: LiveInfo = { fetchedAt: Date.now() };
  const errs: string[] = [];
  if (wb.status === "fulfilled" && wb.value?.startTime) {
    const z = Array.isArray(wb.value.zone) ? wb.value.zone : wb.value.zone ? [wb.value.zone] : [];
    info.worldBoss = {
      boss: wb.value.boss,
      start: Date.parse(wb.value.startTime),
      next: wb.value.nextTime ? Date.parse(wb.value.nextTime) : undefined,
      zones: z.map((x: any) => ({ name: x.name ?? zoneName(x.id) ?? "?", boss: x.boss ?? wb.value.boss, whisper: !!x.isWhisper })),
    };
  } else if (wb.status === "rejected") errs.push("world boss: " + String(wb.reason));
  if (ht.status === "fulfilled" && ht.value?.startTime) {
    info.helltide = { zone: zoneName(ht.value.zone), start: Date.parse(ht.value.startTime), end: Date.parse(ht.value.endTime) };
  } else if (ht.status === "rejected") errs.push("helltide: " + String(ht.reason));
  if (lg.status === "fulfilled" && lg.value?.startTime) {
    info.legion = {
      start: Date.parse(lg.value.startTime),
      next: lg.value.nextTime ? Date.parse(lg.value.nextTime) : undefined,
      zone: zoneName(lg.value.zone),
    };
  } else if (lg.status === "rejected") errs.push("legion: " + String(lg.reason));
  if (errs.length) info.error = errs.join("; ");
  return info;
}

/** Overlay live names/zones onto the computed schedule. */
export function mergeLive(events: GameEvent[], live: LiveInfo | null): GameEvent[] {
  if (!live) return events;
  const near = (a: number, b: number) => Math.abs(a - b) < 90_000;
  return events.map((e) => {
    if (e.kind === "worldBoss" && live.worldBoss && near(e.start, live.worldBoss.start)) {
      const zones = live.worldBoss.zones;
      return {
        ...e,
        name: live.worldBoss.boss,
        zone: zones.length > 1 ? zones.map((z) => z.name).join(" or ") : zones[0]?.name,
        source: "helltides.com",
        extra: { predicted: zones.length > 1, whisper: zones.some((z) => z.whisper) },
      };
    }
    if (e.kind === "helltide" && live.helltide && near(e.start, live.helltide.start)) {
      return { ...e, zone: live.helltide.zone, end: live.helltide.end, source: "helltides.com" };
    }
    if (e.kind === "legion" && live.legion && near(e.start, live.legion.start) && live.legion.zone) {
      return { ...e, zone: live.legion.zone, source: "helltides.com" };
    }
    return e;
  });
}

export function nextOf(events: GameEvent[], kind: GameEvent["kind"], now = Date.now()) {
  return events.find((e) => e.kind === kind && (e.end ?? e.start) > now);
}

export function isActive(e: GameEvent, now = Date.now()) {
  return e.start <= now && (e.end ?? e.start) > now;
}

export function fmtCountdown(ms: number): string {
  if (ms <= 0) return "now";
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m >= 10) return `${m}m`;
  return `${m}:${String(sec).padStart(2, "0")}`;
}

/** `icon` is the Lucide icon for the UI; `emoji` is for plain-text places (OS notifications). */
export const EVENT_META: Record<GameEvent["kind"], { label: string; color: string; icon: LucideIcon; emoji: string }> = {
  worldBoss: { label: "World Boss", color: "#e0543c", icon: Skull, emoji: "☠" },
  helltide: { label: "Helltide", color: "#ff7a2f", icon: Flame, emoji: "🔥" },
  legion: { label: "Legion", color: "#b06cff", icon: Swords, emoji: "⚔" },
  other: { label: "Event", color: "#9aa", icon: Diamond, emoji: "◆" },
};

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
