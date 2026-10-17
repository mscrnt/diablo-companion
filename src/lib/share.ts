// Shared judgements (opt-in, Settings > Help improve): each judgement goes to the developer with the
// tooltip text, how it was read, the verdict and the build it followed, plus the tooltip crop with every
// bit of text that isn't the tooltip blacked out. Players flag wrong verdicts (Loot page, Ctrl+Alt+W),
// and wearing an item the judge saw is a quiet signal too. Batches go to our Worker every couple of
// minutes; a random install id, never a BattleTag, character name or IP; deleted after 30 days.
import { invoke } from "@tauri-apps/api/core";
import { create } from "zustand";
import { isTauri } from "./http";
import { getActiveVariant, useBuilds, useLoot, useSettings } from "./store";
import { withoutNames, withoutPersonal, isPersonalLine } from "./privacy";
import { debugEvent } from "./debug";
import { testLog } from "./testmode";
import type { ParseDebug, TooltipText } from "./parse";
import type { JudgeResult, ParsedItem } from "./types";

export type Signal = "wrong" | "right" | "worn";
type Item =
  | { kind: "judgement"; id: string; at: number; data: Record<string, unknown>; images?: { tooltip?: string; equipped?: string } }
  | { kind: "feedback"; id: string; at: number; signal: Signal; note?: string };

/** What the Settings card shows: this session's sends and the last few things sent, without images. */
export interface Sent {
  at: number;
  kind: Item["kind"];
  /** "SELL: Adept Ring" / "wrong: Penitent's Ring" */
  summary: string;
  json: string;
  images: number;
}

interface ShareState {
  queue: Item[];
  sent: number;
  lastSentAt: number | null;
  error: string;
  recent: Sent[];
}

export const useShare = create<ShareState>(() => ({ queue: [], sent: 0, lastSentAt: null, error: "", recent: [] }));

// every minute: what's still queued when the app closes is lost (about a dozen judgements a session at 2 min)
const FLUSH_MS = 60_000;
const FLUSH_AT = 20;
const MAX_QUEUE = 200;
const MAX_BATCH_CHARS = 6 * 1024 * 1024;

const cfg = () => useSettings.getState().settings.share;
export const sharingOn = () => isTauri && cfg().enabled && !!cfg().installId;

/** Turn sharing on or off. On makes an install id the first time; off drops anything not yet sent. */
export function setSharing(on: boolean) {
  useSettings.getState().update((s) => {
    s.share.asked = true;
    s.share.enabled = on;
    if (on && !s.share.installId) {
      s.share.installId = crypto.randomUUID();
      s.share.since = Date.now();
    }
  });
  if (!on) useShare.setState({ queue: [] });
}

/** "Delete my data": ask the server to delete everything under this install id, and stop sharing. */
export async function deleteSharedData(): Promise<void> {
  const id = cfg().installId;
  if (id) await invoke("share_delete", { install: id });
  useSettings.getState().update((s) => {
    s.share.enabled = false;
    s.share.installId = null;
    s.share.since = null;
  });
  useShare.setState({ queue: [], recent: [] });
}

function push(item: Item) {
  if (!sharingOn()) return;
  const queue = [...useShare.getState().queue, item].slice(-MAX_QUEUE);
  useShare.setState({ queue });
  if (queue.length >= FLUSH_AT) void flush();
}

/** Lines of OCR text, without any that name a player. */
const tooltipLines = (t: TooltipText | null) =>
  t ? (t.fast ?? t.lines.map((text) => ({ text, bullet: "none" as const }))).filter((l) => !isPersonalLine(l.text)) : null;

/** A parsed item as sent: its raw text without lines that name a player. */
const item = (it: ParsedItem | null) => (it ? { ...it, rawText: it.rawText ? withoutPersonal(it.rawText) : undefined } : null);

const loadImage = (src: string) =>
  new Promise<HTMLImageElement>((ok, fail) => {
    const img = new Image();
    img.onload = () => ok(img);
    img.onerror = () => fail(new Error("image"));
    img.src = src;
  });

/**
 * The tooltip crop as sent: only the part the OCR frame covered (anything outside it couldn't be checked
 * and is black), with every text box that isn't the tooltip's blacked out. Base64 jpeg, at most 900 px.
 */
