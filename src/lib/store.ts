import { create } from "zustand";
import { persist } from "zustand/middleware";
import { persistStorage } from "./persist";
import { setCharacterNames } from "./privacy";
import type { CharacterProfile } from "./charmap";
import type { Build, EventKind, JudgeResult, ParsedItem, Run, SlotProgress, Talisman } from "./types";

// ---- settings ---------------------------------------------------------------

export interface WidgetPos {
  on: boolean;
  /** position as a fraction of the overlay (0..1) so it survives resolution changes */
  x: number;
  y: number;
  scale: number;
}

/** Screen layout learned by the guided setup (absolute screen px). */
export interface Calibration {
  at: number;
  gameRect: { x: number; y: number; w: number; h: number };
  inventoryPanel?: { x: number; y: number; w: number; h: number };
  equipment?: Partial<Record<string, { x: number; y: number; w: number; h: number }>>;
  gold?: { x: number; y: number; w: number; h: number };
  statsPanel?: { x: number; y: number; w: number; h: number };
}

/** Kinds of map pins, each with its own checkbox (see src/lib/mappins.ts). */
export type MapPinGroup = "journal" | "collectible" | "dungeon" | "cellar" | "stronghold" | "side_quest" | "helltide_chest" | "undercity" | "boss_dungeon";

/** What the map pins show; the hotkey / chord steps through the ones in `mapPins.cycle`. */
export type MapPinPreset = "custom" | "collectibles" | "dungeons" | "quests" | "helltide" | "everything" | "off";

export const MAP_PIN_PRESETS: { id: MapPinPreset; label: string; desc: string; groups: MapPinGroup[] | null }[] = [
  { id: "custom", label: "Custom", desc: "The kinds ticked below.", groups: null },
  { id: "collectibles", label: "Collectibles", desc: "Deckard's journals, altars and regional collectibles.", groups: ["journal", "collectible"] },
  { id: "dungeons", label: "Dungeons & cellars", desc: "Dungeon and cellar entrances.", groups: ["dungeon", "cellar"] },
  { id: "quests", label: "Quests", desc: "Side quests and strongholds.", groups: ["side_quest", "stronghold"] },
  { id: "helltide", label: "Helltide", desc: "Possible chest spots, while a Helltide runs, in its zone.", groups: ["helltide_chest"] },
  {
    id: "everything",
    label: "Everything",
    desc: "Every kind.",
    groups: ["journal", "collectible", "dungeon", "cellar", "stronghold", "side_quest", "helltide_chest", "undercity", "boss_dungeon"],
  },
  { id: "off", label: "Off", desc: "No pins (and no screen capture for them).", groups: [] },
];

/** The kinds a preset shows (`custom`: the per-kind checkboxes). */
export function presetGroups(preset: MapPinPreset, custom: Record<MapPinGroup, boolean>): Partial<Record<MapPinGroup, boolean>> {
  const p = MAP_PIN_PRESETS.find((x) => x.id === preset);
  if (!p || !p.groups) return custom;
  return Object.fromEntries(p.groups.map((g) => [g, true]));
}

/** The preset after `cur` in the cycle (the first one if `cur` isn't in it). */
export function nextPreset(cur: MapPinPreset, cycle: MapPinPreset[]): MapPinPreset {
  const list = MAP_PIN_PRESETS.map((p) => p.id).filter((id) => cycle.includes(id));
  if (!list.length) return cur;
  const i = list.indexOf(cur);
  return list[(i + 1) % list.length];
}

export type ActionId = "judge" | "runToggle" | "runSplit" | "clip" | "overlayEdit" | "coachSnap" | "overlayToggle" | "mapCharacter" | "snoozeJudge" | "mapPinsPreset" | "markMoment" | "flagVerdict";

