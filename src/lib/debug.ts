// Debug system (main window). Lets a developer see what the app is doing and what it thinks the
// game state is, from files on disk:
//   <app log dir>/debug/state.json                live snapshot, every 2 s (test mode)
//   <app log dir>/debug/events-YYYY-MM-DD.jsonl   decision log, JSON Lines (test mode)
//   <app log dir>/debug/marks/<time>/             "mark this moment" (hotkey; works with test mode off)
// The last ~90 s of events are always kept in memory so a mark has context. Everything stays
// local; the debug report zip is only built when the user asks for it, and never uploaded.
// Pure helpers (ring buffer, rotation, truncation, redaction) live in debugcore.ts.
import { invoke } from "@tauri-apps/api/core";
import { emitOverlay, onMain } from "./bus";
import {
  EventRing,
  currentPart,
  dayKey,
  eventLine,
  eventsFileKey,
  eventsFileName,
  installDebugHooks,
  issueUrl,
  markStamp,
  planEventsPrune,
  planMarksPrune,
  redactSettings,
  scrub,
  secretValues,
  splitBudget,
  truncate,
  EVENTS_PART_BYTES,
  type DebugEvent,
  type OverlayRender,
} from "./debugcore";
import { isTauri } from "./http";
import { captureMonitor, captureRegion } from "./native";
import { useProfiles, useSettings, type Settings } from "./store";
import { APP_VERSION } from "./version";

export const DEBUG_DIR = "debug";
const MARKS_DIR = `${DEBUG_DIR}/marks`;
// about 1.6 MB each; 30 filled up in half an hour of a busy test session (2026-10-15)
const MARK_KEEP = 100;
const MARK_WINDOW_MS = 90_000;

const ring = new EventRing(MARK_WINDOW_MS, 3000);
const errors: DebugEvent[] = [];
const listeners = new Set<(e: DebugEvent) => void>();
let pending: string[] = [];

const testOn = () => isTauri && useSettings.getState().settings.testMode.enabled;
// your characters' names too (as the app writes them and as the panel shows them): a debug report never carries them
const names = () => Object.values(useProfiles.getState().profiles).flatMap((p) => (p.name.length >= 2 ? [p.name, p.name.toUpperCase()] : []));
const secrets = () => [...secretValues(useSettings.getState().settings), ...names()];

// ---- events ---------------------------------------------------------------------------------

/**
 * Record one decision. Always goes to the in-memory ring (for marks and the Debug page); written
 * to the day's events file only in test mode. Keep `data` short: a few fields, no images.
 */
export function debugEvent(src: string, type: string, data?: unknown) {
  const e: DebugEvent = { ts: Date.now(), src, type, data: data === undefined ? undefined : truncate(data, { str: 300, arr: 12, depth: 4 }) };
  ring.push(e);
  if (src === "error") {
    errors.push(e);
    if (errors.length > 20) errors.shift();
  }
  if (listeners.size) listeners.forEach((l) => l(e));
  if (!testOn()) return;
  pending.push(eventLine(e, secrets()));
}

const lastEvery = new Map<string, { at: number; skipped: number }>();
/** Like debugEvent, but at most once per `ms` for `key`; the next one carries how many were skipped. */
export function debugEventEvery(key: string, ms: number, src: string, type: string, data?: Record<string, unknown>) {
  const now = Date.now();
  const l = lastEvery.get(key);
  if (l && now - l.at < ms) {
    l.skipped++;
    return;
  }
  lastEvery.set(key, { at: now, skipped: 0 });
  debugEvent(src, type, l?.skipped ? { ...data, repeated: l.skipped } : data);
}

/** Live events for the Debug page. */
export function onDebugEvent(fn: (e: DebugEvent) => void) {
  listeners.add(fn);
  return () => void listeners.delete(fn);
}

export const recentEvents = () => ring.all();
export const recentErrors = () => [...errors];

// ---- event file writer ----------------------------------------------------------------------

let writer = { day: "", part: 0, size: 0 };
let flushing = false;
let lastPrune = 0;