async function redactedCrop(t: TooltipText | null): Promise<string | undefined> {
  const sh = t?.share;
  if (!t || !sh) return undefined;
  const img = await loadImage(/^data:/.test(t.image) ? t.image : `data:image/jpeg;base64,${t.image}`);
  const k = img.width / sh.region.w;
  const s = Math.min(1, 900 / Math.max(img.width, img.height));
  const c = document.createElement("canvas");
  c.width = Math.round(img.width * s);
  c.height = Math.round(img.height * s);
  const g = c.getContext("2d")!;
  g.drawImage(img, 0, 0, c.width, c.height);
  g.fillStyle = "#000";
  const toCanvas = (x: number, y: number) => [(x - sh.region.x) * k * s, (y - sh.region.y) * k * s];
  // outside the OCR frame
  const [sx0, sy0] = toCanvas(sh.scan.x, sh.scan.y);
  const [sx1, sy1] = toCanvas(sh.scan.x + sh.scan.w, sh.scan.y + sh.scan.h);
  g.fillRect(0, 0, c.width, Math.max(0, sy0));
  g.fillRect(0, sy1, c.width, c.height);
  g.fillRect(0, 0, Math.max(0, sx0), c.height);
  g.fillRect(sx1, 0, c.width, c.height);
  // text that isn't the tooltip's, with a margin (names move with their players between frames)
  const pad = 6;
  for (const r of sh.redact) {
    const [x, y] = toCanvas(r.x - pad, r.y - pad);
    g.fillRect(x, y, (r.w + 2 * pad) * k * s, (r.h + 2 * pad) * k * s);
  }
  // the server refuses a picture over ~400 KB of base64 (and the batch with it)
  for (const q of [0.8, 0.65, 0.5]) {
    const b64 = c.toDataURL("image/jpeg", q).replace(/^data:[^,]+,/, "");
    if (b64.length < 380_000) return b64;
  }
  return undefined;
}

/** Keep a judgement's text under the server's 64 KB: drop the least useful parts first. */
function fit(data: Record<string, unknown>): Record<string, unknown> {
  const size = () => JSON.stringify(data).length;
  for (const k of ["worn", "equipped"] as const) if (size() > 60_000) data[k] = null;
  if (size() > 60_000) data.tooltip = { ...(data.tooltip as object), equipped: null };
  return data;
}

export interface ShareInput {
  result: JudgeResult;
  hov: TooltipText;
  eq: TooltipText | null;
  debug: { hovered?: ParseDebug; equipped?: ParseDebug };
  equipped: ParsedItem | null;
  quiet?: boolean;
  auto?: boolean;
}

/** Queue one judgement (only when sharing is on). Never throws and never delays the verdict. */
export async function shareJudgement(x: ShareInput): Promise<void> {
  if (!sharingOn()) return;
  try {
    const { settings } = useSettings.getState();
    const { build, variant } = getActiveVariant();
    const r = x.result;
    const raw = x.debug.hovered?.raw as { fast?: boolean } | undefined;
    const worn = r.slot ? useBuilds.getState().worn[r.slot] : undefined;
    const data: Record<string, unknown> = {
      v: 1,
      verdict: r.verdict,
      // "Stash it: great for your Necromancer (Bazaq)": never a character's name
      action: r.action && withoutNames(r.action),
      reasons: r.reasons.map(withoutNames),
      steps: r.steps?.map(withoutNames),
      score: r.score,
      slot: r.slot,
      matched: r.matched,
      missing: r.missing,
      item: item(r.item),
      equipped: item(x.equipped),
      // what you were last seen wearing in that slot (the judge compares with it)
      worn: worn ? { ...item(worn), at: worn.at } : null,
      tooltip: { hovered: tooltipLines(x.hov), equipped: tooltipLines(x.eq), equippedLabel: x.hov.equipped },
      read: {
        path: raw?.fast ? "rules" : "ai",
        ms: x.debug.hovered?.ms,
        totalMs: r.ms,
        // the model's name only, never the server address or key
        model: raw?.fast ? undefined : settings.llm.model || undefined,
        alwaysUseAi: settings.autoJudge.alwaysUseAi,
      },
      build: build
        ? { url: build.url, name: build.name, className: build.className, season: build.season, variant: variant?.name, variantId: variant?.id, updatedAt: build.updatedAt }
        : null,
      screen: x.hov.share ? { monitor: x.hov.share.monitor, box: x.hov.share.box, dpr: window.devicePixelRatio } : null,
      overlay: { layout: settings.overlay.layout },
      quiet: !!x.quiet,
      auto: !!x.auto,
    };
    const [tooltip, equipped] = await Promise.all([redactedCrop(x.hov).catch(() => undefined), redactedCrop(x.eq).catch(() => undefined)]);
    const images = tooltip || equipped ? { ...(tooltip ? { tooltip } : {}), ...(equipped ? { equipped } : {}) } : undefined;
    push({ kind: "judgement", id: r.id, at: r.at, data: fit(data), ...(images ? { images } : {}) });
    // test mode keeps a copy of exactly what was sent, pictures blacked out as sent, to check them
    if (tooltip) testLog("shared", { id: r.id, verdict: r.verdict, item: r.item.name }, tooltip);
    if (equipped) testLog("shared-equipped", { id: r.id }, equipped);
  } catch (e) {
    useShare.setState({ error: `Couldn't prepare a judgement: ${String((e as Error).message ?? e)}` });
  }
}

