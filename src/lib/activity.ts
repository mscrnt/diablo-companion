// Automatic activity tracking from the quest tracker (no clicks):
//   The Pit — start on "Artificer's Pit / Slay enemies to summon a Guardian",
//   split at "Slay the Boss", finish when the boss objective clears,
//   death on "Survival Mastery Failed", tier read from the Artificer's Obelisk menu.
// Tracker strings come from the datamined game files (Quest_PIT_Logic).
import { overlayToast, playTone } from "./alerts";
import { useCharacter } from "./charmap";
import { captureRegion, type OcrLine } from "./native";
import { emitOverlay } from "./bus";
import { invoke } from "@tauri-apps/api/core";
import { findWhisperCaches, parseGrimFavors, type RankedCache } from "./whispers";
import { helltideAdvice, parseHelltideHud, type HelltideInfo } from "./helltide";
import { localSchedule } from "./timers";
import { bossInfo, findBoss } from "./boss";
import { bestTrees, needs, parseWarPlan, useWarPlans } from "./warplans";
import { getActiveVariant, useRuns, useSettings } from "./store";
import { debugEvent } from "./debug";

export interface AdvisorState {
  title: string;
  items: RankedCache[];
  at: number;
}
let advisorShownAt = 0;
let favorsAlerted = false;
let advisorKey = "";
let advisorLast: AdvisorState | null = null;

function pushAdvisor(title: string, items: RankedCache[]) {
  if (items.length) {
    advisorShownAt = Date.now();
    advisorLast = { title, items, at: Date.now() };
    const key = `${title}|${items.map((i) => i.name).join(",")}`;
    if (key !== advisorKey) {
      advisorKey = key;
      debugEvent("activity", "advisor", { title, ranked: items.slice(0, 4).map((i) => `${i.rank}. ${i.name}`) });
    }
    emitOverlay("advisor", advisorLast);
  } else if (advisorShownAt && Date.now() - advisorShownAt > 5000) {
    advisorShownAt = 0;
    advisorKey = "";
    advisorLast = null;
    debugEvent("activity", "advisor-hidden");
    emitOverlay("advisor", null);
  }
}

type Rect = [number, number, number, number];
type PitPhase = "none" | "summon" | "boss" | "done";

let phase: PitPhase = "none";
let pendingTier = "";
let lastSeenPit = 0;
let bossSince = 0;
let survivalFailed = false;
let syncedRun = "";

/** Called with OCR'd frames (auto-judge around the cursor, left-panel scans): free extra signals. */
export function onFrame(lines: OcrLine[], region?: { x: number; y: number }) {
  if (region) {
    const { variant, prog } = getActiveVariant();
    const caches = findWhisperCaches(lines, region, variant, prog);
    if (caches.length >= 2) pushAdvisor("Tree of Whispers", caches);
  }
  const text = lines.map((l) => l.text).join("\n");
  // stylised "OBELISK" can OCR as "0BELISK" — "Select Tier" under the dropdown is a second anchor
  if (/artificer|belisk|select tier/i.test(text)) {
    const m = text.match(/(?:pit\s*)?tier\s*(\d{1,3})/i) ?? text.match(/\blevel\s*(\d{1,3})\b/i);
    if (m && pendingTier !== `T${m[1]}`) {
      pendingTier = `T${m[1]}`;
      debugEvent("activity", "pit-tier", { tier: pendingTier });
    }
  }
}

let trackerLines: OcrLine[] = [];
let trackerRegion = { x: 0, y: 0, w: 0, h: 0 };

/** Zoomed OCR of the two counters under the "Helltide:" label; the left (flame) one is cinders. */
async function readCinders(): Promise<number | null> {
  const label = trackerLines.find((l) => /helltide/i.test(l.text));
  if (!label) return null;
  const r = {
    x: Math.round(trackerRegion.x + label.x - label.w * 0.25),
    // the counters sit ~6 label-heights below "Helltide:" (icons in between)
    y: Math.round(trackerRegion.y + label.y + label.h * 4.5),
    w: Math.round(label.w * 1.6),
    h: Math.round(label.h * 4.5),
  };
  for (const maxCh of [false, true]) {
    const cap = await captureRegion(r, { ocr: true, ocrScale: 3, ocrMaxChannel: maxCh, maxEdge: 64, quality: 50 });
    const nums = (cap.ocr?.lines ?? [])
      .flatMap((l) => [...l.text.matchAll(/\d{1,4}/g)].map((m) => ({ n: Number(m[0]), x: l.x + (m.index ?? 0) * (l.w / Math.max(1, l.text.length)) })))
      .sort((a, b) => a.x - b.x);
    if (nums.length) return nums[0].n;
  }
  return null;
}

