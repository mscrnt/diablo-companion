// The "brain": runs once in the dashboard window. Owns timers/alerts, hotkeys,
// controller chords, the loot judge, screen watchers and overlay sync.
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { create } from "zustand";
import { discord, overlayToast, playTone, toast } from "./alerts";
import { emitOverlay, onGlobal, onMain } from "./bus";
import { planFarm } from "./farm";
import { isTauri } from "./http";
import { judgeNow } from "./judgeRunner";
import { snoozeJudge, startAutoJudge } from "./autojudge";
import { guideNext, useGuide } from "./guide";
import { listModels } from "./llm";
import { fetchUpdatedAt } from "./mobalytics";
import { checkForUpdate, type UpdateInfo } from "./version";
import { captureMonitor, captureRegion, gameStatus, setOverlayCapturable, setOverlayInteractive, type GameStatus } from "./native";
import { detectPillarbox, hamming, sceneSignature } from "./vision";
import { scanSkillBar, useSkillBar } from "./skillbar";
import { startHordes } from "./hordesRunner";
import { startActivityWatcher } from "./activity";
import { toggleMapCharacter } from "./charmap";
import { obsSaveReplay } from "./obs";
import { getActiveVariant, useBuilds, useCoach, useLoot, useRuns, useSettings, useWatchers, type ActionId, type Watcher } from "./store";
import { EVENT_META, fetchLive, fmtCountdown, localSchedule, mergeLive, type LiveInfo } from "./timers";
import type { GameEvent, JudgeResult } from "./types";

interface Runtime {
  events: GameEvent[];
  live: LiveInfo | null;
  game: GameStatus | null;
  llm: { ok: boolean; models: string[]; error?: string; checkedAt: number } | null;
  judging: boolean;
  overlayEdit: boolean;
  overlayHidden: boolean;
  hotkeyErrors: string[];
  lastPad: string[];
  /** a newer GitHub release, if any */
  update: UpdateInfo | null;
}

export const useRuntime = create<Runtime>(() => ({
  events: localSchedule(),
  live: null,
  game: null,
  llm: null,
  judging: false,
  overlayEdit: false,
  overlayHidden: false,
  hotkeyErrors: [],
  lastPad: [],
  update: null,
}));

// ---- actions ------------------------------------------------------------------

export async function runAction(a: ActionId) {
  const s = useSettings.getState().settings;
  switch (a) {
    case "judge":
      // while a guided flow runs, the judge key/chord means "next / skip"
      if (useGuide.getState().active) guideNext();
      else await judgeNow();
      break;
    case "runToggle": {
      const runs = useRuns.getState();
      const wasActive = !!runs.active;
      runs.toggle();
      playTone(wasActive ? "good" : "tick", s.alerts.volume);
      overlayToast(wasActive ? "Run finished" : `Run started: ${runs.activity}${runs.tier ? " " + runs.tier : ""}`);
      break;
    }
    case "runSplit":
      useRuns.getState().split();
      playTone("tick", s.alerts.volume);
      break;
    case "clip":
      await clip("Manual clip");
      break;
    case "overlayEdit":
      await setOverlayEdit(!useRuntime.getState().overlayEdit);
      break;
    case "overlayToggle":
      useRuntime.setState((r) => ({ overlayHidden: !r.overlayHidden }));
      break;
    case "mapCharacter":
      toggleMapCharacter();
      break;
    case "snoozeJudge": {
      const secs = s.autoJudge.snoozeSeconds || 30;
      snoozeJudge(secs);
      overlayToast("Loot judge snoozed", `Quiet for ${secs} seconds.`, "#9a8f86", 2500);
      break;
    }
    case "coachSnap": {
      const cap = await captureMonitor(undefined, { maxEdge: 1920, quality: 85 });
      useCoach.getState().setPendingImage(cap.image);
      overlayToast("Screenshot attached to Coach", "Open the Coach tab to ask about it.");
      break;
    }
  }
}

export async function clip(reason: string) {
  const { obs, alerts } = useSettings.getState().settings;
  if (!obs.enabled) return;
  try {
    await obsSaveReplay(obs.url, obs.password);
    overlayToast("🎬 Clipped!", reason, "#f3c35b");
  } catch (e) {
    overlayToast("Clip failed", String((e as Error).message), "#e0543c");
    playTone("bad", alerts.volume);
  }
}

