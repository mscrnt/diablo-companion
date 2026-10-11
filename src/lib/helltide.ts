// Helltide helper: reads the cinder count + time left from the HUD and recommends
// which Tortured Gift to open for the build. Costs come from the game files
// (Actor_usz_rewardGizmo_*): armour & rings 75, amulets 125, weapons 150.
import { rankCache, type WhisperCache } from "./whispers";
import type { OcrLine } from "./native";
import type { BuildVariant, SlotProgress } from "./types";

export const HELLTIDE_CHESTS: { name: string; kind: string; cost: number }[] = [
  { name: "Tortured Gift of Helms", kind: "Helms", cost: 75 },
  { name: "Tortured Gift of Chest Armor", kind: "ChestArmors", cost: 75 },
  { name: "Tortured Gift of Handguards", kind: "Gloves", cost: 75 },
  { name: "Tortured Gift of Legguards", kind: "Legs", cost: 75 },
  { name: "Tortured Gift of Boots", kind: "Boots", cost: 75 },
  { name: "Tortured Gift of Rings", kind: "Rings", cost: 75 },
  { name: "Tortured Gift of Amulets", kind: "Amulets", cost: 125 },
  { name: "Tortured Gift of Light Weaponry", kind: "1HWeapons", cost: 150 },
  { name: "Tortured Gift of Heavy Weaponry", kind: "2HWeapons", cost: 150 },
  { name: "Tortured Gift of Mysteries", kind: "Chaos", cost: 75 },
];

export interface HelltideInfo {
  active: boolean;
  cinders: number | null;
  /** seconds left in this Helltide (from the HUD timer) */
  secondsLeft: number | null;
  best: { name: string; cost: number; why: string } | null;
  plan: string[];
}

/**
 * The HUD label "Helltide:" (maybe with its timer) as OCR reads it: "Helitide: 01:16", "e//tide.".
 * A line with more words ("Helltide Harvest…", "Helltide Kehjistan ends 24m") is never the HUD.
 */
export const isHelltideLabel = (text: string) => /^\W{0,3}h?e?[l1i|/]{1,3}t[il1]de\s*[:;.]?\s*(\d{1,2}\s*[:.]\s*\d{2})?\W{0,3}$/i.test(text.trim());

/** Parse the HUD block: "Helltide: 51:37" with counters under the icons (cinders = the left one). */
export function parseHelltideHud(lines: OcrLine[]): { cinders: number | null; secondsLeft: number | null } | null {
  // the HUD label is "Helltide" alone (maybe with ":" and its timer) — not an item or chest name
  // that contains the word ("Helltide Harvest…", "Tortured Gift of…" lists)
  const label = lines.find((l) => isHelltideLabel(l.text));
  if (!label) return null;
  const tm = label.text.match(/(\d{1,2}):(\d{2})/) ?? lines.map((l) => l.text.match(/^\D{0,3}(\d{1,2}):(\d{2})\s*$/)).find(Boolean) ?? null;
  const secondsLeft = tm ? Number(tm[1]) * 60 + Number(tm[2]) : null;
  // counters: short numeric lines below the label, roughly under it; the leftmost is cinders
  const below = lines
    .filter((l) => l.y > label.y + label.h * 0.8 && l.y < label.y + label.h * 6 && /^\s*\d{1,4}\s*$/.test(l.text))
    .filter((l) => l.x + l.w > label.x - label.w * 0.3 && l.x < label.x + label.w * 1.6)
    .sort((a, b) => a.x - b.x);
  const cinders = below.length ? Number(below[0].text.trim()) : null;
  return { cinders, secondsLeft };
}

export function helltideAdvice(variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress, cinders: number | null): { best: HelltideInfo["best"]; plan: string[] } {
  const ranked = HELLTIDE_CHESTS.map((c) => {
    const r = rankCache({ key: c.kind, kind: c.kind, tier: "normal", name: c.name, description: "" } as WhisperCache, variant, prog);
    return { ...c, score: r.score, why: r.why };
  }).sort((a, b) => b.score - a.score);
  const top = ranked[0];
  const affordable = cinders == null ? [] : ranked.filter((c) => c.cost <= cinders);
  const plan: string[] = [];
  let best: HelltideInfo["best"] = null;
  if (cinders != null && affordable.length) {
    const a = affordable[0];
    // greedy spend plan: keep opening the best chest you can afford
    let left = cinders;
    const opens = new Map<string, number>();
    for (let i = 0; i < 8; i++) {
      const pick = ranked.find((c) => c.cost <= left && c.score >= 1);
      if (!pick) break;
      opens.set(pick.name, (opens.get(pick.name) ?? 0) + 1);
      left -= pick.cost;
    }
    // worth saving for a much better pricier chest?
    if (top.cost > cinders && top.score - a.score >= 2) {
      plan.push(`Save up: ${top.name} (${top.cost}) — ${top.why} You need ${top.cost - cinders} more.`);
      best = { name: top.name, cost: top.cost, why: `save for it — ${top.cost - cinders} cinders to go` };
    } else {
      best = { name: a.name, cost: a.cost, why: a.why };
      const list = [...opens.entries()].map(([n, k]) => `${n.replace("Tortured Gift of ", "")}${k > 1 ? " ×" + k : ""}`);
      plan.push(`Spend: ${list.join(", ")}${left > 0 ? ` — ${left} left over` : ""}.`);
      plan.push(`Why ${a.name.replace("Tortured Gift of ", "")}: ${a.why}`);
    }
  } else if (cinders != null) {
    plan.push(`Next: ${top.name} at ${top.cost} cinders (${Math.max(0, top.cost - cinders)} to go).`);
    best = { name: top.name, cost: top.cost, why: `${Math.max(0, top.cost - cinders)} cinders to go` };
  }
  return { best, plan };
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