export interface Settings {
  llm: { baseUrl: string; model: string; apiKey: string; thinkingForCoach: boolean };
  flaresolverr: string;
  /** the Diablo IV folder the app reads the game data from (found automatically, or picked) */
  gamePath: string;
  hotkeys: Record<ActionId, string>;
  padChords: Record<ActionId, string[]>;
  padEnabled: boolean;
  capture: { width: number; height: number; maxEdge: number; quality: number; ocrAssist: boolean; equippedCompare: boolean };
  alerts: {
    enabled: Record<EventKind, boolean>;
    leadMinutes: number[];
    sound: boolean;
    volume: number;
    toast: boolean;
    discordWebhook: string;
    discordKinds: Record<EventKind, boolean>;
    /** stay quiet (sound, toasts, Discord) while Diablo IV isn't running */
    onlyWhileGameRuns: boolean;
  };
  obs: { enabled: boolean; url: string; password: string; clipOnBis: boolean };
  overlay: {
    enabled: boolean;
    onlyWhenGameFocused: boolean;
    opacity: number;
    verdictSeconds: number;
    /** "bars": stack full-height panels inside the black pillarbox bars; "free": drag anywhere */
    layout: "bars" | "free";
    /** show the overlay in screenshots/OBS (off = excluded from capture, so our OCR never reads it) */
    capturable: boolean;
    /** detected game image bounds inside the overlay (fractions), for docking in black bars */
    gameBounds: { left: number; right: number; top: number; bottom: number } | null;
    widgets: Record<"timers" | "verdict" | "run" | "build" | "watchers" | "toasts" | "farm", WidgetPos>;
    /**
     * "bars" layout: the panels of each bar in order, top to bottom ("gap": the ones after it sit at the
     * bottom), and room kept clear at the top of the left bar for Discord's voice overlay (fraction of the height)
     */
    bars: { left: string[]; right: string[]; discord: boolean; discordRoom: number };
  };
  timers: { source: "auto" | "helltides" | "d4planner" | "local"; pollSeconds: number };
  autoJudge: {
    enabled: boolean;
    intervalMs: number;
    sounds: boolean;
    showBadge: boolean;
    alwaysUseAi: boolean;
    /** ground loot (inventory closed): hover this long before judging, badge only */
    worldDwellMs: number;
    worldBadgeSeconds: number;
    snoozeSeconds: number;
  };
  /**
   * Recognise items by their icon: one more signal for naming a unique, from the item's picture in
   * the tooltip. Needs a GPU the app can use and a one-off model download; the picture library is
   * built on this PC from the game install, and no art ever leaves it.
   */
  icons: { enabled: boolean };
  /** record every auto-judge scan with its frame and display context (test-mode log folder, capped) */
  testMode: { enabled: boolean; maxMB: number };
  /**
   * Shared judgements (opt-in): each judgement goes to the developer, with the tooltip text and crop, to
   * test the loot judge on every class, build and resolution. `installId` is random, made on opt-in and
   * replaced on "delete my data". `asked`: the Help improve step was shown (new installs and upgrades).
   */
  share: { enabled: boolean; asked: boolean; installId: string | null; since: number | null };
  /** pins on the in-game map: which kinds to draw */
  mapPins: {
    enabled: boolean;
    /** what's shown now */
    preset: MapPinPreset;
    /** the presets the hotkey / chord steps through */
    cycle: MapPinPreset[];
    /** the "Custom" preset */
    groups: Record<MapPinGroup, boolean>;
    /** hide altars and regional collectibles the map already shows as found (off: draw them faded) */
    unfoundOnly: boolean;
    /** a small chip on the map with the preset's name (it always shows for a moment after switching) */
    chip: boolean;
    /** settings version, for one-off migrations */
    v: number;
  };
  hordes: { enabled: boolean; style: "safe" | "balanced" | "greedy" };
  /** start/split/finish runs automatically from the quest tracker */
  autoRuns: boolean;
  activities: string[];
  /** activities an update added to `activities` already (each is added once, so removing it sticks) */
  activitiesAdded?: string[];
  calibration: Calibration | null;
}

