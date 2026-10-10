// Runs the Infernal Hordes helper: detects a Hordes run from the quest tracker,
// then scans the arena for offer labels / Spoils chests and pushes advice to the overlay.
import { invoke } from "@tauri-apps/api/core";
import { emitOverlay } from "./bus";
import { chestAdvice, findChests, findOffers, looksLikeHordes, parseAether, type SeenChest, type SeenOffer } from "./hordes";
import { captureRegion } from "./native";
import { getActiveVariant, useSettings } from "./store";

export interface HordesState {
  active: boolean;
  aether: number | null;
  offers: SeenOffer[];
  chests: (SeenChest & { order: number })[];
  advice: string[];
  lastPick: string | null;
}

let state: HordesState = { active: false, aether: null, offers: [], chests: [], advice: [], lastPick: null };
let activeUntil = 0;
let busy = false;
let lastTracker = 0;
let lastLogged = "";

export const hordesState = () => state;

function push() {
  emitOverlay("hordes", state);
}

type Rect = [number, number, number, number];

async function checkTracker(rect: Rect) {
  const [gx, gy, gw, gh] = rect;
  // quest tracker + minimap area (top-right of the game image)
  const r = { x: Math.round(gx + gw * 0.6), y: Math.round(gy + gh * 0.03), w: Math.round(gw * 0.38), h: Math.round(gh * 0.42) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, ocrScale: 1.3, maxEdge: 64, quality: 50 });
  const text = cap.ocr?.text ?? "";
  if (looksLikeHordes(text)) {
    activeUntil = Date.now() + 120_000;
    const a = parseAether(text);
    if (a != null) state.aether = a;
  }
}

async function scanArena(rect: Rect) {
  const { settings } = useSettings.getState();
  const b = settings.overlay.gameBounds;
  const [gx, gy, gw, gh] = rect;
  // the game image (inside the black bars), minus the bottom HUD strip
  const x0 = b ? b.left : 0,
    x1 = b ? b.right : 1;
  const r = { x: Math.round(gx + gw * x0), y: Math.round(gy + gh * 0.04), w: Math.round(gw * (x1 - x0)), h: Math.round(gh * 0.8) };
  const cap = await captureRegion(r, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
  const lines = cap.ocr?.lines ?? [];
  const offers = findOffers(lines, cap.region, settings.hordes.style);
  const chestsSeen = findChests(lines, cap.region);
  const text = cap.ocr?.text ?? "";
  const a = parseAether(text);
  if (a != null) state.aether = a;
  const { variant, prog } = getActiveVariant();
  const adv = chestAdvice(variant, prog, state.aether);
  const chests = chestsSeen.map((c) => ({ ...c, order: adv.order.indexOf(c.name) + 1 || 99 })).sort((x, y) => x.order - y.order);
  if (offers.length || chests.length) activeUntil = Date.now() + 120_000;
  // log each new set of offers/chests (screenshot + OCR) so the matcher can be tuned on real screens
  const sig = [...offers.map((o) => o.key), ...chests.map((c) => c.key)].sort().join(",");
  if (sig && sig !== lastLogged) {
    lastLogged = sig;
    captureRegion(r, { maxEdge: 1800, quality: 80 })
      .then((full) =>
        invoke("debug_log_write", {
          name: `hordes_${new Date().toISOString().replace(/[:.]/g, "-")}`,
          image: full.image,
          json: JSON.stringify({ offers, chests, aether: state.aether, ocr: lines.map((l) => l.text) }, null, 2),
        }),
      )
      .catch(() => {});
  }
  state = {
    active: true,
    aether: state.aether,
    offers,
    chests,
    advice: chests.length ? adv.why : [],
    lastPick: offers[0]?.title ?? state.lastPick,
  };
}

export function startHordes(isFocused: () => boolean, gameRect: () => Rect | null) {
  const loop = async () => {
    const s = useSettings.getState().settings.hordes;
    const rect = gameRect();
    try {
      if (s.enabled && isFocused() && rect && !busy) {
        busy = true;
        const now = Date.now();
        if (now > activeUntil && now - lastTracker > 4000) {
          lastTracker = now;
          await checkTracker(rect);
        }
        if (Date.now() < activeUntil) await scanArena(rect);
        else if (state.active) state = { active: false, aether: null, offers: [], chests: [], advice: [], lastPick: null };
        push();
      }
    } catch (e) {
      console.warn("hordes tick failed", e);
    } finally {
      busy = false;
      setTimeout(loop, Date.now() < activeUntil ? 1200 : 1000);
    }
  };
  loop();
}

/** Manual switch (e.g. from the dashboard) for when the tracker check misses. */
export function forceHordes(on: boolean) {
  activeUntil = on ? Date.now() + 15 * 60_000 : 0;
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
