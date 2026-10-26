// What edit mode (Ctrl+Shift+O) can change about each overlay panel: the setting that switches it
// off, a handful of its most useful options, and the page "More in Settings" opens. The overlay
// window keeps no settings of its own, so every change travels to the main window as one small patch
// over the bus ("overlay-settings") and is applied here, against the same settings the pages use.
// Every path below names a setting that already exists: edit mode reaches those and nothing else.

import { BAR_LABELS, type BarPanel } from "./barlayout";
import { MAP_PIN_PRESETS, defaultSettings, presetGroups, type MapPinGroup, type MapPinPreset, type Settings } from "./store";
import type { EventKind } from "./types";

/** Every panel the overlay draws that can be switched off: the bar panels plus the status corner. */
export type PanelId = BarPanel | "status";

export const PANEL_IDS: PanelId[] = [...(Object.keys(BAR_LABELS) as BarPanel[]), "status"];

/** Short names for edit mode (BAR_LABELS spells the activity panel out for the Overlay page). */
export const PANEL_LABELS: Record<PanelId, string> = { ...BAR_LABELS, activity: "Activity", status: "Status corner" };

/** The event kinds with their own alert setting (the schedule has no "other" events). */
export const EVENT_KINDS: EventKind[] = ["worldBoss", "helltide", "legion"];
const EVENT_LABELS: Record<EventKind, string> = { worldBoss: "World boss", helltide: "Helltide", legion: "Legion", other: "Other" };
export const eventKindLabel = (k: EventKind) => EVENT_LABELS[k];

/** Lead times edit mode offers for alerts.leadMinutes (the World Events page takes any number). */
export const LEAD_CHOICES = [30, 15, 10, 5, 1];

const PIN_GROUP_LABELS: Record<MapPinGroup, string> = {
  journal: "Deckard's journals",
  collectible: "Altars & collectibles",
  dungeon: "Dungeons",
  cellar: "Cellars",
  stronghold: "Strongholds",
  side_quest: "Side quests",
  helltide_chest: "Helltide chests",
  undercity: "Undercity",
  boss_dungeon: "Boss lairs",
};

/** The kinds of map pin, in the order the settings list them. */
export const PIN_GROUPS: { id: MapPinGroup; label: string }[] = (Object.keys(defaultSettings.mapPins.groups) as MapPinGroup[]).map((id) => ({ id, label: PIN_GROUP_LABELS[id] }));

/** One control in a panel's popover. The first three carry a settings path; the rest have their own shape. */
export type PanelOption =
  | { kind: "toggle"; path: string; label: string }
  | { kind: "range"; path: string; label: string; min: number; max: number; step?: number; fmt?: (v: number) => string; freeOnly?: boolean }
  | { kind: "choice"; path: string; label: string; choices: { value: string; label: string }[] }
  /** which world events alert at all (alerts.enabled) */
  | { kind: "eventKinds"; label: string }
  /** how long before an event it alerts (alerts.leadMinutes) */
  | { kind: "leadMinutes"; label: string }
  /** what the map pins show (mapPins.preset) */
  | { kind: "pinPresets"; label: string }
  /** which kinds of pin show (mapPins.groups, through the Custom preset) */
  | { kind: "pinGroups"; label: string };

export interface PanelSpec {
  options: PanelOption[];
  /** where "More in Settings" goes: a page of the main window */
  more: { page: string; label: string };
}

/** A panel, which also has a hide button: `hide` is the setting the Overlay page ticks. */
export interface HideableSpec extends PanelSpec {
  hide: string;
}

/**
 * Panel size. A panel inside a black bar is sized to the bar, so this slider does nothing there and
 * optionsFor leaves it out; the status corner sits in no bar and is scaled in either layout.
 */
const sizeOpt = (id: PanelId): PanelOption => ({
  kind: "range",
  path: `overlay.widgets.${id}.scale`,
  label: "Size",
  min: 0.6,
  max: 1.8,
  step: 0.05,
  fmt: (v) => `${v.toFixed(2)}x`,
  freeOnly: id !== "status",
});

const secs = (v: number) => `${v}s`;