export async function setOverlayEdit(on: boolean) {
  useRuntime.setState({ overlayEdit: on });
  if (isTauri) await setOverlayInteractive(on).catch(() => {});
}

// ---- hotkeys & controller ---------------------------------------------------------

export async function applyHotkeys() {
  if (!isTauri) return;
  const errors: string[] = [];
  await unregisterAll().catch(() => {});
  const { hotkeys } = useSettings.getState().settings;
  for (const [action, combo] of Object.entries(hotkeys) as [ActionId, string][]) {
    if (!combo) continue;
    try {
      await register(combo, (ev) => {
        if (ev.state === "Pressed") runAction(action).catch((e) => overlayToast("Action failed", String(e), "#e0543c"));
      });
    } catch (e) {
      errors.push(`${action} (${combo}): ${String(e)}`);
    }
  }
  useRuntime.setState({ hotkeyErrors: errors });
}

let chordLock = 0;
function onPad(ev: { held: string[]; pressed: string[] }) {
  useRuntime.setState({ lastPad: ev.held });
  const s = useSettings.getState().settings;
  if (!s.padEnabled || Date.now() < chordLock) return;
  for (const [action, chord] of Object.entries(s.padChords) as [ActionId, string[]][]) {
    if (chord.length < 2) continue;
    // fire when the chord is fully held and the last button of it was just pressed
    if (chord.every((b) => ev.held.includes(b)) && ev.pressed.some((b) => chord.includes(b))) {
      chordLock = Date.now() + 600;
      runAction(action).catch(() => {});
      return;
    }
  }
}

// ---- timers & alerts ---------------------------------------------------------------

const fired = new Set<string>();

function checkAlerts(events: GameEvent[]) {
  const { alerts } = useSettings.getState().settings;
  const now = Date.now();
  for (const e of events) {
    if (!alerts.enabled[e.kind]) continue;
    for (const lead of [...alerts.leadMinutes, 0]) {
      const at = e.start - lead * 60_000;
      const key = `${e.kind}:${e.start}:${lead}`;
      if (fired.has(key)) continue;
      if (now >= at && now < at + 20_000) {
        fired.add(key);
        const meta = EVENT_META[e.kind];
        const title = lead === 0 ? `${meta.icon} ${e.name} — NOW` : `${meta.icon} ${e.name} in ${lead} min`;
        const body = e.zone ? e.zone : meta.label;
        if (alerts.sound) playTone("alert", alerts.volume);
        if (alerts.toast) toast(title, body);
        overlayToast(title, body, meta.color, 8000);
        if (alerts.discordWebhook && alerts.discordKinds[e.kind] && lead === alerts.leadMinutes[0])
          discord(alerts.discordWebhook, `**${title}** — ${body} (<t:${Math.floor(e.start / 1000)}:t>)`);
      } else if (now > at + 20_000) {
        fired.add(key); // don't fire stale alerts on startup
      }
    }
  }
}

async function refreshLive() {
  try {
    const live = await fetchLive();
    useRuntime.setState({ live });
  } catch (e) {
    useRuntime.setState((r) => ({ live: { ...(r.live ?? { fetchedAt: 0 }), error: String(e), fetchedAt: Date.now() } }));
  }
}

export async function checkLlm() {
  const { llm } = useSettings.getState().settings;
  if (!llm.baseUrl) {
    useRuntime.setState({ llm: { ok: false, models: [], error: "No AI model configured (optional) — Settings → Local LLM", checkedAt: Date.now() } });
    return;
  }
  try {
    const models = await listModels(llm);
    useRuntime.setState({ llm: { ok: true, models, checkedAt: Date.now() } });
  } catch (e) {
    useRuntime.setState({ llm: { ok: false, models: [], error: String((e as Error).message ?? e), checkedAt: Date.now() } });
  }
}

// ---- screen watchers -----------------------------------------------------------------

const lastRun: Record<string, number> = {};
const busy = new Set<string>();

function parseNumber(text: string): number | null {
  const m = text.replace(/[, ](?=\d{3}\b)/g, "").match(/-?\d+(\.\d+)?/);
  return m ? Number(m[0]) : null;
}