/** A player's word on a verdict ("wrong", from the Loot page or the hotkey), or wearing what was judged. */
export function shareFeedback(id: string, signal: Signal, note?: string) {
  push({ kind: "feedback", id, at: Date.now(), signal, ...(note?.trim() ? { note: note.trim().slice(0, 300) } : {}) });
}

const flagged = new Set<string>();
/** The hotkey: the newest verdict was wrong. Returns what it flagged, for the toast. */
export function flagLastVerdict(): JudgeResult | null {
  const last = useLoot.getState().history[0];
  if (!last || flagged.has(last.id)) return null;
  flagged.add(last.id);
  useLoot.getState().patch(last.id, { flagged: true });
  shareFeedback(last.id, "wrong");
  return last;
}

const wornSent = new Set<string>();
/**
 * You put on an item the judge saw: a quiet signal about its verdict. Matched on name and stat lines
 * against the last week's judgements, once each.
 */
export function noteWorn(it: ParsedItem) {
  if (!sharingOn()) return;
  const key = (p: ParsedItem) => `${p.name.toLowerCase()}|${p.affixes.map((a) => a.text.replace(/\s+/g, " ").toLowerCase()).join("|")}`;
  const k = key(it);
  const hit = useLoot.getState().history.find((h) => !h.item.equipped && Date.now() - h.at < 7 * 86_400_000 && key(h.item) === k);
  if (!hit || wornSent.has(hit.id)) return;
  wornSent.add(hit.id);
  shareFeedback(hit.id, "worn");
}

const summary = (it: Item) => (it.kind === "judgement" ? `${String(it.data.verdict)}: ${(it.data.item as ParsedItem | null)?.name ?? "?"}` : `${it.signal}: ${useLoot.getState().history.find((h) => h.id === it.id)?.item.name ?? it.id.slice(0, 8)}`);

let sending = false;
/** Send what's queued, up to ~6 MB at a time; a failure keeps it for the next try. */
export async function flush(): Promise<void> {
  if (sending || !sharingOn()) return;
  const { queue } = useShare.getState();
  if (!queue.length) return;
  const batch: Item[] = [];
  let chars = 0;
  for (const it of queue.slice(0, 50)) {
    const n = JSON.stringify(it).length;
    if (batch.length && chars + n > MAX_BATCH_CHARS) break;
    batch.push(it);
    chars += n;
  }
  sending = true;
  try {
    const t0 = performance.now();
    const stored = await invoke<number>("share_send", { install: cfg().installId, items: batch });
    debugEvent("share", "sent", { items: batch.length, stored, judgements: batch.filter((b) => b.kind === "judgement").length, images: batch.reduce((n, b) => n + (b.kind === "judgement" ? Object.keys(b.images ?? {}).length : 0), 0), kb: Math.round(chars / 1024), ms: Math.round(performance.now() - t0) });
    const done = new Set(batch);
    const recent: Sent[] = batch.map((it) => ({
      at: Date.now(),
      kind: it.kind,
      summary: summary(it),
      json: JSON.stringify(it.kind === "judgement" ? { ...it, images: undefined } : it, null, 1),
      images: it.kind === "judgement" ? Object.keys(it.images ?? {}).length : 0,
    }));
    useShare.setState((s) => ({ queue: s.queue.filter((q) => !done.has(q)), sent: s.sent + batch.length, lastSentAt: Date.now(), error: "", recent: [...recent.reverse(), ...s.recent].slice(0, 30) }));
  } catch (e) {
    useShare.setState({ error: String((e as Error)?.message ?? e) });
    debugEvent("share", "send-failed", { items: batch.length, error: String((e as Error)?.message ?? e) });
  } finally {
    sending = false;
  }
}

let timer: ReturnType<typeof setInterval> | null = null;
/** Started with the engine: sends every minute, and on the way out. */
export function startSharing() {
  if (timer || !isTauri) return;
  timer = setInterval(() => void flush(), FLUSH_MS);
  window.addEventListener("beforeunload", () => void flush());
}
