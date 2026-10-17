// The "brain": runs once in the dashboard window. Owns timers/alerts, hotkeys,
// controller chords, the loot judge, screen watchers and overlay sync.
import { register, unregisterAll } from "@tauri-apps/plugin-global-shortcut";
import { create } from "zustand";
import { alertsAllowed, discord, overlayToast, playTone, toast } from "./alerts";
import { clampDiscordRoom, movePanel, type BarMove, type BarPanel } from "./barlayout";
import { emitOverlay, onGlobal, onMain } from "./bus";
import { planFarm } from "./farm";
import { isTauri } from "./http";
import { judgeNow } from "./judgeRunner";
import { snoozeJudge, startAutoJudge } from "./autojudge";
import { guideNext, useGuide } from "./guide";
import { listModels } from "./llm";
import { checkForUpdate, type UpdateInfo } from "./version";
import { captureMonitor, captureRegion, gameStatus, setOverlayCapturable, setOverlayInteractive, type GameStatus } from "./native";
import { detectPillarbox, hamming, sceneSignature } from "./vision";
import { scanSkillBar, useSkillBar } from "./skillbar";
import { startHordes } from "./hordesRunner";
import { startActivityWatcher } from "./activity";
import { mapPinsPresetChanged, startMapPins } from "./mapPinsRunner";
import { regionKey } from "./mappins";
import { toggleMapCharacter } from "./charmap";
import { obsSaveReplay } from "./obs";
import { noteBars, onGameStatus, watchTestContext } from "./testmode";
import { debugEvent, debugWanted, installMainDebugHooks, markMoment, startDebug } from "./debug";
import { flagLastVerdict, sharingOn, startSharing } from "./share";
import { MAP_PIN_PRESETS, getActiveVariant, nextPreset, useBuilds, useCoach, useLoot, useRuns, useSettings, useWatchers, type ActionId, type Watcher } from "./store";
import { EVENT_META, eventLabel, fmtCountdown, isActive, localSchedule, mergeLive, type LiveInfo } from "./timers";
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
    case "mapPinsPreset": {
      // step to the next map pins preset; its name shows on the map (or as a toast if no map is open)
      const mp = s.mapPins;
      const next = nextPreset(mp.preset, mp.cycle);
      useSettings.getState().update((st) => void (st.mapPins.preset = next));
      const label = MAP_PIN_PRESETS.find((p) => p.id === next)?.label ?? next;
      if (!mp.enabled) overlayToast("Map pins are off", "Turn them on on the Overlay page.", "#9a8f86", 2500);
      else if (!mapPinsPresetChanged()) overlayToast(`Map pins: ${label}`, undefined, "#d9a86a", 1800);
      break;
    }
    case "markMoment":
      await markMoment();
      break;
    case "flagVerdict": {
      const r = flagLastVerdict();
      if (!r) overlayToast("Nothing to flag", "Flag a verdict right after the judge shows it.", "#9a8f86", 2500);
      else if (sharingOn()) overlayToast("Flagged as wrong", `${r.item.name}: thanks, it's sent with the judgement.`, "#d9a86a", 3000);
      else overlayToast("Flagged as wrong", `${r.item.name}. Turn on shared judgements (Settings) to send flags.`, "#d9a86a", 3500);
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

/** Bar layout changes, from the Overlay page or the overlay's edit mode. */
export function editBars(p: { id?: BarPanel; move?: BarMove; discord?: boolean; discordRoom?: number }) {
  useSettings.getState().update((s) => {
    const b = s.overlay.bars;
    if (p.id && p.move) Object.assign(b, movePanel(b, p.id, p.move));
    if (p.discord != null) b.discord = p.discord;
    if (p.discordRoom != null) b.discordRoom = clampDiscordRoom(p.discordRoom);
  });
  pushOverlay();
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
        if (ev.state !== "Pressed") return;
        debugEvent("input", "hotkey", { action, combo });
        runAction(action).catch((e) => overlayToast("Action failed", String(e), "#e0543c"));
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
      debugEvent("input", "chord", { action, chord: chord.join("+") });
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
        const title = lead === 0 ? `${meta.emoji} ${eventLabel(e)}: NOW` : `${meta.emoji} ${eventLabel(e)} in ${lead} min`;
        // a world boss's main zone isn't predictable: the game's map shows it about an hour before
        const body =
          e.kind === "worldBoss"
            ? `${e.extra?.expansion ? "Also in Nahantu or Skovos. " : ""}Its zone is on your map an hour before.`
            : (e.zone ?? meta.label);
        if (!alertsAllowed(alerts.onlyWhileGameRuns, useRuntime.getState().game)) {
          debugEvent("alerts", "skipped", { title, why: "Diablo IV isn't running" });
          continue;
        }
        if (alerts.sound) playTone("alert", alerts.volume);
        if (alerts.toast) toast(title, body);
        overlayToast(title, body, meta.color, 8000);
        if (alerts.discordWebhook && alerts.discordKinds[e.kind] && lead === alerts.leadMinutes[0])
          discord(alerts.discordWebhook, `**${title}**: ${body} (<t:${Math.floor(e.start / 1000)}:t>)`);
      } else if (now > at + 20_000) {
        fired.add(key); // don't fire stale alerts on startup
      }
    }
  }
}