async function trackerText(rect: Rect): Promise<string> {
  const [gx, gy, gw, gh] = rect;
  const r = { x: Math.round(gx + gw * 0.6), y: Math.round(gy + gh * 0.03), w: Math.round(gw * 0.38), h: Math.round(gh * 0.45) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, ocrScale: 1.3, maxEdge: 64, quality: 50 });
  trackerLines = cap.ocr?.lines ?? [];
  trackerRegion = cap.region;
  return cap.ocr?.text ?? "";
}

// ---- Helltide ----
let ht: HelltideInfo = { active: false, cinders: null, secondsLeft: null, best: null, plan: [] };
let htLastSeen = 0;
let htWarned = false;
let htAffordAlerted = "";
let htLogged = 0;

async function helltideTick() {
  const hud = parseHelltideHud(trackerLines);
  if (hud && hud.cinders == null) hud.cinders = await readCinders().catch(() => null);
  const now = Date.now();
  if (hud) {
    htLastSeen = now;
    endBoss("left");
    const { variant, prog } = getActiveVariant();
    const cinders = hud.cinders ?? ht.cinders;
    // the HUD timer digits are orange + an hourglass icon and OCR poorly; the schedule knows the end (:55)
    if (hud.secondsLeft == null) {
      const cur = localSchedule(now, 2).find((e) => e.kind === "helltide" && e.start <= now && (e.end ?? 0) > now);
      if (cur?.end) hud.secondsLeft = Math.round((cur.end - now) / 1000);
    }
    const adv = helltideAdvice(variant, prog, cinders);
    if (!ht.active) debugEvent("activity", "helltide-start", { cinders, secondsLeft: hud.secondsLeft, best: adv.best?.name ?? null });
    else if (cinders !== ht.cinders) debugEvent("activity", "helltide-cinders", { from: ht.cinders, to: cinders, read: hud.cinders != null ? "hud" : "kept" });
    ht = { active: true, cinders, secondsLeft: hud.secondsLeft, best: adv.best, plan: adv.plan };
    // you can afford the recommended chest now
    if (adv.best && cinders != null && cinders >= adv.best.cost && htAffordAlerted !== adv.best.name) {
      htAffordAlerted = adv.best.name;
      overlayToast(`🔥 ${cinders} cinders`, `Open ${adv.best.name} (${adv.best.cost}) — ${adv.best.why}`, "#ff7a2f", 8000);
    }
    // unspent cinders vanish when the Helltide ends
    if (hud.secondsLeft != null && hud.secondsLeft < 300 && (cinders ?? 0) >= 75 && !htWarned) {
      htWarned = true;
      overlayToast("Helltide ending soon", `${Math.ceil(hud.secondsLeft / 60)} min left and ${cinders} unspent cinders — spend them before they're lost!`, "#e0543c", 12000);
      playTone("alert", useSettings.getState().settings.alerts.volume);
    }
    if (hud.secondsLeft != null && hud.secondsLeft > 600) htWarned = false;
    emitOverlay("helltide", ht);
    if (now - htLogged > 60000) {
      htLogged = now;
      invoke("debug_log_write", {
        name: `helltide_${new Date().toISOString().replace(/[:.]/g, "-")}`,
        image: null,
        json: JSON.stringify({ parsed: hud, info: ht, lines: trackerLines.map((l) => ({ t: l.text, x: Math.round(l.x), y: Math.round(l.y), w: Math.round(l.w), h: Math.round(l.h) })) }, null, 1),
      }).catch(() => {});
    }
  } else if (ht.active && now - htLastSeen > 20000) {
    debugEvent("activity", "helltide-end", { why: "Helltide HUD gone for 20 s", cinders: ht.cinders });
    ht = { active: false, cinders: null, secondsLeft: null, best: null, plan: [] };
    htAffordAlerted = "";
    emitOverlay("helltide", ht);
  }
}

