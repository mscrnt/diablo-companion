// Auto-judge: no hotkey needed. While the game is focused, OCR the area around
// the cursor ~2×/s (local, Windows OCR). When a NEW item tooltip appears:
//   1. split it into columns (hovered item vs the game's "EQUIPPED" comparison),
//   2. crop each tooltip and let the vision LLM label its OCR lines,
//   3. decide what to do with the hovered item.
// Same idea as Mobalytics' autotracker, minus the DLL injection and the upload.
import { emitOverlay } from "./bus";
import { cachedVerdict, judgeTooltips, type JudgeDebug } from "./judgeRunner";
import { isUnequipLine } from "./fastparse";
import { testLog, testModeOn } from "./testmode";
import { normName, similarity } from "./names";
import { captureAtCursor, captureRegion, cursorPosition, type CaptureResult, type OcrLine } from "./native";
import { getActiveVariant, useSettings } from "./store";
import { useGuide } from "./guide";
import type { TooltipText } from "./parse";
import type { JudgeResult } from "./types";
import { onFrame } from "./activity";
import { debugEvent, debugEventEvery } from "./debug";

// Words that only appear inside item tooltips.
const MARKERS = [
  /item power/i,
  /sell value/i,
  /requires level/i,
  /durability/i,
  /account bound/i,
  /\b(ancestral|sacred)\b/i,
  /\b(legendary|unique|mythic|rare|magic)\s+(helm|chest|gloves|pants|boots|amulet|ring|scythe|sword|axe|mace|dagger|wand|staff|focus|shield|two-handed|one-handed|polearm|bow|crossbow|glaive|quarterstaff|totem|charm|seal)/i,
  /\b(helm|chest armor|gloves|pants|boots|amulet|ring|two-handed (scythe|sword|axe|mace))\b/i,
  /empty socket/i,
  /^\s*equipped\s*$/i,
];
const EQUIPPED_RE = /^\s*equipped\s*$/i;