async function tickWatcher(w: Watcher) {
  if (busy.has(w.id)) return;
  busy.add(w.id);
  const store = useWatchers.getState();
  try {
    const scene = w.mode === "scene";
    const cap = await captureRegion(w.rect, scene ? { maxEdge: 96, quality: 70 } : { ocr: true, ocrScale: w.ocrScale || 2, maxEdge: 320, quality: 60 });
    const text = scene ? "" : (cap.ocr?.text ?? "").trim();
    const value = w.mode === "number" ? parseNumber(text) : null;
    const prev = store.values[w.id];
    let fire = false;
    let distance: number | undefined;
    if (scene && w.scene?.hash) {
      const sig = await sceneSignature(cap.image);
      distance = hamming(sig.hash, w.scene.hash);
      // brightness guard: a uniform black frame has a meaningless gradient hash
      const lumaOk = Math.abs(sig.luma - w.scene.luma) < 40;
      fire = distance <= w.scene.maxDistance && lumaOk;
    } else if (w.mode === "text") fire = !!w.pattern && new RegExp(w.pattern, "i").test(text);
    else if (value !== null) {
      if (w.op === ">=") fire = value >= w.threshold;
      else if (w.op === "<=") fire = value <= w.threshold;
      else if (w.op === "==") fire = value === w.threshold;
      else if (w.op === "change") fire = prev?.value != null && prev.value !== value;
    }
    const cooled = !prev?.fired || Date.now() - prev.fired > w.cooldownMs;
    const v = { text, value, distance, at: Date.now(), fired: prev?.fired };
    if (fire && cooled) {
      v.fired = Date.now();
      const vol = useSettings.getState().settings.alerts.volume;
      switch (w.action) {
        case "alert":
          playTone("alert", vol);
          overlayToast(w.name, w.mode === "number" ? `${value}` : scene ? "Scene detected" : text.slice(0, 80), "#ffcc55");
          break;
        case "judgeHint":
          overlayToast(w.name, `Hover an item and press ${useSettings.getState().settings.hotkeys.judge} to judge it`, "#63a8ff", 3500);
          break;
        case "runStart":
          if (!useRuns.getState().active) useRuns.getState().start();
          break;
        case "death":
          store.logDeath(text, useRuns.getState().active?.activity);
          useRuns.getState().addDeath();
          playTone("bad", vol);
          break;
        case "runSplit":
          useRuns.getState().split(w.name);
          break;
        case "runStop":
          if (useRuns.getState().active) useRuns.getState().stop(true);
          break;
      }
    }
    store.setValue(w.id, v);
  } catch (e) {
    store.setValue(w.id, { text: "", value: null, at: Date.now(), error: String(e) });
  } finally {
    busy.delete(w.id);
  }
}

function tickWatchers() {
  const game = useRuntime.getState().game;
  const now = Date.now();
  for (const w of useWatchers.getState().watchers) {
    if (!w.enabled) continue;
    if (w.onlyWhenGameFocused && !game?.visible) continue;
    if (now - (lastRun[w.id] ?? 0) < Math.max(250, w.intervalMs)) continue;
    lastRun[w.id] = now;
    tickWatcher(w);
  }
}

// ---- overlay sync ------------------------------------------------------------------

export interface OverlayState {
  visible: boolean;
  edit: boolean;
  settings: ReturnType<typeof useSettings.getState>["settings"]["overlay"];
  events: GameEvent[];
  run: ReturnType<typeof useRuns.getState>["active"];
  runActivity: string;
  pb: number | null;
  avg: number | null;
  watchers: { name: string; text: string; value: number | null; fired: boolean }[];
  build: { name: string; variant: string; skillBar: string[]; reminders: string[] } | null;
  farm: { item: string; slot: string; where: string }[];
  judging: boolean;
  /** game window rect in physical px (overlay is glued to it) */
  gameRect: [number, number, number, number] | null;
  autoJudge: boolean;
  worldBadgeSeconds: number;
}