function glyphTip(): string | null {
  const { variant } = getActiveVariant();
  const mine = useCharacter.getState().glyphs;
  let best: { name: string; gap: number } | null = null;
  for (const p of variant?.paragon ?? []) {
    const lvl = mine[p.glyphSlug]?.level;
    if (lvl == null) continue;
    const gap = p.glyphLevel - lvl;
    if (gap > 0 && (!best || gap > best.gap)) best = { name: p.glyphName, gap };
  }
  return best ? `Upgrade ${best.name} (${best.gap} levels below the build's target).` : null;
}

function startRun() {
  endBoss("left");
  const runs = useRuns.getState();
  if (runs.active) {
    debugEvent("activity", "pit-start-skipped", { why: "a run is already active", active: runs.active.activity });
    return;
  }
  debugEvent("activity", "pit-start", { tier: pendingTier || runs.tier || null });
  runs.setActivity("The Pit", pendingTier || runs.tier);
  runs.start();
  survivalFailed = false;
  overlayToast("Pit run started", pendingTier ? `Tier ${pendingTier.slice(1)} — timer running` : "Timer running", "#d4ad62", 3500);
  playTone("tick", useSettings.getState().settings.alerts.volume);
}

let lastFinish = 0;

function finishRun(success: boolean) {
  lastFinish = Date.now();
  const runs = useRuns.getState();
  const active = runs.active;
  if (!active) return;
  const dur = Date.now() - active.start;
  const prev = runs.runs.filter((r) => r.activity === "The Pit" && r.tier === active.tier && r.end && r.success !== false).map((r) => r.end! - r.start);
  const pb = prev.length ? Math.min(...prev) : Infinity;
  debugEvent("activity", "pit-finish", { success, durS: Math.round(dur / 1000), tier: active.tier, pb: dur < pb });
  runs.stop(success);
  const mins = `${Math.floor(dur / 60000)}:${String(Math.floor((dur % 60000) / 1000)).padStart(2, "0")}`;
  if (success) {
    const tip = glyphTip();
    overlayToast(dur < pb ? `🏆 Pit cleared in ${mins} — new best!` : `Pit cleared in ${mins}`, tip ?? "Spend your glyph upgrades before leaving.", "#5fd18a", 9000);
    playTone(dur < pb ? "bis" : "good", useSettings.getState().settings.alerts.volume);
  } else overlayToast("Pit run ended", `Not completed (${mins})`, "#9a8f86", 5000);
}