async function listDebug(path = DEBUG_DIR) {
  return invoke<{ dir: string; entries: { name: string; size: number; modified: number; dir: boolean }[] }>("debug_list", { path });
}

async function flush() {
  if (flushing || !pending.length) return;
  if (!testOn()) {
    pending = [];
    return;
  }
  flushing = true;
  const lines = pending;
  pending = [];
  try {
    const now = new Date();
    const day = dayKey(now);
    if (writer.day !== day) {
      const { entries } = await listDebug();
      writer = { day, ...currentPart(entries.filter((e) => !e.dir), day) };
    }
    const text = lines.join("\n") + "\n";
    await invoke("debug_file_write", { path: `${DEBUG_DIR}/${eventsFileName(now, writer.part)}`, text, append: true });
    writer.size += text.length;
    if (writer.size >= EVENTS_PART_BYTES) writer = { day, part: writer.part + 1, size: 0 };
    if (Date.now() - lastPrune > 60_000) {
      lastPrune = Date.now();
      await pruneEvents();
    }
  } catch {
    /* the next flush tries again (lines from this one are dropped rather than piling up) */
  } finally {
    flushing = false;
  }
}

async function pruneEvents() {
  const { eventsMB } = splitBudget(useSettings.getState().settings.testMode.maxMB);
  const { entries } = await listDebug();
  const files = entries.filter((e) => !e.dir && eventsFileKey(e.name));
  for (const name of planEventsPrune(files, eventsMB * 1024 * 1024)) await invoke("debug_remove", { path: `${DEBUG_DIR}/${name}` }).catch(() => {});
}

// ---- overlay render state -------------------------------------------------------------------

let overlayRender: (OverlayRender & { receivedAt: number }) | null = null;
const overlayWaiters: ((r: OverlayRender | null) => void)[] = [];
let viewers = 0;

/** The overlay reports what it draws while test mode is on or the Debug page is open (else only on request). */
export const debugWanted = () => testOn() || viewers > 0;
export const getOverlayRender = () => overlayRender;

/** The Debug page is showing: ask the overlay for live render reports. */
export function watchDebug() {
  viewers++;
  return () => void (viewers = Math.max(0, viewers - 1));
}

/** Ask the overlay what it is drawing right now (falls back to its last report). */
export function requestOverlayRender(timeoutMs = 600): Promise<OverlayRender | null> {
  if (!isTauri) return Promise.resolve(overlayRender);
  return new Promise((resolve) => {
    const done = (r: OverlayRender | null) => {
      clearTimeout(t);
      resolve(r);
    };
    const t = setTimeout(() => {
      const i = overlayWaiters.indexOf(done);
      if (i >= 0) overlayWaiters.splice(i, 1);
      resolve(overlayRender);
    }, timeoutMs);
    overlayWaiters.push(done);
    emitOverlay("debug-request", true);
  });
}

// ---- state snapshot -------------------------------------------------------------------------

function settingsSummary(s: Settings) {
  const o = s.overlay;
  return {
    overlay: {
      enabled: o.enabled,
      layout: o.layout,
      opacity: o.opacity,
      capturable: o.capturable,
      onlyWhenGameFocused: o.onlyWhenGameFocused,
      verdictSeconds: o.verdictSeconds,
      gameBounds: o.gameBounds,
      widgets: Object.fromEntries(Object.entries(o.widgets).map(([k, w]) => [k, w.on ? `on @ ${w.x.toFixed(3)},${w.y.toFixed(3)} x${w.scale}` : "off"])),
    },
    autoJudge: s.autoJudge,
    testMode: s.testMode,
    mapPins: {
      enabled: s.mapPins.enabled,
      preset: s.mapPins.preset,
      cycle: s.mapPins.cycle,
      chip: s.mapPins.chip,
      unfoundOnly: s.mapPins.unfoundOnly,
      customGroups: Object.entries(s.mapPins.groups).filter(([, v]) => v).map(([k]) => k),
    },
    hordes: s.hordes,
    autoRuns: s.autoRuns,
    hotkeys: s.hotkeys,
    padChords: Object.fromEntries(Object.entries(s.padChords).map(([k, c]) => [k, c.join("+")])),
    padEnabled: s.padEnabled,
    llm: { configured: !!s.llm.baseUrl, model: s.llm.model, apiKey: s.llm.apiKey ? "[redacted]" : "" },
    obs: { enabled: s.obs.enabled, clipOnBis: s.obs.clipOnBis },
    alerts: { sound: s.alerts.sound, toast: s.alerts.toast, volume: s.alerts.volume, leadMinutes: s.alerts.leadMinutes, discord: !!s.alerts.discordWebhook },
    timers: s.timers,
    capture: s.capture,
    calibrated: s.calibration ? new Date(s.calibration.at).toISOString() : null,
  };
}