export const defaultSettings: Settings = {
  llm: {
    baseUrl: "",
    model: "",
    apiKey: "",
    thinkingForCoach: false,
  },
  flaresolverr: "",
  gamePath: "",
  hotkeys: {
    judge: "F8",
    runToggle: "F9",
    runSplit: "F10",
    clip: "F11",
    overlayEdit: "CommandOrControl+Shift+O",
    overlayToggle: "CommandOrControl+Shift+H",
    coachSnap: "CommandOrControl+Shift+K",
    mapCharacter: "F7",
    snoozeJudge: "F6",
    mapPinsPreset: "Alt+M",
    // not Ctrl+Shift+D: that's Discord's deafen key (a global hotkey would swallow it)
    markMoment: "CommandOrControl+Alt+D",
    flagVerdict: "CommandOrControl+Alt+W",
  },
  padChords: {
    judge: ["View", "RS"],
    runToggle: ["View", "DPadUp"],
    runSplit: ["View", "DPadRight"],
    clip: ["View", "DPadLeft"],
    overlayEdit: [],
    overlayToggle: ["View", "DPadDown"],
    coachSnap: [],
    mapCharacter: ["View", "Y"],
    snoozeJudge: ["View", "X"],
    mapPinsPreset: ["View", "LS"],
    markMoment: ["View", "RB"],
    flagVerdict: [],
  },
  padEnabled: true,
  capture: { width: 2800, height: 0, maxEdge: 1600, quality: 88, ocrAssist: true, equippedCompare: true },
  alerts: {
    enabled: { worldBoss: true, helltide: true, legion: true, other: true },
    leadMinutes: [5, 1],
    sound: true,
    volume: 0.5,
    toast: true,
    discordWebhook: "",
    discordKinds: { worldBoss: true, helltide: false, legion: false, other: false },
    onlyWhileGameRuns: false,
  },
  obs: { enabled: false, url: "ws://127.0.0.1:4455", password: "", clipOnBis: true },
  overlay: {
    enabled: true,
    onlyWhenGameFocused: true,
    opacity: 0.92,
    verdictSeconds: 7,
    layout: "bars",
    capturable: false,
    gameBounds: null,
    widgets: {
      timers: { on: true, x: 0.012, y: 0.30, scale: 1 },
      verdict: { on: true, x: 0.40, y: 0.06, scale: 1 },
      run: { on: true, x: 0.012, y: 0.52, scale: 1 },
      build: { on: false, x: 0.80, y: 0.30, scale: 1 },
      watchers: { on: true, x: 0.80, y: 0.62, scale: 1 },
      toasts: { on: true, x: 0.40, y: 0.80, scale: 1 },
      farm: { on: false, x: 0.012, y: 0.66, scale: 1 },
    },
    bars: {
      left: ["activity", "timers", "run", "farm", "build", "gap"],
      right: ["verdict", "watchers", "toasts", "gap"],
      discord: false,
      discordRoom: 0.22,
    },
  },
  timers: { source: "auto", pollSeconds: 60 },
  hordes: { enabled: true, style: "balanced" },
  autoRuns: true,
  autoJudge: { enabled: true, intervalMs: 400, sounds: false, showBadge: true, alwaysUseAi: false, worldDwellMs: 1000, worldBadgeSeconds: 3, snoozeSeconds: 30 },
  icons: { enabled: false },
  testMode: { enabled: false, maxMB: 500 },
  share: { enabled: false, asked: false, installId: null, since: null },
  mapPins: {
    enabled: true,
    preset: "custom",
    cycle: ["custom", "collectibles", "dungeons", "quests", "helltide", "everything", "off"],
    // quiet by default: collectibles and dungeons
    groups: {
      journal: true,
      collectible: true,
      dungeon: true,
      cellar: false,
      stronghold: false,
      side_quest: false,
      helltide_chest: false,
      undercity: false,
      boss_dungeon: false,
    },
    unfoundOnly: true,
    chip: false,
    v: 2,
  },
  calibration: null,
  activities: ["The Pit", "Infernal Hordes", "The Tower", "Nightmare Dungeon", "Escalating Nightmare", "Minor Nightmare", "Horadric Strongroom", "Helltide", "World Boss", "Lair Boss", "Undercity", "Leveling"],
};

function deepMerge<T>(base: T, over: any): T {
  if (!over || typeof over !== "object" || Array.isArray(over)) return (over ?? base) as T;
  const out: any = Array.isArray(base) ? [...(base as any)] : { ...base };
  for (const k of Object.keys(over)) {
    const b = (base as any)?.[k];
    out[k] = b && typeof b === "object" && !Array.isArray(b) ? deepMerge(b, over[k]) : over[k];
  }
  return out;
}

/**
 * Map pins v2 (presets): the first map pins drew nearly everything by default, which was too busy.
 * Once, move settings still on those old defaults to the new quiet ones, and keep the new
 * hotkey / chord off any combination already used by another action.
 */