function snapshot(): OverlayState {
  const s = useSettings.getState().settings;
  const rt = useRuntime.getState();
  const runs = useRuns.getState();
  const { build, variant, prog } = getActiveVariant();
  const now = Date.now();
  const sameAct = runs.runs.filter((r) => r.activity === (runs.active?.activity ?? runs.activity) && r.end && r.success !== false);
  const durs = sameAct.map((r) => r.end! - r.start);
  const wv = useWatchers.getState();
  const visible =
    s.overlay.enabled && !rt.overlayHidden && (rt.overlayEdit || !s.overlay.onlyWhenGameFocused || !!rt.game?.visible);
  return {
    visible,
    edit: rt.overlayEdit,
    settings: s.overlay,
    events: rt.events.filter((e) => (e.end ?? e.start) > now).slice(0, 12),
    run: runs.active,
    runActivity: runs.activity,
    pb: durs.length ? Math.min(...durs) : null,
    avg: durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null,
    watchers: wv.watchers
      .filter((w) => w.enabled && w.action === "show")
      .map((w) => ({
        name: w.name,
        text: w.mode === "scene" ? (wv.values[w.id]?.fired && now - wv.values[w.id]!.fired! < 3000 ? "● detected" : "—") : wv.values[w.id]?.text ?? "",
        value: wv.values[w.id]?.value ?? null,
        fired: !!wv.values[w.id]?.fired && now - wv.values[w.id]!.fired! < 3000,
      })),
    build:
      build && variant
        ? {
            name: build.name,
            variant: variant.name,
            skillBar: variant.skillBar.map((x) => x.name),
            reminders: buildReminders(build.name, variant),
          }
        : null,
    farm: planFarm(variant, prog)
      .slice(0, 3)
      .map((f) => ({ item: f.item, slot: f.slotLabel, where: f.obtain[0]?.detail ?? "" })),
    judging: rt.judging,
    gameRect: rt.game?.rect ?? null,
    autoJudge: s.autoJudge.enabled,
    worldBadgeSeconds: s.autoJudge.worldBadgeSeconds,
  };
}

function buildReminders(_name: string, variant: NonNullable<ReturnType<typeof getActiveVariant>["variant"]>): string[] {
  const text = variant.sections.map((s) => s.text).join("\n") + "\n";
  const out: string[] = [];
  const sb = useSkillBar.getState().last;
  if (sb && !sb.error) out.push(sb.ok ? "Skill bar ✓ all build skills equipped" : `⚠ Not on bar: ${sb.missing.map((m) => m.name).join(", ")}`);
  if (/100% (minion )?attack speed|Minion Attack Speed/i.test(text)) out.push("Minion Attack Speed ≥ 100% (Cult Leader)");
  for (const s of variant.summons) out.push(s.name);
  return out.slice(0, 4);
}

let lastSnap = "";
function pushOverlay(force = false) {
  const snap = snapshot();
  const json = JSON.stringify(snap);
  if (force || json !== lastSnap) {
    lastSnap = json;
    emitOverlay("state", snap);
  }
}

// ---- black bar auto-detection --------------------------------------------------------

let barsBusy = false;
let barsSamples = 0;
let barsRectKey = "";
/** Learn the pillarbox bounds by itself: a few samples while the game is focused, keep the widest image. */
async function autoDetectBars(rect: [number, number, number, number]) {
  const key = rect.join(",");
  if (key !== barsRectKey) {
    barsRectKey = key;
    barsSamples = 0;
  }
  if (barsBusy || barsSamples >= 4) return;
  barsBusy = true;
  try {
    await new Promise((r) => setTimeout(r, 1500 + barsSamples * 4000));
    if (!useRuntime.getState().game?.focused) return;
    const cap = await captureRegion({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] }, { maxEdge: 1280, quality: 70 });
    const b = await detectPillarbox(cap.image);
    if (!b) return; // unusable frame (e.g. black loading screen) — retry on a later focus event
    barsSamples++;
    // keep the narrowest bars seen this session (a dark scene can only make bars look wider)
    useSettings.getState().update((s) => {
      const prev = barsSamples > 1 ? s.overlay.gameBounds : null;
      s.overlay.gameBounds = prev
        ? { left: Math.min(prev.left, b.left), right: Math.max(prev.right, b.right), top: Math.min(prev.top, b.top), bottom: Math.max(prev.bottom, b.bottom) }
        : b;
      if (b.left > 0.03) s.overlay.layout = "bars";
    });
  } catch {
    /* try again on the next focus event */
  } finally {
    barsBusy = false;
  }
}

// ---- start -------------------------------------------------------------------------

let started = false;