let display: { at: number; value: unknown } = { at: 0, value: null };
const started = Date.now();

/** Everything the app currently believes, in one readable object (no images, short strings). */
export async function collectState(): Promise<Record<string, unknown>> {
  const [{ useRuntime }, aj, act, hr, mp, sb, tm, gd] = await Promise.all([
    import("./engine"),
    import("./autojudge"),
    import("./activity"),
    import("./hordesRunner"),
    import("./mapPinsRunner"),
    import("./skillbar"),
    import("./testmode"),
    import("./guide"),
  ]);
  const s = useSettings.getState().settings;
  const rt = useRuntime.getState();
  // monitors and window mode change rarely: refresh every 10 s
  if (isTauri && Date.now() - display.at > 10_000) display = { at: Date.now(), value: await tm.displayContext().catch((e) => ({ error: String(e) })) };
  const sbl = sb.useSkillBar.getState().last;
  const g = gd.useGuide.getState();
  const state = {
    time: new Date().toISOString(),
    localTime: new Date().toString(),
    uptimeS: Math.round((Date.now() - started) / 1000),
    app: { version: APP_VERSION, testMode: s.testMode.enabled, userAgent: typeof navigator !== "undefined" ? navigator.userAgent : "" },
    settings: settingsSummary(s),
    game: { status: rt.game, display: display.value },
    activity: act.activityDebug(),
    hordes: hr.hordesState(),
    autojudge: aj.autojudgeDebug(),
    mapPins: { ...mp.useMapPins.getState().status, preset: s.mapPins.preset, enabled: s.mapPins.enabled },
    skillBar: sbl && {
      at: new Date(sbl.at).toISOString(),
      ok: sbl.ok,
      error: sbl.error,
      onBar: sbl.onBar.map((x) => `${x.name} (${x.score.toFixed(2)})`),
      missing: sbl.missing.map((x) => x.name),
    },
    guide: g.active ? { flow: g.flow, title: g.title, step: g.step, steps: g.steps, instruction: g.instruction, busy: g.busy } : { active: false },
    llm: rt.llm && { ...rt.llm, checkedAt: new Date(rt.llm.checkedAt).toISOString() },
    liveTimers: rt.live && { ...rt.live, fetchedAt: new Date(rt.live.fetchedAt).toISOString() },
    runtime: { judging: rt.judging, overlayEdit: rt.overlayEdit, overlayHidden: rt.overlayHidden, hotkeyErrors: rt.hotkeyErrors, padHeld: rt.lastPad, update: rt.update?.version ?? null },
    overlay: overlayRender && { ...overlayRender, ageMs: Date.now() - overlayRender.receivedAt },
    events: { inMemory: ring.size, windowS: MARK_WINDOW_MS / 1000 },
    errors: errors.slice(-20).map((e) => ({ ts: new Date(e.ts).toISOString(), type: e.type, data: e.data })),
  };
  return truncate(state, { str: 300, arr: 30, depth: 8, keys: 80 }) as Record<string, unknown>;
}

/** Pretty JSON with secrets scrubbed, as written to state.json. */
export const stateJson = (state: unknown) => scrub(JSON.stringify(state, null, 2), secrets());

