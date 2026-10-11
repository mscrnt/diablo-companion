// Tooltip(s) → parse → decide → overlay verdict. Shared by the auto-judge loop,
// the hotkey/controller chord, pasted screenshots and the guided gear scan.
// Every judgment is written to the debug log (images + OCR + raw LLM labels + decision).
import { invoke } from "@tauri-apps/api/core";
import { overlayToast, playTone } from "./alerts";
import { emitOverlay } from "./bus";
import { decide } from "./judge";
import { cubeHint } from "./farm";
import { recordEquipped } from "./gearTrack";
import { isTauri } from "./http";
import { normName } from "./names";
import { captureAtCursor, captureRegion, cursorPosition, ocrImage } from "./native";
import { parseTooltipText, type ParseDebug, type TooltipText } from "./parse";
import { fastParse, looksSane } from "./fastparse";
import { getActiveVariant, useBuilds, useLoot, useSettings } from "./store";
import type { JudgeResult, ParsedItem } from "./types";
import type { TooltipBox } from "./autojudge";
import { debugEvent } from "./debug";

let running = false;
const cache = new Map<string, JudgeResult>();
type Listener = (r: JudgeResult, item: ParsedItem, equipped: ParsedItem | null) => void;
const listeners = new Set<Listener>();

/** Subscribe to every successful parse (used by the guided gear scan). */
export function onJudged(fn: Listener) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export const cachedVerdict = (sig: string) => cache.get(sig);

async function thumbnail(b64: string, maxW = 360): Promise<string> {
  const img = new Image();
  img.src = `data:image/jpeg;base64,${b64}`;
  await img.decode();
  const s = Math.min(1, maxW / img.width);
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  c.getContext("2d")!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL("image/jpeg", 0.7);
}

function logJudgment(id: string, hov: TooltipText, eq: TooltipText | null, dbg: { hovered?: ParseDebug; equipped?: ParseDebug }, result: JudgeResult | null, err?: string) {
  if (!isTauri) return;
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const base = `${stamp}_${id.slice(0, 6)}`;
  const json = JSON.stringify(
    {
      at: new Date().toISOString(),
      error: err,
      hovered: { ocr: dbg.hovered?.ocr ?? hov.lines, equippedLabel: hov.equipped, llm: dbg.hovered?.raw, ms: dbg.hovered?.ms },
      equipped: eq ? { ocr: dbg.equipped?.ocr ?? eq.lines, llm: dbg.equipped?.raw, ms: dbg.equipped?.ms } : null,
      result: result && { ...result, thumb: undefined },
    },
    null,
    2,
  );
  invoke("debug_log_write", { name: base, image: hov.image, json }).catch(() => {});
  if (eq) invoke("debug_log_write", { name: base + "_equipped", image: eq.image, json: "{}" }).catch(() => {});
}

/** Opened from Rust: the opener plugin's JS openPath isn't allowed by the app's permissions. */
export async function openJudgeLog() {
  await invoke<string>("open_log_folder", { path: "judge-log" });
}

export interface JudgeDebug {
  hovered?: ParseDebug;
  equipped?: ParseDebug;
  hoveredItem: ParsedItem | null;
  equippedItem: ParsedItem | null;
}