export const PANELS: Record<PanelId, HideableSpec> = {
  activity: {
    hide: "overlay.widgets.activity.on",
    options: [
      { kind: "toggle", path: "hordes.enabled", label: "Rank Infernal Hordes offers" },
      { kind: "choice", path: "hordes.style", label: "Hordes picks", choices: [{ value: "safe", label: "Safe" }, { value: "balanced", label: "Balanced" }, { value: "greedy", label: "Greedy" }] },
      sizeOpt("activity"),
    ],
    more: { page: "overlay", label: "Overlay" },
  },
  timers: {
    hide: "overlay.widgets.timers.on",
    options: [
      { kind: "eventKinds", label: "Alert for" },
      { kind: "leadMinutes", label: "Warn this long before" },
      { kind: "toggle", path: "alerts.sound", label: "Alert sound" },
      { kind: "toggle", path: "alerts.onlyWhileGameRuns", label: "Only while Diablo IV runs" },
      sizeOpt("timers"),
    ],
    more: { page: "timers", label: "World Events" },
  },
  run: {
    hide: "overlay.widgets.run.on",
    options: [{ kind: "toggle", path: "autoRuns", label: "Start and split runs by itself" }, sizeOpt("run")],
    more: { page: "runs", label: "Runs & Splits" },
  },
  farm: {
    hide: "overlay.widgets.farm.on",
    options: [sizeOpt("farm")],
    more: { page: "farm", label: "Farm Planner" },
  },
  build: {
    hide: "overlay.widgets.build.on",
    options: [sizeOpt("build")],
    more: { page: "build", label: "Build" },
  },
  verdict: {
    hide: "overlay.widgets.verdict.on",
    options: [
      { kind: "range", path: "overlay.verdictSeconds", label: "Verdict stays for", min: 2, max: 20, fmt: secs },
      { kind: "toggle", path: "autoJudge.enabled", label: "Judge items you hover" },
      { kind: "toggle", path: "autoJudge.showBadge", label: "Card beside the tooltip" },
      { kind: "range", path: "autoJudge.worldBadgeSeconds", label: "Ground loot badge stays", min: 1, max: 10, fmt: secs },
      { kind: "toggle", path: "autoJudge.sounds", label: "Sound for every verdict" },
      sizeOpt("verdict"),
    ],
    more: { page: "loot", label: "Loot Judge" },
  },
  watchers: {
    hide: "overlay.widgets.watchers.on",
    options: [sizeOpt("watchers")],
    more: { page: "watchers", label: "Screen Watchers" },
  },
  toasts: {
    hide: "overlay.widgets.toasts.on",
    options: [
      { kind: "eventKinds", label: "Toast for" },
      { kind: "toggle", path: "alerts.sound", label: "Alert sound" },
      { kind: "range", path: "alerts.volume", label: "Volume", min: 0, max: 1, step: 0.05, fmt: (v) => `${Math.round(v * 100)}%` },
      sizeOpt("toasts"),
    ],
    more: { page: "timers", label: "World Events" },
  },
  status: {
    hide: "overlay.widgets.status.on",
    options: [
      { kind: "toggle", path: "autoJudge.enabled", label: "Judge items you hover" },
      { kind: "toggle", path: "autoJudge.sounds", label: "Sound for every verdict" },
      sizeOpt("status"),
    ],
    more: { page: "loot", label: "Loot Judge" },
  },
};

/** The whole overlay, from the edit-mode toolbar. */
export const OVERLAY_SPEC: PanelSpec = {
  options: [
    { kind: "range", path: "overlay.opacity", label: "Opacity", min: 0.3, max: 1, step: 0.02, fmt: (v) => `${Math.round(v * 100)}%` },
    { kind: "toggle", path: "overlay.onlyWhenGameFocused", label: "Only while Diablo IV is focused" },
  ],
  more: { page: "overlay", label: "Overlay" },
};

/** The pins drawn on the game's own map: they sit in no bar, so edit mode reaches them from the toolbar. */
export const MAP_PINS_SPEC: PanelSpec = {
  options: [
    { kind: "toggle", path: "mapPins.enabled", label: "Draw pins on the in-game map" },
    { kind: "pinPresets", label: "Show" },
    { kind: "pinGroups", label: "Kinds" },
    { kind: "toggle", path: "mapPins.unfoundOnly", label: "Hide the ones you've found" },
    { kind: "toggle", path: "mapPins.chip", label: "Keep the preset's name on the map" },
  ],
  more: { page: "overlay", label: "Overlay" },
};

/** A panel's options for the layout in use: the ones that do nothing in that layout are left out. */
export function optionsFor(spec: PanelSpec, layout: "bars" | "free"): PanelOption[] {
  return spec.options.filter((o) => layout === "free" || !(o.kind === "range" && o.freeOnly));
}

// ---- patches ------------------------------------------------------------------

/** One change made from the overlay. `set` carries a path from the lists above. */
export type OverlayPatch = { set: string; value: boolean | number | string } | { pinGroup: MapPinGroup; on: boolean } | { lead: number; on: boolean };

const pathsOf = (o: PanelOption): string[] => {
  switch (o.kind) {
    case "toggle":
    case "range":
    case "choice":
      return [o.path];
    case "eventKinds":
      return EVENT_KINDS.map((k) => `alerts.enabled.${k}`);
    case "pinPresets":
      return ["mapPins.preset"];
    default:
      // leadMinutes and pinGroups have patches of their own
      return [];
  }
};

const ALL_SPECS: PanelSpec[] = [...PANEL_IDS.map((id) => PANELS[id]), OVERLAY_SPEC, MAP_PINS_SPEC];

