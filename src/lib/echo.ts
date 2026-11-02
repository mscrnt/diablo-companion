// This season's Soul Splinter ambush: "Evil rises within your Splinter! The Echo of Mephisto will soon emerge!" in the
// middle of the screen, then "The Echo of Mephisto is breaking free!", a few seconds before it spawns (the player's
// install: Messages S15_PrimeEvilAmbush_*). Seeing the banner, the app warns you; its health bar times the fight
// (activity.ts, like any boss). The words are matched loosely: OCR drops letters.
import { overlayToast } from "./alerts";
import { debugEvent } from "./debug";

const WHO = /echo\s+of\s+(the\s+primes|diablo|baal|mephisto)/i;
const COMING = /evil\s+rises\s+within\s+your\s+splinter|will\s+soon\s+emerge/i;
const SOON = /breaking\s+free|emerging\s+nearby/i;
const SETTLED = /evil\s+within\s+your\s+splinter\s+has\s+settled|you\s+are\s+safe\s+for\s+now/i;

let lastWarned = 0;
let lastSettled = 0;

const title = (who: string) => who.replace(/\s+/g, " ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/^The /, "the ");

/** Any OCR'd screen text: warn once per ambush (and say when the Splinter calms down instead). */
export function noteEchoText(text: string, via: string, now = Date.now()) {
  const t = text.replace(/\s+/g, " ");
  if (SETTLED.test(t)) {
    if (now - lastSettled < 60_000) return;
    lastSettled = now;
    debugEvent("echo", "settled", { via });
    overlayToast("Splinter settled", "No Echo this time.", "#8a8f98", 5000);
    return;
  }
  const who = t.match(WHO)?.[1];
  if (!who || !(COMING.test(t) || SOON.test(t))) return;
  if (now - lastWarned < 60_000) return;
  lastWarned = now;
  debugEvent("echo", "coming", { who, via, text: t.slice(0, 160) });
  overlayToast(`Echo of ${title(who)} coming`, "It spawns in a few seconds: get ready.", "#c0392b", 8000);
}

/** The season's tracker ("Splinters of Evil") was seen lately: the banner strip is worth reading more often. */
let splinterSeen = 0;
export function noteSplinterTracker(text: string, now = Date.now()) {
  if (/splinters?\s+of\s+evi/i.test(text)) splinterSeen = now;
}
export const splintersActive = (now = Date.now()) => now - splinterSeen < 15 * 60_000;