/** The Artificer's Obelisk panel opens on the left of the game image: read the selected tier. */
async function readObelisk(rect: Rect) {
  const [gx, gy, gw, gh] = rect;
  const b = useSettings.getState().settings.overlay.gameBounds;
  const left = b ? b.left : 0;
  const imgW = (b ? b.right - b.left : 1) * gw;
  const r = { x: Math.round(gx + gw * left), y: Math.round(gy + gh * 0.03), w: Math.round(imgW * 0.4), h: Math.round(gh * 0.94) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
  onFrame(cap.ocr?.lines ?? [], cap.region);
  if (!(cap.ocr?.lines ?? []).some((l) => /collection|cache/i.test(l.text))) pushAdvisor("", []);
}

let obeliskCheck = 0;

// ---- Nightmare Dungeons: tracker shows "<Dungeon name> / <objective> / Nightmare Dungeon" ----
let nmd: { dungeon: string; objective: string; lastSeen: number } | null = null;

function nmdTick() {
  const now = Date.now();
  const i = trackerLines.findIndex((l) => /^\W*nightmare dungeon\W*$/i.test(l.text.trim()));
  const runs = useRuns.getState();
  if (i >= 0) {
    const marker = trackerLines[i];
    const above = trackerLines
      .filter((l) => l.y < marker.y && marker.y - l.y < marker.h * 6 && !/torment|\btab\b|\d{1,2}:\d{2}/i.test(l.text))
      .sort((a, b) => a.y - b.y);
    const dungeon = (above[0]?.text ?? "").replace(/[^A-Za-z' -]+$/, "").trim();
    const objective = above.slice(1).map((l) => l.text.trim()).join(" ").replace(/\s*[◆♦•]\s*$/, "").trim();
    if (!nmd) {
      endBoss("left");
      nmd = { dungeon, objective, lastSeen: now };
      debugEvent("activity", "nmd-start", { dungeon, objective, runStarted: !runs.active });
      if (!runs.active) {
        runs.setActivity("Nightmare Dungeon", dungeon);
        runs.start();
        overlayToast("Nightmare Dungeon", `${dungeon || "Run"} — timer running`, "#b06cff", 3000);
      }
    } else {
      nmd.lastSeen = now;
      // fix a run label picked up from the wrong line (e.g. "Torment XI")
      if (dungeon && runs.active?.activity === "Nightmare Dungeon" && runs.active.tier !== dungeon && /torment/i.test(runs.active.tier ?? "")) {
        useRuns.setState({ active: { ...runs.active, tier: dungeon } });
        nmd.dungeon = dungeon;
      }
      if (objective && objective !== nmd.objective && runs.active?.activity === "Nightmare Dungeon") {
        debugEvent("activity", "nmd-objective", { from: nmd.objective, to: objective });
        runs.split(nmd.objective.slice(0, 40) || "Objective");
        nmd.objective = objective;
      }
    }
  } else if (nmd && now - nmd.lastSeen > 12000) {
    debugEvent("activity", "nmd-end", { dungeon: nmd.dungeon, why: "tracker marker gone for 12 s" });
    const active = runs.active;
    if (active?.activity === "Nightmare Dungeon") {
      const dur = now - 12000 - active.start;
      runs.stop(true);
      const f = `${Math.floor(dur / 60000)}:${String(Math.round((dur % 60000) / 1000)).padStart(2, "0")}`;
      overlayToast(`Nightmare Dungeon done in ${f}`, nmd.dungeon, "#5fd18a", 6000);
    }
    nmd = null;
  }
}

// ---- boss mode: health bar name at the top centre ----
let boss: string | null = null;
let bossSeen = 0;
let bossLogged = 0;

/** Leave boss mode (and close its timer) — e.g. when another activity starts. */
function endBoss(reason: "dead" | "left") {
  if (!boss) return;
  debugEvent("activity", "boss-end", { boss, reason });
  const runs = useRuns.getState();
  const active = runs.active;
  const label = `Boss: ${boss.split(",")[0]}`;
  if (active && active.activity === label) runs.stop(reason === "dead");
  boss = null;
  emitOverlay("boss", null);
}

async function bossTick(rect: Rect) {
  const [gx, gy, gw, gh] = rect;
  const r = { x: Math.round(gx + gw * 0.33), y: Math.round(gy), w: Math.round(gw * 0.34), h: Math.round(gh * 0.1) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
  const name = findBoss(cap.ocr?.lines ?? []);
  const now = Date.now();
  const runs = useRuns.getState();
  if (boss && now - bossLogged > 15000) {
    bossLogged = now;
    invoke("debug_log_write", {
      name: `boss_${new Date().toISOString().replace(/[:.]/g, "-")}`,
      image: null,
      json: JSON.stringify({ boss, matched: name, lines: (cap.ocr?.lines ?? []).map((l) => l.text) }, null, 1),
    }).catch(() => {});
  }
  if (name) {
    bossSeen = now;
    if (boss !== name) {
      debugEvent("activity", "boss-start", { boss: name, previous: boss, runStarted: !runs.active });
      boss = name;
      const { variant, prog } = getActiveVariant();
      const info = bossInfo(name, variant, prog);
      emitOverlay("boss", info);
      if (!runs.active) {
        runs.setActivity(`Boss: ${name.split(",")[0]}`, "");
        runs.start();
      }
      const want = info.wanted[0];
      overlayToast(`☠ ${name.split(",")[0]}`, want ? `Look for: ${want.item} — ${want.lookFor}` : "Timer running", "#e0543c", 6000);
    }
  } else if (boss && now - bossSeen > 10000) {
    // health bar gone for 10 s → dead (or you left)
    debugEvent("activity", "boss-end", { boss, reason: "health bar gone for 10 s" });
    const active = runs.active;
    const label = `Boss: ${boss.split(",")[0]}`;
    if (active && active.activity === label) {
      const dur = now - 10000 - active.start;
      runs.stop(true);
      const today = useRuns.getState().runs.filter((x) => x.activity === label && x.end && x.start > now - 86400_000);
      const avg = today.reduce((a, x) => a + (x.end! - x.start), 0) / Math.max(1, today.length);
      const f = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.round((ms % 60000) / 1000)).padStart(2, "0")}`;
      overlayToast(`☠ ${boss.split(",")[0]} down in ${f(dur)}`, `Kill #${today.length} today · avg ${f(avg)} — check the drops!`, "#5fd18a", 8000);
      playTone("good", useSettings.getState().settings.alerts.volume);
    }
    boss = null;
    emitOverlay("boss", null);
  }
}

/** Centred dialogs (Tree of Whispers "Choose your reward"). */
async function readCenter(rect: Rect) {
  const [gx, gy, gw, gh] = rect;
  const r = { x: Math.round(gx + gw * 0.3), y: Math.round(gy + gh * 0.12), w: Math.round(gw * 0.4), h: Math.round(gh * 0.76) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
  const lines = cap.ocr?.lines ?? [];
  onFrame(lines, cap.region);
  if (!lines.some((l) => /collection|cache/i.test(l.text))) pushAdvisor("", []);
}

async function tick(rect: Rect) {
  // between runs, glance at the obelisk panel every ~4 s to pick up the chosen tier
  if (phase === "none" && Date.now() - obeliskCheck > 3000) {
    obeliskCheck = Date.now();
    await readObelisk(rect).catch(() => {});
  }
  const t = await trackerText(rect);
  await helltideTick();
  const wpp = parseWarPlan(trackerLines);
  if (wpp) {
    const prev = useWarPlans.getState().progress;
    if (!prev || prev.step !== wpp.step || prev.of !== wpp.of || prev.quest !== wpp.quest) {
      debugEvent("activity", "warplan-progress", { step: wpp.step, of: wpp.of, quest: wpp.quest, prev: prev ? `${prev.step}/${prev.of}` : null });
      useWarPlans.getState().setProgress({ ...wpp, at: Date.now() });
      if (prev && prev.step === prev.of - 1 && wpp.step < prev.step) {
        const { variant, prog } = getActiveVariant();
        const owned = new Set(Object.entries(useWarPlans.getState().owned).filter(([, v]) => v).map(([k]) => k));
        const best = bestTrees(needs(variant, prog, 0), owned)[0];
        overlayToast("War Plan complete!", best ? `Spend the point in ${best.tree.name}${best.next ? ` → ${best.next.node.name}` : ""}.` : "Spend your new point.", "#d4ad62", 10000);
      }
    }
  }
  if (phase === "none") {
    nmdTick();
    if (!nmd) await bossTick(rect).catch(() => {}); // dungeon bosses are part of the NMD run
  }
  // Tree of Whispers reward dialog is centred; the tracker says "Choose your reward"
  if (/choose your reward|whispers of the dead/i.test(t)) await readCenter(rect).catch(() => {});

  const fav = parseGrimFavors(t);
  if (fav && fav.have >= fav.max && !favorsAlerted) {
    favorsAlerted = true;
    debugEvent("activity", "favors-full", fav);
    overlayToast("Grim Favors full", `${fav.have}/${fav.max} — cash them in at the Tree of Whispers.`, "#b06cff", 9000);
  } else if (fav && fav.have < fav.max) favorsAlerted = false;
  const inPit = /artificer'?s pit|summon a guardian|slay the boss|speed mastery|survival mastery/i.test(t);
  const now = Date.now();
  if (inPit) lastSeenPit = now;

  // sync the run start to the in-game mastery countdown (starts at 15:00) — exact even if we noticed late
  const active = useRuns.getState().active;
  if (inPit && active && syncedRun !== active.id) {
    const m = t.match(/\b(1[0-4]|[0-9]):([0-5]\d)\b/);
    if (m) {
      const remaining = Number(m[1]) * 60 + Number(m[2]);
      const start = now - (15 * 60 - remaining) * 1000;
      if (start < active.start - 2000 && now - start < 16 * 60_000) useRuns.setState({ active: { ...active, start } });
      syncedRun = active.id;
    }
  }

  if (/survival mastery failed/i.test(t) && !survivalFailed && useRuns.getState().active) {
    survivalFailed = true;
    useRuns.getState().addDeath();
  }

  // a NEW run only starts on the fresh-run objective (leftover mastery lines after a clear don't count)
  if (phase === "none" && /summon a guardian/i.test(t) && now - lastFinish > 20000) {
    setPhase("summon", "tracker: summon a Guardian");
    startRun();
  }
  // app (re)started mid-run while a run is already active → just resume tracking
  if (phase === "none" && inPit && useRuns.getState().active?.activity === "The Pit") setPhase(/slay the boss/i.test(t) ? "boss" : "summon", "resumed an active Pit run");
  if (phase === "summon" && /slay the boss/i.test(t)) {
    setPhase("boss", "tracker: slay the boss");
    bossSince = now;
    useRuns.getState().split("Guardian");
    overlayToast("Guardian summoned", "Boss phase", "#ff9b4a", 2500);
  }
  // boss objective gone (after the boss phase) → cleared
  if (phase === "boss" && now - bossSince > 4000 && !/slay the boss/i.test(t)) {
    setPhase("done", "boss objective gone");
    finishRun(true);
  }
  // left the Pit without finishing (or tracker gone for a while)
  if ((phase === "summon" || phase === "boss") && !inPit && now - lastSeenPit > 15000) {
    setPhase("none", "no Pit lines in the tracker for 15 s");
    finishRun(false);
  }
  if (phase === "done" && !inPit && now - lastSeenPit > 8000) {
    setPhase("none", "left the Pit after the clear");
    pendingTier = "";
  }
}

function setPhase(next: PitPhase, why: string) {
  if (next === phase) return;
  debugEvent("activity", "pit-phase", { from: phase, to: next, why });
  phase = next;
}

/** What activity tracking believes right now (debug snapshot). */
export function activityDebug() {
  const runs = useRuns.getState();
  const a = runs.active;
  const now = Date.now();
  return {
    autoRuns: useSettings.getState().settings.autoRuns,
    run: a ? { activity: a.activity, tier: a.tier, elapsedS: Math.round((now - a.start) / 1000), splits: a.splits.map((s) => s.label), deaths: a.deaths } : null,
    pit: { phase, pendingTier: pendingTier || null, lastSeenAgoS: lastSeenPit ? Math.round((now - lastSeenPit) / 1000) : null, survivalFailed },
    nmd: nmd && { ...nmd, lastSeen: undefined, lastSeenAgoS: Math.round((now - nmd.lastSeen) / 1000) },
    boss: boss && { name: boss, lastSeenAgoS: Math.round((now - bossSeen) / 1000) },
    helltide: ht.active ? { ...ht, lastSeenAgoS: Math.round((now - htLastSeen) / 1000) } : { active: false },
    tree: advisorLast && { title: advisorLast.title, ranked: advisorLast.items.slice(0, 4).map((i) => `${i.rank}. ${i.name}`), shownAgoS: Math.round((now - advisorShownAt) / 1000) },
    warPlan: useWarPlans.getState().progress,
    tracker: trackerLines.slice(0, 16).map((l) => l.text.slice(0, 80)),
  };
}

export function startActivityWatcher(isFocused: () => boolean, gameRect: () => Rect | null) {
  let busy = false;
  // a boss timer left over from before a restart can't be closed correctly — drop it
  if (useRuns.getState().active?.activity.startsWith("Boss:")) useRuns.setState({ active: null });
  emitOverlay("boss", null);
  setInterval(async () => {
    const rect = gameRect();
    if (busy || !isFocused() || !rect || !useSettings.getState().settings.autoRuns) return;
    busy = true;
    try {
      await tick(rect);
    } catch (e) {
      debugEvent("activity", "error", { error: String(e) });
      console.warn("activity tick failed", e);
    } finally {
      busy = false;
    }
  }, 2000);
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
