// Guided overlay: walks the player through calibration and a gear scan with
// big on-screen instructions ("Open your inventory", "Hover your Helm",
// "Scroll down ↓"), learning UI positions with the vision model as it goes.
import { create } from "zustand";
import { overlayToast, playTone } from "./alerts";
import { emitOverlay } from "./bus";
import { onJudged } from "./judgeRunner";
import { captureRegion, gameStatus, type Rect } from "./native";
import { getActiveVariant, useSettings, useWatchers, type Watcher } from "./store";
import { recordEquipped } from "./gearTrack";
import { detectPillarbox, sceneSignature } from "./vision";
import { locateUi, type NBox } from "./vlm";

export interface GuideItem {
  key: string;
  label: string;
  done: boolean;
  note?: string;
}

export interface Highlight {
  /** absolute screen px */
  x: number;
  y: number;
  w: number;
  h: number;
  label: string;
  arrow?: "down" | "left" | "right" | "up";
}

export interface GuideState {
  active: boolean;
  flow: "setup" | "gear" | "stats" | "character" | null;
  title: string;
  instruction: string;
  detail: string;
  step: number;
  steps: number;
  items: GuideItem[];
  highlights: Highlight[];
  busy: boolean;
}

const idle: GuideState = { active: false, flow: null, title: "", instruction: "", detail: "", step: 0, steps: 0, items: [], highlights: [], busy: false };

export const useGuide = create<GuideState>(() => idle);

import type { Calibration } from "./store";
export type { Calibration };

const set = (p: Partial<GuideState>) => {
  useGuide.setState(p);
  emitOverlay("guide", useGuide.getState());
};

let cancelled = false;
let skipFlag = false;
let token = 0;

export function cancelGuide() {
  cancelled = true;
  token++;
  set(idle);
}

