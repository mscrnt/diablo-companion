// Runs the Infernal Hordes helper: detects a Hordes run from the quest tracker,
// then scans the arena for offer labels / Spoils chests and pushes advice to the overlay.
import { invoke } from "@tauri-apps/api/core";
import { emitOverlay } from "./bus";
import { chestAdvice, rankRemembered, rememberOffers, findChests, findOffers, looksLikeHordes, offerPhase, parseAether, trackerAether, trackerWave, type Remembered, type SeenChest, type SeenOffer } from "./hordes";
import { captureRegion } from "./native";
import { getActiveVariant, useSettings } from "./store";
import { testModeOn } from "./testmode";
import { debugEvent, debugEventEvery } from "./debug";

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
let lastTrackerLog = 0;
let lastOffersKey = "";
let lastChestsKey = "";
/** offers seen during the current offer screen, with how many scans saw each */
const remembered: Remembered = new Map();
let phase: "selecting" | "chosen" | null = null;
let wave: number | null = null;

export const hordesState = () => state;

function push() {
  emitOverlay("hordes", state);
}

type Rect = [number, number, number, number];

/** OCR a region. The max-channel boost that helps elsewhere washes out text on the red Hordes
 *  arena (the background becomes as bright as the text), so fall back to plain OCR when it reads little. */
async function ocrRegion(r: { x: number; y: number; w: number; h: number }, ocrScale?: number) {
  const boosted = await captureRegion(r, { ocr: true, ocrMaxChannel: true, ocrScale, maxEdge: 64, quality: 50 });
  if ((boosted.ocr?.text ?? "").replace(/\s/g, "").length >= 12) return boosted;
  const plain = await captureRegion(r, { ocr: true, ocrMaxChannel: false, ocrScale, maxEdge: 64, quality: 50 });
  return (plain.ocr?.text ?? "").length > (boosted.ocr?.text ?? "").length ? plain : boosted;
}

async function checkTracker(rect: Rect) {
  const [gx, gy, gw, gh] = rect;
  // quest tracker + minimap area (top-right of the game image)
  const r = { x: Math.round(gx + gw * 0.6), y: Math.round(gy + gh * 0.03), w: Math.round(gw * 0.38), h: Math.round(gh * 0.42) };
  const cap = await ocrRegion(r, 1.3);
  const text = cap.ocr?.text ?? "";
  const hit = looksLikeHordes(text);
  if (hit) debugEvent("hordes", "detected", { via: "quest tracker", aether: parseAether(text) });
  else debugEventEvery("hordes-tracker", 30_000, "hordes", "tracker-check", { hit: false, text: text.replace(/\s+/g, " ").slice(0, 120) });
  if (hit) {
    activeUntil = Date.now() + 120_000;
    const a = parseAether(text);
    if (a != null) state.aether = a;
  }
  // in test mode: what the tracker check read, every 30 s at most, so misses can be diagnosed
  if (testModeOn() && Date.now() - lastTrackerLog > 30_000) {
    lastTrackerLog = Date.now();
    invoke("debug_log_write", {
      name: `hordes_tracker_${new Date().toISOString().replace(/[:.]/g, "-")}`,
      image: cap.image,
      json: JSON.stringify({ hit, region: r, text, lines: (cap.ocr?.lines ?? []).map((l) => l.text) }, null, 2),
    }).catch(() => {});
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
  const cap = await ocrRegion(r);
  const lines = cap.ocr?.lines ?? [];
  const seenNow = findOffers(lines, cap.region, settings.hordes.style);
  const chestsSeen = findChests(lines, cap.region);
  const text = cap.ocr?.text ?? "";
  const a = trackerAether(lines) ?? parseAether(text);
  if (a != null) state.aether = a;

  // the offer screen: labels come and go as you walk between the pillars, so remember every offer
  // seen while choosing and rank that set; start over once one is chosen
  const ph = offerPhase(text);
  if (ph && ph !== phase) {
    debugEvent("hordes", ph === "chosen" ? "offer-chosen" : "offer-select", { pick: state.lastPick, seen: [...remembered.keys()] });
    remembered.clear();
    phase = ph;
  }
  // a new wave number means a new offer screen, even if the "You've chosen" banner was missed
  const w = trackerWave(text);
  if (w != null && w !== wave) {
    if (wave != null) remembered.clear();
    wave = w;
  }
  if (phase !== "chosen") rememberOffers(remembered, seenNow);
  const offers: SeenOffer[] = phase === "chosen" ? [] : rankRemembered(remembered, seenNow);
  const { variant, prog } = getActiveVariant();
  const adv = chestAdvice(variant, prog, state.aether);
  const chests = chestsSeen.map((c) => ({ ...c, order: adv.order.indexOf(c.name) + 1 || 99 })).sort((x, y) => x.order - y.order);
  if ((offers.length || chests.length) && !state.active) debugEvent("hordes", "detected", { via: offers.length ? "offers on screen" : "chests on screen" });
  if (seenNow.length || chests.length) activeUntil = Date.now() + 120_000;
  const offersKey = offers.map((o) => o.key).join(",");
  if (offersKey && offersKey !== lastOffersKey) debugEvent("hordes", "offers-seen", { offers: offers.map((o) => `${o.rank}. ${o.title}`), aether: state.aether });
  lastOffersKey = offersKey || lastOffersKey;
  const chestsKey = chests.map((c) => c.key).join(",");
  if (chestsKey && chestsKey !== lastChestsKey) debugEvent("hordes", "chests-seen", { chests: chests.map((c) => `${c.order < 99 ? c.order : "skip"}. ${c.name}`), aether: state.aether });
  lastChestsKey = chestsKey || lastChestsKey;
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
        else if (state.active) {
          debugEvent("hordes", "ended", { why: "nothing Hordes-like seen for 2 min", lastPick: state.lastPick });
          state = { active: false, aether: null, offers: [], chests: [], advice: [], lastPick: null };
          lastOffersKey = lastChestsKey = "";
          remembered.clear();
          phase = null;
          wave = null;
        }
        push();
      }
    } catch (e) {
      debugEvent("hordes", "error", { error: String(e) });
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