/** Parse the hovered tooltip (+ the game's EQUIPPED comparison tooltip, in parallel) and decide. */
export async function judgeTooltips(
  hov: TooltipText,
  eq: TooltipText | null,
  meta?: { sig?: string; box?: TooltipBox; quiet?: boolean; debug?: (d: JudgeDebug) => void },
): Promise<JudgeResult | null> {
  const { settings } = useSettings.getState();
  const { variant, prog } = getActiveVariant();
  const t0 = performance.now();
  const id = crypto.randomUUID();
  const { useRuntime } = await import("./engine");
  useRuntime.setState({ judging: true });
  const dbg: { hovered?: ParseDebug; equipped?: ParseDebug } = {};
  try {
    // instant path: OCR + icon colours + rules; the LLM only when the rules aren't confident
    const parse = async (t: TooltipText, allowAi = true): Promise<{ item: ParsedItem | null; debug: ParseDebug }> => {
      const f0 = performance.now();
      if (t.fast && !settings.autoJudge.alwaysUseAi) {
        const item = fastParse(t.fast, t.equipped, variant);
        if (item && looksSane(item)) return { item, debug: { ocr: t.lines, raw: { fast: true, lines: t.fast }, ms: Math.round(performance.now() - f0) } };
      }
      if (!settings.llm.baseUrl) return { item: null, debug: { ocr: t.lines, raw: { fast: false, note: "no AI model configured" }, ms: 0 } };
      if (!allowAi) return { item: null, debug: { ocr: t.lines, raw: { fast: false, note: "AI read deferred" }, ms: 0 } };
      return parseTooltipText(settings.llm, t, variant);
    };
    // the verdict never waits on an AI read of the EQUIPPED column: the hovered tooltip's own comparison
    // and the worn-gear memory cover it; the AI reads it afterwards only to refresh that memory
    const [h, e] = await Promise.all([parse(hov), eq ? parse(eq, false).catch(() => null) : Promise.resolve(null)]);
    if (eq && !e?.item && settings.llm.baseUrl)
      void parse(eq)
        .then((late) => late.item && recordEquipped({ ...decide(late.item, variant, { prog }), id: "", at: 0, ms: 0 }, late.item))
        .catch(() => {});
    dbg.hovered = h.debug;
    if (e) dbg.equipped = e.debug;
    const hovered = h.item;
    const equipped = e?.item ?? null;
    // test mode records both parses next to the frame
    meta?.debug?.({ hovered: h.debug, equipped: e?.debug, hoveredItem: hovered, equippedItem: equipped });
    if (!hovered) {
      logJudgment(id, hov, eq, dbg, null, "no tooltip found by parser");
      debugEvent("autojudge", "parse-failed", { ms: Math.round(performance.now() - t0), lines: hov.lines.length, first: hov.lines[0]?.slice(0, 80), note: (h.debug.raw as any)?.note });
      return null;
    }
    // the comparison tooltip IS what you're wearing → keep worn memory fresh, quietly
    if (equipped) {
      const wornR = decide(equipped, variant, { prog });
      recordEquipped({ ...wornR, id: "", at: 0, ms: 0 }, equipped);
    }
    const worn = (slot: string) => useBuilds.getState().worn[slot];
    const inCodex = (slug: string) => !!useBuilds.getState().owned[slug];
    let scored = decide(hovered, variant, { prog, worn, cubeHint, inCodex }, equipped ?? hovered.compare ?? null);
    // junk for the active build — but maybe great for another build you've bookmarked?
    if ((scored.verdict === "SCRAP" || scored.verdict === "SELL") && !hovered.equipped) {
      const bs = useBuilds.getState();
      for (const b of Object.values(bs.builds)) {
        if (b.id === bs.activeBuildId) continue;
        const ov = b.variants.find((x) => x.id === bs.variantOf[b.id]) ?? b.variants[b.variants.length - 1];
        if (!ov) continue;
        const oprog = (slot: string) => bs.progress[`${b.id}:${ov.id}:${slot}`] ?? { state: "missing" as const, greater: [], have: [], tempered: false, masterwork: 0 };
        const other = decide(hovered, ov, { prog: oprog, cubeHint });
        if (other.verdict === "WEAR") {
          scored = { ...scored, verdict: "STASH", action: `Stash it — great for your ${b.name} build (${ov.gear.find((g) => g.slot === other.slot)?.slotLabel ?? "gear"}).`, reasons: [other.action ?? "", ...other.reasons].filter(Boolean) };
          break;
        }
      }
    }
    const result: JudgeResult = {
      ...scored,
      id,
      at: Date.now(),
      ms: Math.round(performance.now() - t0),
      thumb: await thumbnail(hov.image.replace(/^data:[^,]+,/, "")).catch(() => undefined),
    };
    logJudgment(id, hov, eq, dbg, result);
    debugEvent("autojudge", "judged", {
      verdict: result.verdict,
      item: hovered.name,
      action: result.action,
      reasons: result.reasons.slice(0, 4),
      ms: result.ms,
      parseMs: h.debug.ms,
      path: (h.debug.raw as any)?.fast ? "rules" : "llm",
      quiet: !!meta?.quiet,
      auto: !!meta?.sig,
      comparedWith: equipped?.name ?? null,
    });

    // de-dupe: same item (name + stat lines) judged in the last 3 minutes → its row moves back to the top
    const key = (it: ParsedItem) => normName(it.name) + "|" + it.affixes.map((a) => normName(a.text)).join("|");
    const dup = useLoot.getState().history.find((x) => Date.now() - x.at < 180_000 && key(x.item) === key(hovered));
    useLoot.getState().add(result, dup?.id);
    if (meta?.sig) cache.set(meta.sig, result);
    if (cache.size > 200) cache.delete(cache.keys().next().value!);

    if (hovered.equipped) {
      const t = recordEquipped(result, hovered);
      if (t && !dup) overlayToast(`Tracked: ${t.slot.slotLabel}`, `${hovered.name} → ${t.state}${t.gaHave.length ? ` (${t.gaHave.length}★)` : ""}`, "#8fd3c7", 3500);
    }
    listeners.forEach((l) => l(result, hovered, equipped));
    announce(result, meta?.quiet);
    return result;
  } catch (err) {
    logJudgment(id, hov, eq, dbg, null, String((err as Error).message ?? err));
    debugEvent("autojudge", "error", { error: String((err as Error).message ?? err), ms: Math.round(performance.now() - t0) });
    overlayToast("Couldn't read that item", String((err as Error).message ?? err).slice(0, 160), "#e0543c");
    return null;
  } finally {
    useRuntime.setState({ judging: false });
  }
}