export interface TooltipBox {
  /** absolute screen px */
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Prelim {
  name: string;
  matched: string[];
  total: number;
  unique: string | null;
  box: TooltipBox;
}

export interface TooltipColumn {
  box: TooltipBox; // absolute screen px
  lines: OcrLine[]; // relative to the capture region
  equipped: boolean;
}

export interface Detected {
  hovered: TooltipColumn;
  equipped: TooltipColumn | null;
  score: number;
}

/** Strip comparison deltas "(-8)", "(+3.2%)" and "(3.2% Toughness)" before matching. */
export function cleanLine(t: string) {
  return t
    .replace(/\((?:[+\-]\s*)?[\d.,]+%?(?:\s+\w+)?\)/g, " ")
    .replace(/[◆♦•●▪★☆✦✧]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function bbox(lines: OcrLine[], cap: CaptureResult): TooltipBox {
  const x0 = Math.min(...lines.map((l) => l.x));
  const y0 = Math.min(...lines.map((l) => l.y));
  const x1 = Math.max(...lines.map((l) => l.x + l.w));
  const y1 = Math.max(...lines.map((l) => l.y + l.h));
  return { x: cap.region.x + x0, y: cap.region.y + y0, w: x1 - x0, h: y1 - y0 };
}

/**
 * Find tooltip(s) in an OCR'd capture. Tooltips are separate vertical panels, so we
 * cluster OCR lines into columns by horizontal overlap, keep columns that contain
 * tooltip markers, and pick the hovered one (not labelled EQUIPPED, nearest the cursor).
 */
export function detectTooltips(cap: CaptureResult): Detected | null {
  const lines = (cap.ocr?.lines ?? []).filter((l) => l.text.trim().length > 0);
  if (lines.length < 4) return null;
  // never judge our own dashboard window
  if (lines.some((l) => /d4 companion|sanctuary toolkit/i.test(l.text))) return null;

  // 1) column clustering by x-overlap (lines sorted by width so wide lines seed columns)
  const cols: { x0: number; x1: number; lines: OcrLine[] }[] = [];
  for (const l of [...lines].sort((a, b) => b.w - a.w)) {
    const cx = l.x + l.w / 2;
    const c = cols.find((c) => cx > c.x0 - 30 && cx < c.x1 + 30 && l.x < c.x1 && l.x + l.w > c.x0);
    if (c) {
      c.x0 = Math.min(c.x0, l.x);
      c.x1 = Math.max(c.x1, l.x + l.w);
      c.lines.push(l);
    } else cols.push({ x0: l.x, x1: l.x + l.w, lines: [l] });
  }

  // 1b) a column can also pick up unrelated text above/below (e.g. the inventory's
  // "CHARACTER" header). Tooltips are one continuous block, so split on big vertical
  // gaps and keep the block with the most tooltip markers.
  for (const c of cols) {
    const ls = [...c.lines].sort((a, b) => a.y - b.y);
    const hs = ls.map((l) => l.h).sort((a, b) => a - b);
    const lh = hs[Math.floor(hs.length / 2)] || 20;
    const blocks: OcrLine[][] = [[]];
    for (let i = 0; i < ls.length; i++) {
      if (i > 0 && ls[i].y - (ls[i - 1].y + ls[i - 1].h) > 2.2 * lh) blocks.push([]);
      blocks[blocks.length - 1].push(ls[i]);
    }
    const score = (b: OcrLine[]) => b.reduce((n, l) => n + (MARKERS.some((m) => m.test(l.text)) ? 1 : 0), 0) * 100 + b.length;
    const best = blocks.reduce((a, b) => (score(b) > score(a) ? b : a), blocks[0]);
    c.lines = best;
    c.x0 = Math.min(...best.map((l) => l.x));
    c.x1 = Math.max(...best.map((l) => l.x + l.w));
  }

  // 2) keep columns that look like item tooltips
  const tips = cols
    .map((c) => {
      const hits = new Set<number>();
      for (const l of c.lines) MARKERS.forEach((m, i) => m.test(l.text) && hits.add(i));
      return { ...c, score: hits.size, equipped: c.lines.some((l) => EQUIPPED_RE.test(l.text)) };
    })
    .filter((c) => c.score >= 2 && c.lines.length >= 4);
  if (!tips.length) return null;

  // 3) hovered = non-equipped tooltip nearest the cursor; if only an EQUIPPED one exists you're hovering your own gear
  const [cx] = [cap.cursor[0] - cap.region.x];
  const dist = (c: { x0: number; x1: number }) => (cx < c.x0 ? c.x0 - cx : cx > c.x1 ? cx - c.x1 : 0);
  const notEq = tips.filter((t) => !t.equipped).sort((a, b) => dist(a) - dist(b));
  const eq = tips.filter((t) => t.equipped).sort((a, b) => dist(a) - dist(b));
  const hov = notEq[0] ?? eq[0];
  const other = notEq[0] ? eq[0] ?? null : null;
  const toCol = (c: (typeof tips)[number]): TooltipColumn => ({
    box: bbox(c.lines, cap),
    lines: [...c.lines].sort((a, b) => a.y - b.y || a.x - b.x),
    equipped: c.equipped,
  });
  return { hovered: toCol(hov), equipped: other ? toCol(other) : null, score: hov.score };
}

/**
 * Where to look for tooltips: the game draws them on the side with more room, and for
 * items on the right of the inventory that's LEFT of the whole inventory panel (with the
 * EQUIPPED comparison even further left). So the strip is lopsided toward the open side.
 */
export function tooltipRegion(rect: [number, number, number, number], cx: number, width: number) {
  const [gx, gy, gw, gh] = rect;
  const w = Math.max(width, 3200);
  const rightHalf = cx > gx + gw / 2;
  const x0 = rightHalf ? cx - w * 0.82 : cx - w * 0.18;
  const x = Math.max(gx, Math.round(x0));
  const x1 = Math.min(gx + gw, Math.round(x0 + w));
  return { x, y: gy, w: x1 - x, h: gh };
}

/**
 * The hint footer only shown when the item is in a menu (bag, stash, vendor), never for loot on the
 * ground: "Equip", "Unequip", "Mark as Junk", "Mark as Favorite", "Hide Comparison", "Take", "Sell", "Buy".
 */
export function inMenuFooter(lines: Pick<OcrLine, "text">[]): boolean {
  return lines.some((l) => /^\W{0,3}(un)?equip$|mark as (junk|favorite)|hide comparison|^\W{0,3}(take|sell|buy|select)$/i.test(l.text.trim()));
}

/** Grow the OCR box: the stylised item name & icons sit outside the text OCR finds. */
export function padBox(b: TooltipBox): TooltipBox {
  const px = Math.round(b.w * 0.1) + 20;
  const top = Math.round(b.h * 0.1) + 36;
  return { x: b.x - px, y: b.y - top, w: b.w + 2 * px, h: b.h + top + 24 };
}

/** Instant OCR-only estimate — no LLM. */
export function prelimScore(lines: OcrLine[], box: TooltipBox): Prelim {
  const { variant } = getActiveVariant();
  const gear = variant?.gear.filter((g) => g.group === "gear") ?? [];
  const texts = lines.map((l) => cleanLine(l.text)).filter((t) => t.length > 2);
  // name = the 1–2 lines right above the type line ("Ancestral Legendary Shield")
  const ti = texts.findIndex((t) => /\b(mythic|unique|legendary|rare|magic|common)\b/i.test(t));
  const nameGuess = ti > 0 ? texts.slice(Math.max(0, ti - 2), ti).filter((t) => !/equipped|character|transmog|slot/i.test(t)).join(" ") : "";
  let unique: string | null = null;
  for (const g of gear) {
    if (g.kind !== "unique" && g.kind !== "mythic") continue;
    if (texts.slice(0, 4).some((t) => normName(t) === normName(g.itemName) || similarity(t, g.itemName) > 0.9)) unique = g.itemName;
  }
  let best = { matched: [] as string[], total: 0 };
  for (const g of gear) {
    const targets = [...g.implicits, ...g.affixes].map((a) => a.name);
    const matched = targets.filter((t) => texts.some((x) => similarity(x, t) >= 0.8));
    if (matched.length > best.matched.length) best = { matched, total: targets.length };
  }
  return { name: nameGuess.replace(/[*✸]/g, "").trim(), matched: best.matched, total: best.total, unique, box };
}

/**
 * Identity of what's on screen: item lines AND the comparison part (deltas like "(-73)"
 * and the "Properties lost when equipped" list), so holding Alt to compare against your
 * other ring/weapon slot counts as a new tooltip and gets re-judged.
 */
function signature(lines: OcrLine[]) {
  // which item it is: its numbers ("900 Item Power", "+225 Intelligence", …) read the same every time, while
  // the stylised title doesn't ("BLOOD mooN", "B&OD mobN"…), and the box can start above or below the title.
  // Keyed on the title, hovering one item re-judged it every second (2026-10-11 RC test).
  const numbers = lines
    .slice(0, 24)
    .map((l) => (l.text.replace(/\([^)]*\)?/g, " ").match(/\d[\d.,]*%?/g) ?? []).join(" "))
    .filter(Boolean);
  const item = numbers.length >= 3 ? numbers : lines.slice(0, 14).map((l) => normName(cleanLine(l.text))).filter((t) => t.length > 3);
  const deltas = lines.map((l) => l.text.match(/\(\s*[+\-][\d.,]+%?/g)?.join("") ?? "").join("");
  const lostAt = lines.findIndex((l) => /properties lost/i.test(l.text));
  const lost = lostAt >= 0 ? lines.slice(lostAt + 1, lostAt + 8).map((l) => normName(l.text)).join("|") : "";
  return [...item, deltas.replace(/\s+/g, ""), lost].join("|");
}

/**
 * Package one tooltip column for the parsers. Bullet icons were classified in Rust on
 * the SAME frame as the text (a second capture can be off if the tooltip scrolls).
 * The crop image is only for the log / LLM fallback.
 */
export async function tooltipText(col: TooltipColumn, cap: CaptureResult): Promise<TooltipText> {
  const crop = await captureRegion(padBox(col.box), { maxEdge: 1100, quality: 92 }).catch(() => null);
  return {
    image: crop?.image ?? cap.image,
    lines: col.lines.map((l) => l.text),
    // opened from the Character panel, your own item has no EQUIPPED header but offers "Unequip"
    equipped: col.equipped || col.lines.some((l) => isUnequipLine(l.text)),
    fast: col.lines.map((l) => ({ text: l.text, bullet: l.bullet ?? "none", h: l.h, x: l.x, y: l.y, w: l.w })),
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let lastSig = "";
let pendingSig = "";
let pendingSince = 0;
let snoozeUntil = 0;

/** Mute the auto-judge for a while (hotkey / chord while fighting). */
export function snoozeJudge(seconds: number) {
  snoozeUntil = Date.now() + seconds * 1000;
  emitOverlay("tooltip", null);
}
export const judgeSnoozed = () => Date.now() < snoozeUntil;
let busy = false;
const recent: string[] = [];
let lastMissLog = 0;

/** Where a capture came from and how it maps to the screen (the frame is downscaled). */
const captureInfo = (cap: CaptureResult) => ({
  region: cap.region,
  monitor: cap.monitor,
  cursor: cap.cursor,
  frame: { w: cap.width, h: cap.height, scale: cap.region.w ? cap.width / cap.region.w : 1 },
});

export interface AutoJudgeStatus {
  running: boolean;
  lastTickMs: number;
  tooltip: boolean;
  judged: number;
}
export const autoStatus: AutoJudgeStatus = { running: false, lastTickMs: 0, tooltip: false, judged: 0 };

/** What the last scan saw and decided (debug snapshot). */
const dbg = {
  lastScanAt: 0,
  region: null as CaptureResult["region"] | null,
  cursor: null as [number, number] | null,
  ocrLines: 0,
  markerLines: 0,
  tooltip: false,
  /** why the last tick did (or didn't) judge */
  reason: "not started",
  boxes: null as { hovered: TooltipBox; equipped: TooltipBox | null } | null,
  quiet: false,
  hoveredText: [] as string[],
  lastVerdict: null as null | { at: string; verdict: string; item: string; action?: string; ms: number; quiet: boolean },
};

export function autojudgeDebug() {
  const now = Date.now();
  return {
    ...autoStatus,
    ...dbg,
    enabled: useSettings.getState().settings.autoJudge.enabled,
    lastScanAt: dbg.lastScanAt ? new Date(dbg.lastScanAt).toISOString() : null,
    lastScanAgoMs: dbg.lastScanAt ? now - dbg.lastScanAt : null,
    snoozedForS: Math.max(0, Math.round((snoozeUntil - now) / 1000)),
    waitingForDwell: !!pendingSig && pendingSig !== lastSig,
    recentSeen: recent.length,
  };
}

async function tick(isFocused: () => boolean) {
  const s = useSettings.getState().settings;
  const g = useGuide.getState();
  const scanning = g.flow === "gear" || (g.flow === "setup" && g.step === 4);
  if (!s.autoJudge.enabled && !scanning) return void (dbg.reason = "auto-judge is off");
  if (!isFocused()) return void (dbg.reason = "game not on screen");
  if (busy) return;
  if (Date.now() < snoozeUntil && !scanning) {
    dbg.reason = "snoozed";
    debugEventEvery("aj-snooze", 10_000, "autojudge", "snoozed-skip", { leftS: Math.round((snoozeUntil - Date.now()) / 1000) });
    return;
  }
  busy = true;
  const t0 = performance.now();
  try {
    const c = s.capture;
    // only when the mouse is over the game (not over the dashboard / other monitors)
    const rect = gameRect();
    let cap: CaptureResult;
    if (rect) {
      const [mx, my] = await cursorPosition();
      if (mx < rect[0] || my < rect[1] || mx > rect[0] + rect[2] || my > rect[1] + rect[3]) return void (dbg.reason = "cursor outside the game window");
      cap = await captureRegion(tooltipRegion(rect, mx, c.width), { maxEdge: 640, quality: 70, ocr: true, ocrMaxChannel: true });
    } else cap = await captureAtCursor(c.width, c.height, { maxEdge: 640, quality: 70, ocr: true, ocrMaxChannel: true });
    onFrame(cap.ocr?.lines ?? [], cap.region);
    const det = detectTooltips(cap);
    autoStatus.tooltip = !!det;
    const ocrLines = cap.ocr?.lines ?? [];
    const markerLines = ocrLines.filter((l) => MARKERS.some((m) => m.test(l.text))).length;
    Object.assign(dbg, { lastScanAt: Date.now(), region: cap.region, cursor: cap.cursor, ocrLines: ocrLines.length, markerLines });
    debugEventEvery("aj-scan", 10_000, "autojudge", "scan", { ms: Math.round(performance.now() - t0), region: cap.region, lines: ocrLines.length, markers: markerLines, tooltip: !!det });
    // test mode: tooltip words on screen but no tooltip found = a detection miss worth a look
    if (!det && testModeOn() && Date.now() - lastMissLog > 5000 && markerLines >= 2) {
      lastMissLog = Date.now();
      testLog("miss", { ...captureInfo(cap), ocr: cap.ocr?.lines ?? [] }, cap.image);
    }
    if (!det) {
      const why = ocrLines.length < 4 ? `only ${ocrLines.length} OCR lines` : markerLines >= 2 ? `${markerLines} tooltip words but no tooltip column` : "no tooltip words";
      dbg.reason = `no tooltip: ${why}`;
      // the tooltip going away is logged at once; "still nothing" every 10 s
      if (dbg.tooltip) debugEvent("autojudge", "no-tooltip", { why, gone: true });
      else debugEventEvery("aj-none", 10_000, "autojudge", "no-tooltip", { why });
      dbg.tooltip = false;
      dbg.boxes = null;
      if (pendingSig || lastSig) emitOverlay("tooltip", null);
      pendingSig = "";
      lastSig = "";
      return;
    }
    dbg.tooltip = true;
    dbg.boxes = { hovered: det.hovered.box, equipped: det.equipped?.box ?? null };
    dbg.hoveredText = det.hovered.lines.slice(0, 8).map((l) => l.text.slice(0, 80));
    const sig = signature(det.hovered.lines);
    if (sig === lastSig) {
      dbg.reason = "same tooltip still showing (already handled)";
      debugEventEvery("aj-dedupe", 10_000, "autojudge", "dedupe-skip", { why: "same tooltip", first: dbg.hoveredText[0] });
      return;
    }
    // Inventory / stash / vendor open → judge right away with the full panel.
    // Otherwise it's ground loot (probably mid-fight): wait for a deliberate hover, badge only.
    const lines = cap.ocr?.lines ?? [];
    // the panel header can be hidden under the tooltip (items in the bag's right-hand columns), so the
    // tooltip's own footer counts too: Equip / Mark as Junk / Hide Comparison (bag), Take (stash), Sell / Buy (vendor)
    const inMenu =
      scanning ||
      lines.some((l) => /^(character|stash|inventory|equipment|blacksmith|occultist|jeweler|alchemist|purveyor)\b/i.test(l.text.trim())) ||
      inMenuFooter(det.hovered.lines);
    const quiet = !inMenu;
    dbg.quiet = quiet;
    if (sig !== pendingSig)
      debugEvent("autojudge", "tooltip-found", { box: det.hovered.box, equipped: det.equipped?.box ?? null, score: det.score, quiet, first: dbg.hoveredText.slice(0, 3) });
    if (quiet) {
      if (sig !== pendingSig) {
        pendingSig = sig;
        pendingSince = Date.now();
        dbg.reason = "ground loot: waiting for a deliberate hover";
        debugEvent("autojudge", "quiet-skip", { why: "ground loot, waiting for the hover to settle", dwellMs: s.autoJudge.worldDwellMs });
        return;
      }
      if (Date.now() - pendingSince < s.autoJudge.worldDwellMs) return void (dbg.reason = "ground loot: waiting for a deliberate hover");
    }
    pendingSig = sig;
    lastSig = sig;
    if (recent.includes(sig)) {
      const v = cachedVerdict(sig);
      if (v) {
        dbg.reason = "seen before: showed the cached verdict";
        debugEvent("autojudge", "dedupe-skip", { why: "seen before (cached verdict)", verdict: v.verdict, item: v.item.name });
        emitOverlay("tooltip", { box: det.hovered.box, state: "done", verdict: v, sig, quiet });
        if (!quiet) emitOverlay("verdict", v);
        return;
      }
    }
    recent.unshift(sig);
    recent.length = Math.min(recent.length, 40);
    if (!quiet) emitOverlay("tooltip", { box: det.hovered.box, state: "judging", prelim: prelimScore(det.hovered.lines, det.hovered.box) });
    const [hov, eq] = await Promise.all([tooltipText(det.hovered, cap), det.equipped ? tooltipText(det.equipped, cap) : Promise.resolve(null)]);
    let parsed: JudgeDebug | null = null;
    const result = await judgeTooltips(hov, eq, { sig, box: det.hovered.box, quiet, debug: (d) => void (parsed = d) });
    autoStatus.judged++;
    if (testModeOn()) {
      const p = parsed as JudgeDebug | null;
      testLog(
        "scan",
        {
          ...captureInfo(cap),
          sig,
          quiet,
          scanMs: Math.round(performance.now() - t0),
          boxes: { hovered: det.hovered.box, equipped: det.equipped?.box ?? null },
          tooltip: { hovered: det.hovered.lines, equipped: det.equipped?.lines ?? null },
          ocr: cap.ocr?.lines ?? [],
          parse: p && { hovered: p.hoveredItem, equipped: p.equippedItem, path: { hovered: p.hovered?.raw, equipped: p.equipped?.raw }, ms: { hovered: p.hovered?.ms, equipped: p.equipped?.ms } },
          verdict: result && { ...result, thumb: undefined, item: undefined },
        },
        cap.image,
      );
      // the item's art in the tooltip's top-right corner, labelled with what it was judged as: a clean test
      // set for recognising items by their icon (roadmap). A generous square in screen px, right after the
      // judgement while the tooltip is still up; legendaries too (their art names the base type).
      const it = result?.item;
      if (it && /unique|mythic|legendary/i.test(it.rarity ?? "")) {
        // the art sits in the top-right corner, inside the frame just right of the text column (+5% of its width).
        // Stop at that frame: with the comparison open, the equipped item's tooltip (and its art) starts right
        // after it, and an earlier, wider square caught both items' art (2026-10-12 spike)
        const b = det.hovered.box;
        const side = Math.round(b.w * 0.5);
        const right = b.x + b.w + Math.round(b.w * 0.05);
        captureRegion({ x: right - side, y: Math.round(b.y - b.w * 0.12), w: side, h: side }, { maxEdge: 512, quality: 92 })
          .then((icon) => testLog("icon", { name: it.name, rarity: it.rarity, itemType: it.itemType, untitled: it.untitled ?? false, box: b, region: icon.region }, icon.image))
          .catch(() => {});
      }
    }
    if (result) {
      dbg.reason = "judged";
      dbg.lastVerdict = { at: new Date().toISOString(), verdict: result.verdict, item: result.item.name, action: result.action, ms: result.ms, quiet };
      emitOverlay("tooltip", { box: det.hovered.box, state: "done", verdict: result, sig, quiet });
    } else {
      dbg.reason = "the parser found no item in the tooltip";
      // say so instead of the card just vanishing (a failed AI read, or a tooltip that isn't an item)
      if (quiet) emitOverlay("tooltip", null);
      else {
        const key = useSettings.getState().settings.hotkeys.markMoment?.replace(/CommandOrControl|CmdOrCtrl/g, "Ctrl");
        const unread: JudgeResult = {
          id: `unread-${sig.slice(0, 12)}`,
          at: Date.now(),
          ms: 0,
          verdict: "UNKNOWN",
          action: `Couldn't read this item. Hover it again${key ? `, or press ${key} to save it for a report` : ""}.`,
          reasons: [],
          item: { name: "Unreadable item", rarity: "unknown", itemType: "", slot: "other", itemPower: null, affixes: [], aspect: null } as JudgeResult["item"],
          slot: null,
          matched: [],
          missing: [],
          greaterOnTargets: 0,
          score: 0,
        };
        emitOverlay("tooltip", { box: det.hovered.box, state: "done", verdict: unread, sig, quiet });
      }
    }
  } catch (e) {
    dbg.reason = `error: ${String(e).slice(0, 120)}`;
    debugEvent("autojudge", "error", { error: String(e) });
    console.warn("autojudge tick failed", e);
  } finally {
    autoStatus.lastTickMs = Math.round(performance.now() - t0);
    busy = false;
  }
}

let gameRect: () => [number, number, number, number] | null = () => null;

export function startAutoJudge(isFocused: () => boolean, rect?: () => [number, number, number, number] | null) {
  if (rect) gameRect = rect;
  if (timer) return;
  autoStatus.running = true;
  const loop = async () => {
    await tick(isFocused);
    const ms = Math.max(250, useSettings.getState().settings.autoJudge.intervalMs);
    timer = setTimeout(loop, ms);
  };
  loop();
}

export function forgetRecent() {
  recent.length = 0;
  lastSig = "";
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