export async function startEngine() {
  if (started) return;
  started = true;

  const tick = () => {
    const events = mergeLive(localSchedule(), useRuntime.getState().live);
    useRuntime.setState({ events });
    checkAlerts(events);
  };
  tick();
  setInterval(tick, 1000);

  refreshLive();
  const pollLive = () => {
    const secs = Math.max(30, useSettings.getState().settings.timers.pollSeconds);
    setTimeout(async () => {
      await refreshLive();
      pollLive();
    }, secs * 1000);
  };
  pollLive();

  checkLlm();
  setInterval(checkLlm, 120_000);

  const checkBuildUpdates = async () => {
    const { builds, setUpdate } = useBuilds.getState();
    for (const b of Object.values(builds)) {
      if (!b.slug) continue;
      const at = await fetchUpdatedAt(b.slug);
      setUpdate(b.id, at && Date.parse(at) > Date.parse(b.updatedAt || "1970") ? at : null);
    }
  };
  setTimeout(checkBuildUpdates, 15000);
  setInterval(checkBuildUpdates, 6 * 3600_000);

  const checkAppUpdate = () =>
    checkForUpdate()
      .then((update) => useRuntime.setState({ update }))
      .catch(() => {});
  setTimeout(checkAppUpdate, 20000);
  setInterval(checkAppUpdate, 6 * 3600_000);

  if (!isTauri) return;

  // wait for persisted settings before registering hotkeys
  if (!useSettings.persist.hasHydrated()) await new Promise<void>((r) => useSettings.persist.onFinishHydration(() => r()));
  await applyHotkeys();
  setOverlayCapturable(useSettings.getState().settings.overlay.capturable).catch(() => {});
  let lastHotkeys = JSON.stringify(useSettings.getState().settings.hotkeys);
  useSettings.subscribe((st) => {
    const h = JSON.stringify(st.settings.hotkeys);
    if (h !== lastHotkeys) {
      lastHotkeys = h;
      applyHotkeys();
    }
  });

  gameStatus().then((game) => useRuntime.setState({ game })).catch(() => {});
  onGlobal<GameStatus>("game-status", (game) => {
    useRuntime.setState({ game });
    if (game.focused && game.rect) autoDetectBars(game.rect);
  });
  onGlobal<{ held: string[]; pressed: string[] }>("gamepad", onPad);
  onGlobal<string>("tray-action", (a) => {
    if (a === "edit-overlay") runAction("overlayEdit");
    if (a === "judge") runAction("judge");
  });
  onGlobal<boolean>("overlay-interactive", (on) => useRuntime.setState({ overlayEdit: on }));

  onMain<{ id: string; x: number; y: number }>("layout", ({ id, x, y }) => {
    useSettings.getState().update((s) => {
      const w = (s.overlay.widgets as any)[id];
      if (w) {
        w.x = Math.min(0.98, Math.max(0, x));
        w.y = Math.min(0.98, Math.max(0, y));
      }
    });
  });
  onMain("overlay-ready", () => {
    pushOverlay(true);
    emitOverlay("guide", useGuide.getState());
    const last = useLoot.getState().history[0];
    if (last && Date.now() - last.at < 3000) emitOverlay("verdict", last satisfies JudgeResult);
  });
  onMain<string>("overlay-action", (a) => runAction(a as ActionId));

  startAutoJudge(
    () => !!useRuntime.getState().game?.visible,
    () => useRuntime.getState().game?.rect ?? null,
  );
  startHordes(
    () => !!useRuntime.getState().game?.visible,
    () => useRuntime.getState().game?.rect ?? null,
  );
  startActivityWatcher(
    () => !!useRuntime.getState().game?.visible,
    () => useRuntime.getState().game?.rect ?? null,
  );

  // skill bar check: every 60s while playing; toast when something changes
  let lastMissing = "";
  setInterval(async () => {
    const g = useRuntime.getState().game;
    if (!g?.visible || !g.rect || useGuide.getState().active) return;
    const r = await scanSkillBar(g.rect);
    if (r.error) return;
    const key = r.missing.map((m) => m.slug).join(",");
    if (key !== lastMissing) {
      lastMissing = key;
      if (r.missing.length) overlayToast("Skill bar check", `Not on your bar: ${r.missing.map((m) => m.name).join(", ")}`, "#ff9b4a", 9000);
    }
  }, 60_000);
  setInterval(() => pushOverlay(), 500);
  setInterval(tickWatchers, 250);
  useBuilds.subscribe(() => pushOverlay());
}

export { fmtCountdown };

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