let writingState = false;
async function writeState() {
  if (writingState || !testOn()) return;
  writingState = true;
  try {
    const text = stateJson(await collectState());
    await invoke("debug_file_write", { path: `${DEBUG_DIR}/state.json`, text });
  } catch {
    /* e.g. the file is open in an editor that locks it: next tick */
  } finally {
    writingState = false;
  }
}

// ---- marks ----------------------------------------------------------------------------------

let marking = false;
const markListeners = new Set<() => void>();
export function onMarksChanged(fn: () => void) {
  markListeners.add(fn);
  return () => void markListeners.delete(fn);
}

/**
 * "Mark this moment": the game window at full resolution, the state, the last 90 s of events and
 * the overlay's render state, saved to debug/marks/<time>/. Works with test mode off.
 */
export async function markMoment(): Promise<string | null> {
  if (!isTauri || marking) return null;
  marking = true;
  const at = new Date();
  const name = markStamp(at);
  const dir = `${MARKS_DIR}/${name}`;
  debugEvent("debug", "mark", { name });
  try {
    const { useRuntime } = await import("./engine");
    const rect = useRuntime.getState().game?.rect;
    const shot = (rect ? captureRegion({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] }, { maxEdge: 0, quality: 90 }) : captureMonitor(undefined, { maxEdge: 0, quality: 90 })).catch((e) => {
      debugEvent("debug", "mark-screenshot-failed", { error: String(e) });
      return null;
    });
    const [cap, overlay] = await Promise.all([shot, requestOverlayRender(600)]);
    const state = await collectState();
    const s = secrets();
    const events = ring.since(at.getTime() - MARK_WINDOW_MS).map((e) => eventLine(e, s)).join("\n") + "\n";
    const write = (file: string, args: { text?: string; base64?: string }) => invoke("debug_file_write", { path: `${dir}/${file}`, ...args });
    await Promise.all([
      cap ? write("screenshot.jpg", { base64: cap.image }) : Promise.resolve(),
      write("state.json", { text: stateJson(state) }),
      write("events.jsonl", { text: events }),
      write("overlay.json", { text: scrub(JSON.stringify(overlay ?? { note: "the overlay did not report (is it running?)" }, null, 2), s) }),
    ]);
    const { entries } = await listDebug(MARKS_DIR);
    for (const old of planMarksPrune(entries.filter((e) => e.dir).map((e) => e.name), MARK_KEEP)) await invoke("debug_remove", { path: `${MARKS_DIR}/${old}` }).catch(() => {});
    const { overlayToast } = await import("./alerts");
    overlayToast("Moment saved", "Add a note on the Debug page.", "#8fd3c7", 2500);
    markListeners.forEach((l) => l());
    return name;
  } catch (e) {
    debugEvent("error", "mark-failed", { error: String(e) });
    const { overlayToast } = await import("./alerts");
    overlayToast("Couldn't save the moment", String(e).slice(0, 120), "#e0543c");
    return null;
  } finally {
    marking = false;
  }
}

export interface MarkInfo {
  name: string;
  path: string;
  at: number;
  files: string[];
  note: string;
}

/** Saved marks, newest first, with their notes. */
export async function listMarks(): Promise<MarkInfo[]> {
  if (!isTauri) return [];
  const { dir, entries } = await listDebug(MARKS_DIR);
  const marks = entries.filter((e) => e.dir).sort((a, b) => (a.name < b.name ? 1 : -1));
  return Promise.all(
    marks.map(async (m) => {
      const { entries: files } = await listDebug(`${MARKS_DIR}/${m.name}`);
      const note = files.some((f) => f.name === "note.txt") ? await invoke<string>("debug_file_read", { path: `${MARKS_DIR}/${m.name}/note.txt` }).catch(() => "") : "";
      return { name: m.name, path: `${dir}\\${m.name}`, at: m.modified, files: files.map((f) => f.name), note };
    }),
  );
}

export async function saveMarkNote(name: string, note: string) {
  await invoke("debug_file_write", { path: `${MARKS_DIR}/${name}/note.txt`, text: scrub(note, secrets()) });
  markListeners.forEach((l) => l());
}