export function migrateMapPins(m: Settings, persisted: any): Settings {
  const old = persisted?.mapPins;
  if (old && !(old.v >= 2)) {
    const g = old.groups ?? {};
    const oldDefault = g.journal && g.collectible && g.dungeon && g.cellar && g.stronghold && g.side_quest && g.helltide_chest && !g.undercity && !g.boss_dungeon;
    m.mapPins = { ...m.mapPins, preset: "custom", v: 2, groups: oldDefault ? { ...defaultSettings.mapPins.groups } : m.mapPins.groups };
  }
  if (!persisted?.hotkeys?.mapPinsPreset) {
    const taken = Object.entries(m.hotkeys).some(([a, k]) => a !== "mapPinsPreset" && k && k === m.hotkeys.mapPinsPreset);
    if (taken) m.hotkeys = { ...m.hotkeys, mapPinsPreset: "" };
  }
  if (!persisted?.padChords?.mapPinsPreset) {
    const key = (c: string[]) => [...c].sort().join("+");
    const mine = key(m.padChords.mapPinsPreset);
    if (Object.entries(m.padChords).some(([a, c]) => a !== "mapPinsPreset" && c.length && key(c) === mine)) m.padChords = { ...m.padChords, mapPinsPreset: [] };
  }
  return addNewActivities(freeNewBinding(freeNewBinding(m, persisted, "markMoment"), persisted, "flagVerdict"), persisted);
}

/** Activities a release added to the list: once, after the one before them in the defaults, for lists saved earlier. */
const NEW_ACTIVITIES = ["Horadric Strongroom"];
export function addNewActivities(m: Settings, persisted: any): Settings {
  const done = new Set<string>(m.activitiesAdded ?? []);
  const todo = NEW_ACTIVITIES.filter((a) => !done.has(a));
  if (!todo.length) return m;
  const list = [...m.activities];
  // a fresh install already has them from the defaults
  if (Array.isArray(persisted?.activities))
    for (const a of todo) {
      if (list.includes(a)) continue;
      const before = defaultSettings.activities[defaultSettings.activities.indexOf(a) - 1];
      const at = list.indexOf(before);
      list.splice(at >= 0 ? at + 1 : list.length, 0, a);
    }
  return { ...m, activities: list, activitiesAdded: [...done, ...todo] };
}

/**
 * An action added in an update gets its default key and chord only if no other action already
 * uses them (otherwise it starts unbound, and the user's own binding keeps working).
 */
export function freeNewBinding(m: Settings, persisted: any, action: ActionId): Settings {
  if (persisted?.hotkeys && !persisted.hotkeys[action]) {
    const k = m.hotkeys[action];
    if (k && Object.entries(m.hotkeys).some(([a, x]) => a !== action && x === k)) m.hotkeys = { ...m.hotkeys, [action]: "" };
  }
  if (persisted?.padChords && !persisted.padChords[action]) {
    const key = (c: string[]) => [...c].sort().join("+");
    const mine = key(m.padChords[action]);
    if (mine && Object.entries(m.padChords).some(([a, c]) => a !== action && c.length && key(c) === mine)) m.padChords = { ...m.padChords, [action]: [] };
  }
  return m;
}

interface SettingsState {
  settings: Settings;
  update: (fn: (s: Settings) => void) => void;
  reset: () => void;
}

export const useSettings = create<SettingsState>()(
  persist(
    (set, get) => ({
      settings: defaultSettings,
      update: (fn) => {
        const next = structuredClone(get().settings);
        fn(next);
        set({ settings: next });
      },
      reset: () => set({ settings: defaultSettings }),
    }),
    {
      name: "settings",
      storage: persistStorage,
      merge: (persisted: any, current) => ({
        ...current,
        settings: (() => {
          // keys added later (e.g. mapPins) come from the defaults
          const m = deepMerge(defaultSettings, persisted?.settings);
          // v0.1 used a 1800×1300 box, which cut the top off tall tooltips
          if (m.capture.height === 1300 || m.capture.width === 2200) m.capture = { ...m.capture, width: 2800, height: 0 };
          // Ctrl+Shift+M is Discord's mute shortcut
          if (m.hotkeys.mapCharacter === "CommandOrControl+Shift+M") m.hotkeys = { ...m.hotkeys, mapCharacter: "F7" };
          return migrateMapPins(m, persisted?.settings);
        })(),
      }),
    },
  ),
);

