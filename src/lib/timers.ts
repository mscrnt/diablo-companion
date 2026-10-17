// World event timers, all predicted here: nothing is fetched from other sites or read off the screen.
// Times: world boss every 3h30m, legion every 25 min, helltide hourly for 55 min (Blizzard patch notes 1.2.0, 1.3.0).
// Names and zones: our own analysis (2026-10-17) of ~1,500 world bosses and ~3,000 helltide hours of history
// (private research notes; the rotation lives on Blizzard's servers, not in the game files). Re-check after
// patches and season starts: the boss rotation's offset and the helltide cycle have both changed before.
import { Diamond, Flame, Skull, Swords, type LucideIcon } from "lucide-react";
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

/** World boss spawn number: 0 at the first 3h30m spawn after patch 1.2.0 (2023-10-17 23:00 UTC). */
const WB_EPOCH = 1697583600;
/**
 * The world boss by spawn number mod 15. It cycles the four bosses in runs of two (Ashava, Azmodan,
 * Wandering Death, Avarice), with one single per 15. Fits 337 of 353 spawns 2026-05-21 to 2026-10-17. Two slots
 * aren't settled: slot 3 is Wandering Death about 2 times in 3 and Azmodan otherwise, slot 1 Azmodan about 1 in 5.
 */
const WB_ROTATION = ["Ashava", "Ashava", "Azmodan", "Wandering Death", "Wandering Death", "Avarice", "Avarice", "Ashava", "Ashava", "Azmodan", "Azmodan", "Wandering Death", "Wandering Death", "Avarice", "Avarice"];
const WB_MAYBE: Record<number, string> = { 1: "Azmodan", 3: "Azmodan" };
/** Primary zones a world boss can spawn in; which one isn't predictable yet (it looks random server-side). */
export const WB_ZONES = ["Fractured Peaks", "Scosglen", "Dry Steppes", "Kehjistan", "Hawezar"];
/** Helltide zone by UTC hour mod 5, since 2026-04-29 19:00 UTC (2,035 of 2,035 hours since). */
const HELLTIDE_ZONES = ["Scosglen", "Dry Steppes", "Kehjistan", "Hawezar", "Fractured Peaks"];
const HELLTIDE_ZONES_SINCE = Date.parse("2026-04-29T19:00:00Z") / 1000;

/** Which world boss spawns at `t` (unix seconds, a spawn time), and whether it also spawns in an expansion zone. */
export function predictWorldBoss(t: number): { boss: string; maybe?: string; expansion: boolean } {
  const n = Math.round((t - WB_EPOCH) / WB_PERIOD);
  const slot = mod(n, 15);
  // every 4th spawn also spawns in Nahantu or Skovos (which one isn't predictable)
  return { boss: WB_ROTATION[slot], ...(WB_MAYBE[slot] ? { maybe: WB_MAYBE[slot] } : {}), expansion: mod(n, 4) === 0 };
}

/**
 * The world boss's likely main zone: a 15-slot cycle that turns one step a week, at a phase offset Blizzard's side
 * has moved a few times (late June to mid September 2026). About 2 in 3 right; shown as "probably". Slots that
 * didn't settle in our data (6, 13, 14) give no guess. WB_ZONE_PHASE is the offset since 2026-09-19: when our own
 * recordings show it moved, it changes here.
 */
const WB_ZONE_CYCLE: (string | null)[] = ["Scosglen", "Kehjistan", "Dry Steppes", "Scosglen", "Fractured Peaks", "Dry Steppes", null, "Hawezar", "Fractured Peaks", "Kehjistan", "Hawezar", "Fractured Peaks", "Kehjistan", null, null];
const WB_ZONE_WEEK0 = Date.parse("2026-01-06T00:00:00Z") / 1000;
const WB_ZONE_PHASE = 9;

export function predictWorldBossZone(t: number): string | undefined {
  const n = Math.round((t - WB_EPOCH) / WB_PERIOD);
  const week = Math.floor((t - WB_ZONE_WEEK0) / (7 * 86400));
  return WB_ZONE_CYCLE[mod(n + 7 * week + WB_ZONE_PHASE, 15)] ?? undefined;
}

/** The helltide zone for the hour starting at `t` (unix seconds), or undefined before the cycle began. */
export function predictHelltideZone(t: number): string | undefined {
  if (t < HELLTIDE_ZONES_SINCE) return undefined;
  return HELLTIDE_ZONES[mod(Math.floor(t / HOUR), 5)];
}

/** "Wandering Death or Azmodan" where the rotation slot isn't settled, else the name. */
export const eventLabel = (e: GameEvent) => (typeof e.extra?.maybe === "string" ? `${e.name} or ${e.extra.maybe}` : e.name);

export const zoneName = (id?: string | null) => (id ? ZONES[id] ?? id.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()) : undefined);

/** Locally computed schedule for the next `hours` hours. */
export function localSchedule(nowMs = Date.now(), hours = 12): GameEvent[] {
  const now = Math.floor(nowMs / 1000);
  const end = now + hours * 3600;
  const out: GameEvent[] = [];

  // include an event that started up to 15 min ago (boss still up / legion running)
  let wb = now - 900 + mod(WB_OFFSET - (now - 900), WB_PERIOD);
  for (; wb < end; wb += WB_PERIOD) {
    const p = predictWorldBoss(wb);
    const likely = predictWorldBossZone(wb);
    out.push({
      kind: "worldBoss",
      name: p.boss,
      // the main zone is a likely guess (about 2 in 3); the expansion one is "Nahantu or Skovos"
      zone: [likely && `probably ${likely}`, p.expansion && "also Nahantu or Skovos"].filter(Boolean).join(", ") || undefined,
      start: wb * 1000,
      end: (wb + 900) * 1000,
      source: "schedule",
      extra: { maybe: p.maybe, expansion: p.expansion },
    });
  }

  let lg = now - 300 + mod(LEGION_OFFSET - (now - 300), LEGION_PERIOD);
  for (; lg < end; lg += LEGION_PERIOD)
    out.push({ kind: "legion", name: "Legion", start: lg * 1000, end: (lg + 300) * 1000, source: "schedule" });

  let ht = Math.floor(now / HOUR) * HOUR;
  for (; ht < end; ht += HOUR)
    out.push({ kind: "helltide", name: "Helltide", zone: predictHelltideZone(ht), start: ht * 1000, end: (ht + HELLTIDE_LEN) * 1000, source: "schedule" });

  return out.sort((a, b) => a.start - b.start);
}

export interface LiveInfo {
  worldBoss?: { boss: string; start: number; next?: number; zones: { name: string; boss: string; whisper?: boolean }[] };
  helltide?: { zone?: string; start: number; end: number };
  legion?: { start: number; next?: number; zone?: string };
  fetchedAt: number;
  error?: string;
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
        source: "game",
        extra: { predicted: zones.length > 1, whisper: zones.some((z) => z.whisper) },
      };
    }
    if (e.kind === "helltide" && live.helltide && near(e.start, live.helltide.start)) {
      return { ...e, zone: live.helltide.zone, end: live.helltide.end, source: "game" };
    }
    if (e.kind === "legion" && live.legion && near(e.start, live.legion.start) && live.legion.zone) {
      return { ...e, zone: live.legion.zone, source: "game" };
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