/** Open the debug folder (or a folder inside it) in Explorer. */
export const openDebugFolder = (sub = "") => invoke<string>("open_log_folder", { path: sub ? `${DEBUG_DIR}/${sub}` : DEBUG_DIR });

// ---- debug report ---------------------------------------------------------------------------

interface ReportEntry {
  zip: string;
  text?: string;
  src?: string;
  tail?: number;
}

export interface ReportPlan {
  entries: ReportEntry[];
  /** what's in it, in plain words */
  summary: string[];
  images: number;
}

const isImage = (n: string) => /\.(jpe?g|png)$/i.test(n);

/** Newest files of a log folder (by modified time), JSON records and optionally their frames. */
async function newestFiles(folder: string, records: number, images: boolean) {
  const { entries } = await listDebug(folder).catch(() => ({ entries: [] as { name: string; size: number; modified: number; dir: boolean }[] }));
  const json = entries.filter((e) => !e.dir && e.name.endsWith(".json")).sort((a, b) => b.modified - a.modified).slice(0, records);
  const stems = new Set(json.map((j) => j.name.replace(/\.json$/, "")));
  const imgs = images ? entries.filter((e) => !e.dir && isImage(e.name) && [...stems].some((s) => e.name.startsWith(s))) : [];
  return [...json, ...imgs].map((f) => ({ zip: `${folder}/${f.name}`, src: `${folder}/${f.name}` }));
}

/** Work out what goes into the report (nothing is written yet). */
export async function planReport(includeImages: boolean, note = ""): Promise<ReportPlan> {
  const s = useSettings.getState().settings;
  const sec = secrets();
  const entries: ReportEntry[] = [];
  const summary: string[] = [];
  const text = note.trim().slice(0, 4000);
  if (text) {
    entries.push({ zip: "note.txt", text: scrub(text, sec) + "\n" });
    summary.push("your note");
  }
  entries.push({ zip: "state.json", text: stateJson(await collectState()) });
  summary.push("current state (state.json)");
  entries.push({ zip: "settings.json", text: scrub(JSON.stringify(redactSettings(s), null, 2), sec) });
  summary.push("settings (LLM address, API key, Discord webhook and OBS password removed)");
  const mem = ring.all().map((e) => eventLine(e, sec));
  entries.push({ zip: "events-recent.jsonl", text: mem.join("\n") + "\n" });
  summary.push(`the last ${Math.round(MARK_WINDOW_MS / 1000)} s of events (${mem.length})`);
  if (isTauri) {
    const { entries: dbg } = await listDebug().catch(() => ({ entries: [] as { name: string; size: number; modified: number; dir: boolean }[] }));
    const evFiles = dbg.filter((e) => !e.dir && eventsFileKey(e.name)).sort((a, b) => (a.name < b.name ? 1 : -1)).slice(0, 2);
    // the newest event log (up to 4 MB each), from test mode
    for (const f of evFiles) entries.push({ zip: `events/${f.name}`, src: `${DEBUG_DIR}/${f.name}`, tail: 4 * 1024 * 1024 });
    if (evFiles.length) summary.push(`event log from test mode (${evFiles.map((f) => f.name).join(", ")}, last 4 MB of each)`);
    const marks = (await listMarks().catch(() => [] as MarkInfo[])).slice(0, 5);
    for (const m of marks) for (const f of m.files) if (includeImages || !isImage(f)) entries.push({ zip: `marks/${m.name}/${f}`, src: `${MARKS_DIR}/${m.name}/${f}` });
    if (marks.length) summary.push(`the ${marks.length} newest marked moments${includeImages ? " with screenshots" : ""}`);
    const judge = await newestFiles("judge-log", 30, includeImages);
    if (judge.length) summary.push(`recent loot judgments (${judge.filter((j) => j.zip.endsWith(".json")).length})`);
    const test = await newestFiles("test-mode", 60, includeImages);
    if (test.length) summary.push(`test-mode records (${test.filter((j) => j.zip.endsWith(".json")).length})`);
    entries.push(...judge, ...test);
  }
  const images = entries.filter((e) => isImage(e.zip)).length;
  summary.push(includeImages ? `${images} screenshots (they can show your character name or BattleTag)` : "no screenshots");
  return { entries, summary, images };
}