/** Judge an image you already have (pasted screenshot / test file): same column split as live. */
export async function judgeImage(b64: string): Promise<JudgeResult | null> {
  const src = b64.startsWith("data:") ? b64 : `data:image/jpeg;base64,${b64}`;
  const img = new Image();
  img.src = src;
  await img.decode();
  const ocr = await ocrImage(src).catch(() => null);
  const { detectTooltips } = await import("./autojudge");
  const cap = {
    image: src.replace(/^data:[^,]+,/, ""),
    width: img.width,
    height: img.height,
    region: { x: 0, y: 0, w: img.width, h: img.height },
    monitor: { x: 0, y: 0, w: img.width, h: img.height },
    cursor: [img.width / 2, img.height / 2] as [number, number],
    ocr,
  };
  const det = detectTooltips(cap);
  const crop = (b: TooltipBox) => {
    const c = document.createElement("canvas");
    const x = Math.max(0, b.x - 30), y = Math.max(0, b.y - 50);
    const w = Math.min(img.width - x, b.w + 60), h = Math.min(img.height - y, b.h + 80);
    c.width = w;
    c.height = h;
    c.getContext("2d")!.drawImage(img, x, y, w, h, 0, 0, w, h);
    return c.toDataURL("image/jpeg", 0.9).replace(/^data:[^,]+,/, "");
  };
  if (!det) {
    const lines = ocr?.lines.map((l) => l.text) ?? [];
    return judgeTooltips({ image: cap.image, lines, equipped: lines.some((l) => /^\s*equipped\s*$/i.test(l)) }, null);
  }
  const hov = { image: crop(det.hovered.box), lines: det.hovered.lines.map((l) => l.text), equipped: det.hovered.equipped };
  const eq = det.equipped ? { image: crop(det.equipped.box), lines: det.equipped.lines.map((l) => l.text), equipped: true } : null;
  return judgeTooltips(hov, eq);
}

function announce(result: JudgeResult, quiet = false) {
  const { settings } = useSettings.getState();
  const jackpot0 = result.verdict === "WEAR" && /core piece/i.test(result.action ?? "");
  // ground loot mid-fight: just the small badge (unless it's a missing build piece)
  if (quiet && !jackpot0) return;
  emitOverlay("verdict", result);
  if (result.verdict === "WEARING") return; // quiet for gear you're wearing
  // a build piece you didn't have yet = the "jackpot" chime (and an OBS clip if enabled)
  const jackpot = result.verdict === "WEAR" && /core piece/i.test(result.action ?? "");
  const tone = jackpot ? "bis" : result.verdict === "WEAR" || result.verdict === "CUBE" ? "good" : "tick";
  if (settings.autoJudge.sounds || result.verdict === "WEAR" || result.verdict === "CUBE") playTone(tone, settings.alerts.volume);
  if (jackpot && settings.obs.enabled && settings.obs.clipOnBis) {
    import("./engine").then(({ clip }) => clip(`Build piece found: ${result.item.name}`));
  }
}

/** Hotkey / tray / controller chord. */
export async function judgeNow() {
  if (running) return;
  running = true;
  const { settings } = useSettings.getState();
  emitOverlay("judging", true);
  try {
    const c = settings.capture;
    const { detectTooltips, tooltipText, tooltipRegion } = await import("./autojudge");
    const { useRuntime } = await import("./engine");
    const g = useRuntime.getState().game;
    const [mx] = await cursorPosition();
    const cap = g?.rect
      ? await captureRegion(tooltipRegion(g.rect, mx, c.width), { maxEdge: 640, quality: 70, ocr: true, ocrMaxChannel: true })
      : await captureAtCursor(c.width, c.height, { maxEdge: 640, quality: 70, ocr: true, ocrMaxChannel: true });
    const det = detectTooltips(cap);
    debugEvent("autojudge", det ? "tooltip-found" : "no-tooltip", { manual: true, region: cap.region, lines: cap.ocr?.lines.length ?? 0, box: det?.hovered.box });
    if (!det) {
      overlayToast("No item tooltip found", "Hover an item so its tooltip is visible.", "#9a8f86");
      playTone("bad", settings.alerts.volume * 0.6);
      return;
    }
    const [hov, eq] = await Promise.all([tooltipText(det.hovered, cap), det.equipped ? tooltipText(det.equipped, cap) : Promise.resolve(null)]);
    await judgeTooltips(hov, eq, { box: det.hovered.box });
  } catch (e) {
    overlayToast("Loot judge failed", String((e as Error).message ?? e).slice(0, 160), "#e0543c");
    playTone("bad", settings.alerts.volume);
  } finally {
    running = false;
    emitOverlay("judging", false);
  }
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