export async function checkLlm() {
  const { llm } = useSettings.getState().settings;
  if (!llm.baseUrl) {
    useRuntime.setState({ llm: { ok: false, models: [], error: "No AI model configured (optional): Settings → Local LLM", checkedAt: Date.now() } });
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
  /** the overlay reports what it draws (test mode on or the Debug page open) */
  debug: boolean;
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
    debug: debugWanted(),
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

// ---- game window changes (debug log) ---------------------------------------------------------

let prevGame: GameStatus | null = null;
function noteGame(g: GameStatus) {
  const p = prevGame;
  prevGame = g;
  if (!p) return debugEvent("game", "status", { running: g.running, focused: g.focused, visible: g.visible, rect: g.rect });
  if (p.running !== g.running) debugEvent("game", g.running ? "started" : "closed");
  if (p.focused !== g.focused) debugEvent("game", g.focused ? "focused" : "unfocused", { companionFocused: g.companionFocused });
  if (p.visible !== g.visible) debugEvent("game", g.visible ? "visible" : "hidden");
  if (String(p.rect) !== String(g.rect)) debugEvent("game", "rect", { from: p.rect, to: g.rect });
}

// ---- black bar auto-detection --------------------------------------------------------

let barsBusy = false;
let barsSamples = 0;
let barsRectKey = "";
/** this session's usable samples for the current game window */
let barsSeen: { left: number; right: number; top: number; bottom: number }[] = [];
/** Learn the pillarbox bounds by itself: a few samples while the game is focused, keep the widest image. */
async function autoDetectBars(rect: [number, number, number, number]) {
  const key = rect.join(",");
  if (key !== barsRectKey) {
    barsRectKey = key;
    barsSamples = 0;
    barsSeen = [];
  }
  if (barsBusy || barsSamples >= 4) return;
  barsBusy = true;
  try {
    await new Promise((r) => setTimeout(r, 1500 + barsSamples * 4000));
    if (!useRuntime.getState().game?.focused) return;
    const cap = await captureRegion({ x: rect[0], y: rect[1], w: rect[2], h: rect[3] }, { maxEdge: 1280, quality: 70 });
    const b = await detectPillarbox(cap.image);
    noteBars(rect, b, cap.image);
    debugEvent("game", "bars", { sample: barsSamples + 1, rect, bounds: b });
    if (!b) return; // unusable frame (e.g. black loading screen) — retry on a later focus event
    barsSamples++;
    barsSeen.push(b);
    // the samples that agree with the median, and of those the narrowest bars (a dark scene can only make
    // bars look wider). One odd frame, like a loading screen read as "no bars" at all, used to win the
    // narrowest-bars rule and turned the bar layout off for the whole session (2026-10-11 RC test).
    const lefts = barsSeen.map((x) => x.left).sort((x, y) => x - y);
    const mid = lefts[Math.floor(lefts.length / 2)]; // the upper median: two samples, one of them "no bars", pick the bars
    const agree = barsSeen.filter((x) => Math.abs(x.left - mid) <= 0.01);
    const best = agree.reduce((a, x) => ({ left: Math.min(a.left, x.left), right: Math.max(a.right, x.right), top: Math.min(a.top, x.top), bottom: Math.max(a.bottom, x.bottom) }));
    useSettings.getState().update((s) => {
      s.overlay.gameBounds = best;
      if (best.left > 0.03) s.overlay.layout = "bars";
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
  installMainDebugHooks();
  startSharing();

  const tick = () => {
    const events = mergeLive(localSchedule(), useRuntime.getState().live);
    useRuntime.setState({ events });
    checkAlerts(events);
  };
  tick();
  setInterval(tick, 1000);

  // Event times come from the app's own schedule. Nothing is polled from other sites (Kenneth, 2026-10-16:
  // no other company's data, nothing pulled automatically); boss names and zones are read from the game screen.

  checkLlm();
  setInterval(checkLlm, 120_000);

  // builds are imported only when you paste a link: no checking build sites for changes in the background
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
  startDebug();
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
    noteGame(game);
    useRuntime.setState({ game });
    onGameStatus(game);
    if (game.focused && game.rect) autoDetectBars(game.rect);
  });
  watchTestContext();
  onGlobal<{ held: string[]; pressed: string[] }>("gamepad", onPad);
  onGlobal<string>("tray-action", (a) => {
    debugEvent("input", "tray", { action: a });
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
  onMain<Parameters<typeof editBars>[0]>("bar-layout", (p) => {
    debugEvent("input", "bar-layout", p);
    editBars(p);
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
  // pins on the in-game map: only while the overlay is showing over the game
  startMapPins(
    () => {
      const rt = useRuntime.getState();
      const o = useSettings.getState().settings.overlay;
      return !!rt.game?.visible && o.enabled && !rt.overlayHidden && !rt.overlayEdit;
    },
    () => useRuntime.getState().game?.rect ?? null,
    () => {
      const ht = useRuntime.getState().events.find((e) => e.kind === "helltide" && isActive(e));
      return ht?.zone ? regionKey(ht.zone) : null;
    },
  );

  // skill bar check: every 60s while playing; toast when something changes
  const missRuns: Record<string, number> = {};
  const warnedSkills = new Set<string>();
  setInterval(async () => {
    const g = useRuntime.getState().game;
    if (!g?.visible || !g.rect || useGuide.getState().active) return;
    const r = await scanSkillBar(g.rect);
    debugEvent("skillbar", r.error ? "skipped" : "result", {
      ok: r.ok,
      error: r.error,
      onBar: r.onBar.map((x) => `${x.name} ${x.score.toFixed(2)}`),
      missing: r.missing.map((m) => m.name),
    });
    if (r.error) return;
    // icon matching can miss a skill on one scan: warn only after 3 misses in a row, once per skill
    for (const slug of Object.keys(missRuns)) if (!r.missing.some((m) => m.slug === slug)) delete missRuns[slug];
    const confirmed = r.missing.filter((m) => (missRuns[m.slug] = (missRuns[m.slug] ?? 0) + 1) >= 3 && !warnedSkills.has(m.slug));
    if (confirmed.length) {
      debugEvent("skillbar", "warned", { missing: confirmed.map((m) => m.name), why: "missing on 3 checks in a row" });
      confirmed.forEach((m) => warnedSkills.add(m.slug));
      overlayToast("Skill bar check", `Not on your bar: ${confirmed.map((m) => m.name).join(", ")}`, "#ff9b4a", 9000);
    }
  }, 60_000);
  setInterval(() => pushOverlay(), 500);
  setInterval(tickWatchers, 250);
  useBuilds.subscribe(() => pushOverlay());
}

export { fmtCountdown };

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