const osTag = () => (typeof navigator !== "undefined" ? navigator.userAgent.match(/Windows NT [\d.]+/)?.[0] : undefined);

/** Build the zip in Downloads and show it in Explorer, with a pre-filled GitHub issue link to attach it to. */
export async function saveReport(includeImages: boolean, note = ""): Promise<{ path: string; url: string; summary: string[] }> {
  const plan = await planReport(includeImages, note);
  const name = `sanctuary-debug-${markStamp(new Date())}`;
  const path = await invoke<string>("debug_report", { name, entries: plan.entries });
  const zipName = path.split(/[\\/]/).pop() ?? `${name}.zip`;
  const url = issueUrl({ version: APP_VERSION, zipName, included: plan.summary, os: osTag(), note });
  debugEvent("debug", "report", { zip: zipName, files: plan.entries.length, images: includeImages, sent: false });
  const opener = await import("@tauri-apps/plugin-opener");
  await opener.revealItemInDir(path).catch(() => {});
  return { path, url, summary: plan.summary };
}

export type SendResult =
  | { sent: true; id: string; url: string; summary: string[] }
  | { sent: false; error: string; path: string; url: string; summary: string[] };

/**
 * Send the report to the developer: the zip is built in the app's own folder and uploaded to the
 * report service (a Cloudflare Worker; the app holds no storage keys). If that fails, the zip is
 * saved to Downloads instead, to attach to a GitHub issue.
 */
export async function sendReport(includeImages: boolean, note = ""): Promise<SendResult> {
  const plan = await planReport(includeImages, note);
  const name = `sanctuary-debug-${markStamp(new Date())}`;
  try {
    const staged = await invoke<string>("debug_report", { name, entries: plan.entries, staging: true });
    const id = await invoke<string>("debug_report_upload", { path: staged, screenshots: includeImages });
    debugEvent("debug", "report", { id, files: plan.entries.length, images: includeImages, sent: true });
    return { sent: true, id, url: issueUrl({ version: APP_VERSION, reportId: id, included: plan.summary, os: osTag(), note }), summary: plan.summary };
  } catch (e) {
    const error = String((e as Error)?.message ?? e);
    debugEvent("debug", "report-upload-failed", { error });
    const saved = await saveReport(includeImages, note);
    return { sent: false, error, path: saved.path, url: saved.url, summary: plan.summary };
  }
}

// ---- start ----------------------------------------------------------------------------------

/** Errors, unhandled rejections and console warnings of this window go into the event log. */
export function installMainDebugHooks() {
  installDebugHooks((type, data) => debugEvent("error", type, data));
}

let running = false;
export function startDebug() {
  if (running || !isTauri) return;
  running = true;
  installMainDebugHooks();
  setInterval(flush, 500);
  setInterval(writeState, 2000);
  onMain<OverlayRender>("overlay-debug", (r) => {
    overlayRender = { ...r, receivedAt: Date.now() };
    overlayWaiters.splice(0).forEach((w) => w(r));
  });
  onMain<{ src?: string; type: string; data?: unknown }>("debug-event", (e) => debugEvent(e.src ?? "overlay", e.type, e.data));
  // test mode on/off and map pin presets (hotkey, chord or the Overlay page)
  let prev = useSettings.getState().settings;
  useSettings.subscribe(({ settings: s }) => {
    if (s.testMode.enabled !== prev.testMode.enabled) {
      debugEvent("debug", s.testMode.enabled ? "test-mode-on" : "test-mode-off");
      if (s.testMode.enabled) writeState();
    }
    if (s.mapPins.preset !== prev.mapPins.preset) debugEvent("mappins", "preset", { from: prev.mapPins.preset, to: s.mapPins.preset });
    if (s.mapPins.enabled !== prev.mapPins.enabled) debugEvent("mappins", s.mapPins.enabled ? "enabled" : "disabled");
    prev = s;
  });
  debugEvent("debug", "start", { version: APP_VERSION, testMode: testOn() });
}