/** Bound to the judge hotkey/chord while a guide is running. */
export function guideNext() {
  skipFlag = true;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function gameRect(): Promise<Rect | null> {
  const g = await gameStatus().catch(() => null);
  if (!g?.rect) return null;
  return { x: g.rect[0], y: g.rect[1], w: g.rect[2], h: g.rect[3] };
}

function toAbs(r: Rect, b: NBox): Rect {
  return { x: Math.round(r.x + b.x * r.w), y: Math.round(r.y + b.y * r.h), w: Math.round(b.w * r.w), h: Math.round(b.h * r.h) };
}

/** Wait for a condition, polling; resolves false on cancel, "skip" on Next. */
async function waitFor(check: () => Promise<boolean>, everyMs: number, my: number): Promise<boolean | "skip"> {
  skipFlag = false;
  for (;;) {
    if (cancelled || my !== token) return false;
    if (skipFlag) {
      skipFlag = false;
      return "skip";
    }
    try {
      if (await check()) return true;
    } catch (e) {
      console.warn("guide check failed", e);
    }
    await sleep(everyMs);
  }
}

function saveCalibration(c: Partial<Calibration>) {
  useSettings.getState().update((s) => {
    s.calibration = { ...(s.calibration ?? { at: 0, gameRect: { x: 0, y: 0, w: 0, h: 0 } }), ...c, at: Date.now() };
  });
}

// ---- flows ---------------------------------------------------------------------

const EQUIP_LABELS = ["helm", "chest", "gloves", "pants", "boots", "amulet", "ring 1", "ring 2", "weapon", "offhand"] as const;
const LABEL_TO_SLOT: Record<string, string> = {
  helm: "helm",
  chest: "chest-armor",
  gloves: "gloves",
  pants: "pants",
  boots: "boots",
  amulet: "amulet",
  "ring 1": "ring-1",
  "ring 2": "ring-2",
  weapon: "weapon",
  offhand: "offhand",
};

export async function startSetup() {
  cancelled = false;
  const my = ++token;
  const total = 5;
  set({ ...idle, active: true, flow: "setup", title: "Companion setup", steps: total });
  const key = useSettings.getState().settings.hotkeys.judge;

  // 1) game in front
  set({ step: 1, instruction: "Switch to Diablo IV", detail: "Bring the game to the front. Everything from here happens on the overlay.", highlights: [] });
  if (!(await waitFor(async () => !!(await gameStatus()).focused, 500, my))) return;
  const rect = await gameRect();
  if (!rect) return cancelGuide();
  saveCalibration({ gameRect: rect });

  // 2) black bars
  set({ step: 2, instruction: "Measuring your screen…", detail: "Finding where the game image ends so the overlay can use the black bars.", busy: true });
  let bounds = { left: 1, right: 0, top: 1, bottom: 0 };
  for (let i = 0; i < 4; i++) {
    const cap = await captureRegion(rect, { maxEdge: 1280, quality: 85 });
    const b = await detectPillarbox(cap.image);
    // narrowest bars win (a dark scene can only make bars look wider)
    if (b) bounds = { left: Math.min(bounds.left, b.left), right: Math.max(bounds.right, b.right), top: Math.min(bounds.top, b.top), bottom: Math.max(bounds.bottom, b.bottom) };
    await sleep(500);
  }
  if (bounds.left > bounds.right) bounds = { left: 0, right: 1, top: 0, bottom: 1 };
  useSettings.getState().update((s) => {
    s.overlay.gameBounds = bounds;
    if (bounds.left > 0.04 || 1 - bounds.right > 0.04) s.overlay.layout = "bars";
  });
  const barPx = Math.round(bounds.left * rect.w);
  set({ busy: false, detail: barPx > 40 ? `Found ${barPx}px black bars — the overlay now fills them.` : "No black bars found — using free layout." });
  await sleep(1500);

  // 3) inventory — the vision model learns where the panel & gear slots are
  set({ step: 3, instruction: "Open your Inventory", detail: `Press I (or the inventory button on your controller). I'll spot it automatically — or press ${key} to skip.` });
  let inv: Awaited<ReturnType<typeof locateUi>> | null = null;
  const r3 = await waitFor(
    async () => {
      const cap = await captureRegion(rect, { maxEdge: 2560, quality: 80 });
      const res = await locateUi(
        cap.image,
        "Is the character inventory / equipment screen open (the panel with equipped gear slots and the backpack grid)?",
        ["inventory panel", "gold amount", ...EQUIP_LABELS],
      );
      if (res.answer && res.boxes["inventory panel"]) {
        inv = res;
        return true;
      }
      return false;
    },
    1200,
    my,
  );
  if (r3 === false) return;
  if (inv) {
    const found = inv as Awaited<ReturnType<typeof locateUi>>;
    const panel = toAbs(rect, found.boxes["inventory panel"]!);
    const equipment: Record<string, Rect> = {};
    for (const l of EQUIP_LABELS) if (found.boxes[l]) equipment[LABEL_TO_SLOT[l]] = toAbs(rect, found.boxes[l]!);
    const gold = found.boxes["gold amount"] ? toAbs(rect, found.boxes["gold amount"]!) : undefined;
    saveCalibration({ inventoryPanel: panel, equipment, gold });
    await autoWatchers(panel, gold);
    set({
      detail: `Learned the inventory layout (${Object.keys(equipment).length} gear slots${gold ? ", gold" : ""}). Added an "Inventory open" detector${gold ? " and a gold tracker" : ""}.`,
      highlights: [{ ...panel, label: "Inventory" }],
    });
    playTone("good", useSettings.getState().settings.alerts.volume);
    await sleep(1800);
  }

  // 4) gear scan
  set({ step: 4 });
  const okGear = await gearScan(my, true);
  if (!okGear) return;

  // 5) stats
  set({ step: 5 });
  await statsCheck(my, true);
  if (cancelled || my !== token) return;

  set({ instruction: "All set! ✓", detail: "Auto-judge is on: just hover items. Your gear progress and farm plan are updated.", highlights: [], items: [] });
  playTone("bis", useSettings.getState().settings.alerts.volume);
  await sleep(5000);
  if (my === token) cancelGuide();
}

async function autoWatchers(panel: Rect, gold?: Rect) {
  const ws = useWatchers.getState();
  // inventory-open scene fingerprint from the top strip of the panel (its header)
  const header: Rect = { x: panel.x, y: panel.y, w: panel.w, h: Math.max(30, Math.round(panel.h * 0.08)) };
  const cap = await captureRegion(header, { maxEdge: 96, quality: 70 });
  const sig = await sceneSignature(cap.image);
  const existing = ws.watchers.find((w) => w.name === "Inventory open (auto)");
  const inv: Watcher = {
    id: existing?.id ?? crypto.randomUUID(),
    name: "Inventory open (auto)",
    enabled: true,
    rect: header,
    intervalMs: 700,
    ocrScale: 1,
    mode: "scene",
    pattern: "",
    op: ">=",
    threshold: 0,
    action: "show",
    cooldownMs: 3000,
    onlyWhenGameFocused: true,
    scene: { hash: sig.hash, luma: sig.luma, maxDistance: 18 },
  };
  ws.upsert(inv);
  if (gold) {
    const g = ws.watchers.find((w) => w.name === "Gold (auto)");
    ws.upsert({
      id: g?.id ?? crypto.randomUUID(),
      name: "Gold (auto)",
      enabled: true,
      rect: { x: gold.x - 6, y: gold.y - 4, w: gold.w + 12, h: gold.h + 8 },
      intervalMs: 3000,
      ocrScale: 2.5,
      mode: "number",
      pattern: "",
      op: "change",
      threshold: 0,
      action: "show",
      cooldownMs: 0,
      onlyWhenGameFocused: true,
    });
  }
}

/** Hover each equipped item; parsed tooltips fill in your build progress. */
export async function gearScan(my = ++token, embedded = false): Promise<boolean> {
  if (!embedded) {
    cancelled = false;
    set({ ...idle, active: true, flow: "gear", title: "Gear scan", steps: 1, step: 1 });
  }
  const { variant } = getActiveVariant();
  const gear = variant?.gear.filter((g) => g.group === "gear") ?? [];
  if (!gear.length) {
    overlayToast("No build", "Import a build first.");
    return false;
  }
  const key = useSettings.getState().settings.hotkeys.judge;
  const items: GuideItem[] = gear.map((g) => ({ key: g.slot, label: `${g.slotLabel}: ${g.itemName}`, done: false }));
  const seen = new Set<string>();
  const cal = useSettings.getState().settings.calibration;
  const nextHighlight = () => {
    const next = items.find((i) => !i.done);
    const r = next && cal?.equipment?.[next.key];
    return r ? [{ ...r, label: `Hover me: ${gear.find((g) => g.slot === next!.key)?.slotLabel}`, arrow: "left" as const }] : [];
  };
  set({
    instruction: "Hover each equipped item",
    detail: `Keep the inventory open and hover your gear one piece at a time — the tooltip is read automatically. Press ${key} when you're done (or to skip the rest).`,
    items,
    highlights: nextHighlight(),
  });

  const un = onJudged((r, item) => {
    const t = recordEquipped(r, item, seen);
    if (!t) return;
    seen.add(t.slot.slot);
    const it = items.find((i) => i.key === t.slot.slot);
    if (it) {
      it.done = true;
      it.note = t.isTarget ? `${t.state}${t.gaHave.length ? ` · ${t.gaHave.length}★` : ""}` : `stand-in: ${item.name}`;
    }
    set({ items: [...items], highlights: nextHighlight() });
    playTone("tick", useSettings.getState().settings.alerts.volume);
  });
  const res = await waitFor(async () => items.every((i) => i.done), 400, my);
  un();
  if (res === false) return false;
  set({ detail: `Scanned ${items.filter((i) => i.done).length}/${items.length} items.`, highlights: [] });
  await sleep(1500);
  if (!embedded && my === token) cancelGuide();
  return true;
}

/** Read the character stats screen; tells you to scroll until the needed stat is visible. */
export async function statsCheck(my = ++token, embedded = false) {
  if (!embedded) {
    cancelled = false;
    set({ ...idle, active: true, flow: "stats", title: "Stats check", steps: 1, step: 1 });
  }
  const { variant } = getActiveVariant();
  const text = variant?.sections.map((s) => s.text).join("\n") ?? "";
  const wants: { label: string; re: RegExp; min?: number }[] = [];
  if (/minion attack speed|100% (minion )?attack speed/i.test(text)) wants.push({ label: "Minion Attack Speed", re: /minion attack speed[^\d+\-]*\+?([\d.,]+)%/i, min: 100 });
  wants.push({ label: "Critical Strike Chance", re: /critical strike chance[^\d+\-]*\+?([\d.,]+)%/i });
  wants.push({ label: "Maximum Life", re: /maximum life[^\d+\-]*\+?([\d.,]+)/i });
  const key = useSettings.getState().settings.hotkeys.judge;
  const rect = await gameRect();
  if (!rect) return;
  const items: GuideItem[] = wants.map((w) => ({ key: w.label, label: w.label, done: false }));
  set({
    instruction: "Open your Character screen → Stats",
    detail: `Press C, open "Materials & Stats" / the stats list. I'll read it — press ${key} to skip.`,
    items,
    highlights: [],
  });
  let since = Date.now();
  let statsBox: Rect | null = null;
  const res = await waitFor(
    async () => {
      const cap = await captureRegion(rect, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
      const all = cap.ocr?.text ?? "";
      const flat = all.replace(/\n/g, " ");
      let anyStat = /attack speed|critical strike|armor|resistance/i.test(flat);
      for (const w of wants) {
        const m = flat.match(w.re);
        const it = items.find((i) => i.key === w.label)!;
        if (m && !it.done) {
          const v = Number(m[1].replace(",", ""));
          it.done = true;
          it.note = `${v}%${w.min ? (v >= w.min ? " ✓" : ` ✗ (need ${w.min}%)`) : ""}`;
          if (w.min && v < w.min) {
            // quote the guide's own fix if it has one ("If you aren't at 100% attack speed ... drop X and run Y")
            const tip = text.match(/[^.\n]*(?:aren't|not) at 100%[^.\n]*[.\n]?/i)?.[0]?.trim();
            overlayToast(`${w.label} too low`, `${v}% — the guide wants ${w.min}%+.${tip ? " " + tip : ""}`, "#e0543c", 12000);
          }
          since = Date.now();
        }
      }
      if (anyStat && !statsBox) {
        const lines = cap.ocr?.lines.filter((l) => /attack speed|critical|armor|resistance|damage/i.test(l.text)) ?? [];
        if (lines.length) {
          const x0 = Math.min(...lines.map((l) => l.x)),
            y0 = Math.min(...lines.map((l) => l.y)),
            x1 = Math.max(...lines.map((l) => l.x + l.w)),
            y1 = Math.max(...lines.map((l) => l.y + l.h));
          statsBox = { x: rect.x + x0, y: rect.y + y0, w: x1 - x0, h: y1 - y0 };
          saveCalibration({ statsPanel: statsBox });
        }
      }
      const missing = items.filter((i) => !i.done);
      if (anyStat && missing.length && Date.now() - since > 4000) {
        set({
          instruction: "Scroll down ↓",
          detail: `Still looking for: ${missing.map((m) => m.label).join(", ")}. Scroll the stats list slowly.`,
          highlights: statsBox ? [{ ...statsBox, label: "scroll this list", arrow: "down" }] : [],
          items: [...items],
        });
      } else set({ items: [...items] });
      return missing.length === 0;
    },
    1200,
    my,
  );
  if (res === false) return;
  set({ highlights: [], detail: "Stats read." });
  await sleep(1500);
  if (!embedded && my === token) cancelGuide();
}


// ---- helpers for other guided flows (charmap.ts) ---------------------------------------

/** Start a new guided flow; returns its token (stale flows stop when a new one starts). */
export function beginFlow(flow: GuideState["flow"], title: string, steps: number): number {
  cancelled = false;
  const my = ++token;
  set({ ...idle, active: true, flow, title, steps, step: 1 });
  return my;
}
export const guideSet = set;
export const guideWait = waitFor;
export const guideSleep = sleep;
export const guideGameRect = gameRect;
export const flowAlive = (my: number) => !cancelled && my === token;

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