// ---- builds & progress -------------------------------------------------------

interface BuildState {
  builds: Record<string, Build>;
  activeBuildId: string | null;
  activeVariantId: string | null;
  /** key: `${buildId}:${variantId}:${slot}` */
  progress: Record<string, SlotProgress>;
  /** codex / collection: slug → true */
  owned: Record<string, boolean>;
  /** last variant you picked per build (so switching builds keeps your variant) */
  variantOf: Record<string, string>;
  /** buildId → newer updatedAt seen on Mobalytics */
  updates: Record<string, string>;
  setUpdate: (id: string, at: string | null) => void;
  /**
   * last parsed tooltip of what you're wearing, per build slot. `doubt`: you put on a new ring (weapon)
   * and nothing said which of the two it replaced, so this one may be gone
   */
  worn: Record<string, ParsedItem & { at: number; doubt?: boolean }>;
  setWorn: (slot: string, item: ParsedItem) => void;
  doubtWorn: (slots: string[]) => void;
  /** the seal and charms you were last seen wearing */
  talisman: Talisman;
  setTalisman: (item: ParsedItem) => void;
  addBuild: (b: Build, variant?: string) => void;
  removeBuild: (id: string) => void;
  setActive: (buildId: string, variantId?: string) => void;
  setProgress: (slot: string, p: Partial<SlotProgress>) => void;
  toggleOwned: (slug: string, v?: boolean) => void;
}

export const emptyProgress: SlotProgress = { state: "missing", greater: [], have: [], tempered: false, masterwork: 0 };

export const emptyTalisman: Talisman = { seal: null, charms: [] };

const isSeal = (item: ParsedItem) => /seal/i.test(`${item.itemType} ${item.slot}`);

/** A seal replaces the one you wore; a charm joins the ones you wear (at most 6, the newest kept). */
export function rememberTalisman(t: Talisman, item: ParsedItem): Talisman {
  // the text stays: a seal's "Unlocks 6 Charm Slots" is in it
  const seen = { ...item, at: Date.now() };
  if (isSeal(item)) return { ...t, seal: seen };
  const same = (c: ParsedItem) => c.name.trim().toLowerCase() === item.name.trim().toLowerCase();
  return { ...t, charms: [seen, ...t.charms.filter((c) => !same(c))].slice(0, 6) };
}

export const useBuilds = create<BuildState>()(
  persist(
    (set, get) => ({
      builds: {},
      activeBuildId: null,
      activeVariantId: null,
      progress: {},
      owned: {},
      variantOf: {},
      updates: {},
      setUpdate: (id, at) => set((s) => { const updates = { ...s.updates }; if (at) updates[id] = at; else delete updates[id]; return { updates }; }),
      worn: {},
      setWorn: (slot, item) => set((s) => ({ worn: { ...s.worn, [slot]: { ...item, rawText: undefined, at: Date.now() } } })),
      doubtWorn: (slots) => set((s) => ({ worn: Object.fromEntries(Object.entries(s.worn).map(([k, w]) => [k, slots.includes(k) ? { ...w, doubt: true } : w])) })),
      talisman: emptyTalisman,
      setTalisman: (item) => set((s) => ({ talisman: rememberTalisman(s.talisman ?? emptyTalisman, item) })),
      addBuild: (b, variant) =>
        set((s) => ({
          builds: { ...s.builds, [b.id]: b },
          activeBuildId: b.id,
          activeVariantId:
            (variant && b.variants.find((v) => v.id === variant)?.id) ??
            (s.activeBuildId === b.id ? s.activeVariantId : null) ??
            b.variants[b.variants.length - 1]?.id ??
            null,
        })),
      removeBuild: (id) =>
        set((s) => {
          const builds = { ...s.builds };
          delete builds[id];
          const nextId = s.activeBuildId === id ? Object.keys(builds)[0] ?? null : s.activeBuildId;
          return { builds, activeBuildId: nextId, activeVariantId: nextId ? builds[nextId].variants[0]?.id ?? null : null };
        }),
      setActive: (buildId, variantId) =>
        set((s) => {
          const v = variantId ?? s.variantOf[buildId] ?? s.builds[buildId]?.variants[s.builds[buildId].variants.length - 1]?.id ?? null;
          return { activeBuildId: buildId, activeVariantId: v, variantOf: v ? { ...s.variantOf, [buildId]: v } : s.variantOf };
        }),
      setProgress: (slot, p) => {
        const { activeBuildId, activeVariantId } = get();
        if (!activeBuildId || !activeVariantId) return;
        const key = `${activeBuildId}:${activeVariantId}:${slot}`;
        set((s) => ({ progress: { ...s.progress, [key]: { ...emptyProgress, ...s.progress[key], ...p } } }));
      },
      toggleOwned: (slug, v) => set((s) => ({ owned: { ...s.owned, [slug]: v ?? !s.owned[slug] } })),
    }),
    { name: "builds", storage: persistStorage },
  ),
);