/** Every settings path edit mode may write. A patch for anything else is dropped. */
export const SETTABLE_PATHS: ReadonlySet<string> = new Set([...PANEL_IDS.map((id) => PANELS[id].hide), ...ALL_SPECS.flatMap((s) => s.options.flatMap(pathsOf))]);

/** The option a path belongs to, for clamping a slider and checking a choice. */
const OPTION_BY_PATH = new Map<string, PanelOption>(ALL_SPECS.flatMap((s) => s.options.flatMap((o) => pathsOf(o).map((p) => [p, o] as [string, PanelOption]))));

function readPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
}

function writePath(obj: any, path: string, value: unknown) {
  const keys = path.split(".");
  const last = keys.pop()!;
  const target = keys.reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);
  if (target) target[last] = value;
}

/** The value a popover control shows. */
export const optionValue = (s: PanelSettings, path: string) => readPath(s, path);

/** The kinds of pin showing now: the preset's, or the Custom ticks. */
export function pinGroupsNow(mp: Settings["mapPins"]): Record<MapPinGroup, boolean> {
  const on = presetGroups(mp.preset, mp.groups);
  return Object.fromEntries(PIN_GROUPS.map((g) => [g.id, !!on[g.id]])) as Record<MapPinGroup, boolean>;
}

/**
 * Tick or untick one kind of pin. The ticks belong to the Custom preset, so another preset's kinds are
 * copied into it first: what was on screen stays on screen, minus (or plus) this kind.
 */
export function setPinGroup(mp: Settings["mapPins"], g: MapPinGroup, on: boolean): { preset: MapPinPreset; groups: Record<MapPinGroup, boolean> } {
  const groups = pinGroupsNow(mp);
  groups[g] = on;
  return { preset: "custom", groups };
}

/** Add or drop one lead time, newest warning last (5, 1 reads as "5 minutes, then 1"). */
export function setLead(mins: readonly number[], m: number, on: boolean): number[] {
  const set = new Set(mins.filter((x) => x > 0));
  if (on) set.add(m);
  else set.delete(m);
  return [...set].sort((a, b) => b - a);
}

/**
 * Apply one patch from the overlay to the settings draft. Returns false, changing nothing, for a path
 * edit mode doesn't offer, a value of the wrong type, or a choice that isn't one of the listed ones.
 */
export function applyOverlayPatch(s: Settings, p: OverlayPatch): boolean {
  if ("pinGroup" in p) {
    if (typeof p.on !== "boolean" || !PIN_GROUPS.some((g) => g.id === p.pinGroup)) return false;
    Object.assign(s.mapPins, setPinGroup(s.mapPins, p.pinGroup, p.on));
    return true;
  }
  if ("lead" in p) {
    if (typeof p.on !== "boolean" || !LEAD_CHOICES.includes(p.lead)) return false;
    s.alerts.leadMinutes = setLead(s.alerts.leadMinutes, p.lead, p.on);
    return true;
  }
  if (!SETTABLE_PATHS.has(p.set)) return false;
  const cur = readPath(s, p.set);
  if (typeof cur !== typeof p.value) return false;
  const opt = OPTION_BY_PATH.get(p.set);
  let v = p.value;
  if (typeof v === "number") {
    if (!Number.isFinite(v)) return false;
    if (opt?.kind === "range") v = Math.min(opt.max, Math.max(opt.min, v));
  }
  if (typeof v === "string") {
    const listed = opt?.kind === "choice" ? opt.choices.some((c) => c.value === v) : opt?.kind === "pinPresets" && MAP_PIN_PRESETS.some((x) => x.id === v);
    if (!listed) return false;
  }
  writePath(s, p.set, v);
  return true;
}

/** True when the patch moves the map pins, so the main window redraws them at once. */
export const touchesMapPins = (p: OverlayPatch) => "pinGroup" in p || ("set" in p && p.set.startsWith("mapPins."));

// ---- hide & restore ------------------------------------------------------------

type Widgets = Settings["overlay"]["widgets"];

/** The panels switched off, in the order they're listed. */
export const hiddenPanels = (w: Widgets): PanelId[] => PANEL_IDS.filter((id) => !w[id].on);

/** Switch one panel off (or back on). */
export const showPanel = (id: PanelId, on: boolean): OverlayPatch => ({ set: PANELS[id].hide, value: on });

/**
 * The settings edit mode shows and changes, as the overlay window receives them: only the fields the
 * controls above read, so nothing else (the Discord webhook, the LLM key) is copied into that window.
 */
export interface PanelSettings extends Pick<Settings, "overlay" | "autoJudge" | "hordes" | "mapPins" | "autoRuns"> {
  alerts: Pick<Settings["alerts"], "enabled" | "leadMinutes" | "sound" | "volume" | "onlyWhileGameRuns">;
}