export function useActiveVariant() {
  const { builds, activeBuildId, activeVariantId } = useBuilds();
  const build = activeBuildId ? builds[activeBuildId] : undefined;
  const variant = build?.variants.find((v) => v.id === activeVariantId) ?? build?.variants[0];
  return { build, variant };
}

export function getActiveVariant() {
  const { builds, activeBuildId, activeVariantId, progress } = useBuilds.getState();
  const build = activeBuildId ? builds[activeBuildId] : undefined;
  const variant = build?.variants.find((v) => v.id === activeVariantId) ?? build?.variants[0];
  const prog = (slot: string): SlotProgress =>
    (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
  return { build, variant, prog };
}

// ---- character profiles ------------------------------------------------------
// One per character (see profiles.ts). The active character's builds and gear live in useBuilds and
// its mapped stats in useCharacter; the other characters' are kept here until you play them again.

/** One character's builds and gear: what useBuilds holds while that character is active. */
export type GearData = Pick<BuildState, "builds" | "activeBuildId" | "activeVariantId" | "progress" | "variantOf" | "worn" | "talisman">;

/** The active character's builds and gear, as they go into its profile. */
export const liveGear = (): GearData => {
  const s = useBuilds.getState();
  return { builds: s.builds, activeBuildId: s.activeBuildId, activeVariantId: s.activeVariantId, progress: s.progress, variantOf: s.variantOf, worn: s.worn, talisman: s.talisman };
};

export const emptyGear = (): GearData => ({ builds: {}, activeBuildId: null, activeVariantId: null, progress: {}, variantOf: {}, worn: {}, talisman: emptyTalisman });

export interface Profile {
  id: string;
  /** the character's name as read in game ("Bazaq"); "" until it's been read */
  name: string;
  /** the class when no build says it (from the skills read in game) */
  className: string;
  createdAt: number;
  seenAt: number;
  /** its builds and gear while another character is active (null for the active one: they're in useBuilds) */
  gear: GearData | null;
  /** its mapped stats, skills and glyphs while another character is active (null for the active one) */
  sheet: CharacterProfile | null;
}

interface ProfileState {
  profiles: Record<string, Profile>;
  activeId: string;
}

/** The profile everything saved before 0.3.0 belongs to (named the first time a name is read). */
export const FIRST_PROFILE = "first";

export const newProfile = (id: string, name: string): Profile => ({ id, name, className: "", createdAt: Date.now(), seenAt: Date.now(), gear: null, sheet: null });

/**
 * Saved profiles, or (first run of 0.3.0, or a fresh install) one unnamed profile for the builds,
 * gear and stats already saved: they stay where they are, as that profile's live data.
 */
export function withFirstProfile(persisted: any): ProfileState {
  const saved: Record<string, Profile> | undefined = persisted?.profiles;
  const profiles = saved && Object.keys(saved).length ? saved : { [FIRST_PROFILE]: newProfile(FIRST_PROFILE, "") };
  const activeId = profiles[persisted?.activeId] ? (persisted.activeId as string) : Object.keys(profiles)[0];
  return { profiles, activeId };
}

export const useProfiles = create<ProfileState>()(
  persist(() => withFirstProfile(null), {
    name: "profiles",
    storage: persistStorage,
    version: 1,
    merge: (persisted, current) => ({ ...current, ...withFirstProfile(persisted) }),
  }),
);

// names never leave this computer: shared judgements drop every line with one (privacy.ts)
const shareNames = (s: ProfileState) => setCharacterNames(Object.values(s.profiles).map((p) => p.name));
shareNames(useProfiles.getState());
useProfiles.subscribe(shareNames);

// ---- build library -----------------------------------------------------------
// Every build you imported is in the library (library.ts). A build a character plays lives in that
// character's own gear; this store keeps the ones no character has yet, with the variant you picked and
// the progress they carried, so a build for a class you don't play yet waits here instead of taking over.

interface LibraryState {
  builds: Record<string, Build>;
  /** the variant picked for a library build, so it comes back with it */
  variantOf: Record<string, string>;
  /** progress of a build that was on a character: `${buildId}:${variantId}:${slot}` */
  progress: Record<string, SlotProgress>;
  add: (b: Build, variantId?: string | null, progress?: Record<string, SlotProgress>) => void;
  remove: (...ids: string[]) => void;
}

export const useLibrary = create<LibraryState>()(
  persist(
    (set) => ({
      builds: {},
      variantOf: {},
      progress: {},
      add: (b, variantId, progress) =>
        set((s) => ({
          builds: { ...s.builds, [b.id]: b },
          variantOf: variantId ? { ...s.variantOf, [b.id]: variantId } : s.variantOf,
          progress: { ...s.progress, ...progress },
        })),
      remove: (...ids) =>
        set((s) => {
          const builds = { ...s.builds };
          const variantOf = { ...s.variantOf };
          for (const id of ids) {
            delete builds[id];
            delete variantOf[id];
          }
          return { builds, variantOf, progress: Object.fromEntries(Object.entries(s.progress).filter(([k]) => !ids.includes(k.split(":")[0]))) };
        }),
    }),
    { name: "library", storage: persistStorage },
  ),
);

// ---- loot history ------------------------------------------------------------

interface LootState {
  history: JudgeResult[];
  /** newest first; `replaces` drops that older row (the same item judged again moves to the top) */
  add: (r: JudgeResult, replaces?: string) => void;
  patch: (id: string, p: Partial<JudgeResult>) => void;
  clear: () => void;
}

export const useLoot = create<LootState>()(
  persist(
    (set) => ({
      history: [],
      add: (r, replaces) => set((s) => ({ history: [r, ...s.history.filter((h) => h.id !== replaces)].slice(0, 80) })),
      patch: (id, p) => set((s) => ({ history: s.history.map((h) => (h.id === id ? { ...h, ...p } : h)) })),
      clear: () => set({ history: [] }),
    }),
    { name: "loot", storage: persistStorage },
  ),
);

// ---- runs --------------------------------------------------------------------

interface RunState {
  runs: Run[];
  active: Run | null;
  activity: string;
  tier: string;
  setActivity: (a: string, tier?: string) => void;
  start: () => void;
  /** `at`: when it happened, if before now; `from`: an event inside the run (its own timer), not a step of it */
  split: (label?: string, opts?: { at?: number; from?: number }) => void;
  /** `at`: when the run really ended, if that was before now */
  stop: (success?: boolean, at?: number) => void;
  toggle: () => void;
  addDeath: () => void;
  update: (id: string, p: Partial<Run>) => void;
  remove: (id: string) => void;
}

export const useRuns = create<RunState>()(
  persist(
    (set, get) => ({
      runs: [],
      active: null,
      activity: "The Pit",
      tier: "",
      setActivity: (activity, tier) => set((s) => ({ activity, tier: tier ?? s.tier })),
      start: () =>
        set((s) => ({
          active: { id: crypto.randomUUID(), activity: s.activity, tier: s.tier, start: Date.now(), splits: [], deaths: 0, character: useProfiles.getState().activeId },
        })),
      split: (label, opts) =>
        set((s) =>
          s.active
            ? {
                active: {
                  ...s.active,
                  splits: [
                    ...s.active.splits,
                    { label: label ?? `Split ${s.active.splits.length + 1}`, at: Math.max(s.active.start, Math.min(opts?.at ?? Date.now(), Date.now())), ...(opts?.from != null ? { from: Math.max(s.active.start, opts.from) } : {}) },
                  ],
                },
              }
            : {},
        ),
      stop: (success = true, at) =>
        set((s) => (s.active ? { runs: [{ ...s.active, end: Math.max(s.active.start, Math.min(at ?? Date.now(), Date.now())), success }, ...s.runs].slice(0, 2000), active: null } : {})),
      toggle: () => (get().active ? get().stop(true) : get().start()),
      addDeath: () => set((s) => (s.active ? { active: { ...s.active, deaths: (s.active.deaths ?? 0) + 1 } } : {})),
      update: (id, p) => set((s) => ({ runs: s.runs.map((r) => (r.id === id ? { ...r, ...p } : r)) })),
      remove: (id) => set((s) => ({ runs: s.runs.filter((r) => r.id !== id) })),
    }),
    { name: "runs", storage: persistStorage },
  ),
);

// ---- screen region watchers -------------------------------------------------------

export interface Watcher {
  id: string;
  name: string;
  enabled: boolean;
  rect: { x: number; y: number; w: number; h: number };
  intervalMs: number;
  ocrScale: number;
  mode: "number" | "text" | "scene";
  /** scene mode: reference fingerprint + max hamming distance (of 128 bits) */
  scene?: { hash: string; luma: number; maxDistance: number };
  /** regex the OCR text must match to "fire" (text mode) */
  pattern: string;
  /** number mode: fire when value op threshold */
  op: ">=" | "<=" | "==" | "change";
  threshold: number;
  action: "show" | "alert" | "death" | "runSplit" | "runStop" | "runStart" | "judgeHint";
  cooldownMs: number;
  onlyWhenGameFocused: boolean;
}

export interface WatcherValue {
  text: string;
  /** scene mode: current distance to the reference */
  distance?: number;
  value: number | null;
  at: number;
  fired?: number;
  error?: string;
}

interface WatcherState {
  watchers: Watcher[];
  values: Record<string, WatcherValue>;
  deaths: { at: number; text: string; activity?: string }[];
  upsert: (w: Watcher) => void;
  remove: (id: string) => void;
  setValue: (id: string, v: WatcherValue) => void;
  logDeath: (text: string, activity?: string) => void;
  clearDeaths: () => void;
}

export const useWatchers = create<WatcherState>()(
  persist(
    (set) => ({
      watchers: [],
      values: {},
      deaths: [],
      upsert: (w) =>
        set((s) => {
          const i = s.watchers.findIndex((x) => x.id === w.id);
          const watchers = [...s.watchers];
          if (i >= 0) watchers[i] = w;
          else watchers.push(w);
          return { watchers };
        }),
      remove: (id) => set((s) => ({ watchers: s.watchers.filter((w) => w.id !== id) })),
      setValue: (id, v) => set((s) => ({ values: { ...s.values, [id]: v } })),
      logDeath: (text, activity) => set((s) => ({ deaths: [{ at: Date.now(), text, activity }, ...s.deaths].slice(0, 500) })),
      clearDeaths: () => set({ deaths: [] }),
    }),
    { name: "watchers", storage: persistStorage, partialize: (s) => ({ watchers: s.watchers, deaths: s.deaths }) as any },
  ),
);

// ---- coach chat -------------------------------------------------------------

export interface CoachMsg {
  role: "user" | "assistant";
  text: string;
  image?: string;
  at: number;
}

interface CoachState {
  messages: CoachMsg[];
  pendingImage: string | null;
  push: (m: CoachMsg) => void;
  patchLast: (text: string) => void;
  setPendingImage: (img: string | null) => void;
  clear: () => void;
}

export const useCoach = create<CoachState>()(
  persist(
    (set) => ({
      messages: [],
      pendingImage: null,
      push: (m) => set((s) => ({ messages: [...s.messages, m].slice(-60) })),
      patchLast: (text) =>
        set((s) => {
          const messages = [...s.messages];
          if (messages.length) messages[messages.length - 1] = { ...messages[messages.length - 1], text };
          return { messages };
        }),
      setPendingImage: (pendingImage) => set({ pendingImage }),
      clear: () => set({ messages: [] }),
    }),
    {
      name: "coach",
      storage: persistStorage,
      // don't persist screenshots — they'd bloat the store file
      partialize: (s) => ({ messages: s.messages.map((m) => ({ ...m, image: undefined })) }) as any,
    },
  ),
);
