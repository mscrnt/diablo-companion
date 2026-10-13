// Automatic gear tracking: whenever a parsed tooltip is an item you're wearing,
// update the build progress for that slot (state, Greater affixes, matched stats).
import { normName, similarity } from "./names";
import { getActiveVariant, useBuilds } from "./store";
import { noteWorn } from "./share";
import type { GearSlot, JudgeResult, OwnState, ParsedItem } from "./types";

const SLOT_KEYS: Record<string, string[]> = {
  helm: ["helm"],
  chest: ["chest-armor"],
  gloves: ["gloves"],
  pants: ["pants"],
  boots: ["boots"],
  amulet: ["amulet"],
  ring: ["ring-1", "ring-2"],
  weapon: ["weapon", "bludgeoning-weapon", "slashing-weapon", "dual-wield-weapon-1", "dual-wield-weapon-2", "ranged-weapon"],
  offhand: ["offhand"],
};

export function slotForItem(item: ParsedItem, gear: GearSlot[], taken?: Set<string>): GearSlot | undefined {
  const byName = gear.find((g) => normName(g.itemName) === normName(item.name) || similarity(g.itemName, item.name) > 0.85);
  if (byName) return byName;
  if (item.aspect?.name) {
    const byAspect = gear.find((g) => g.kind === "aspect" && similarity(item.aspect!.name, g.itemName) > 0.75);
    if (byAspect) return byAspect;
  }
  const keys = SLOT_KEYS[item.slot] ?? [];
  return gear.find((g) => keys.includes(g.slot) && !taken?.has(g.slot)) ?? gear.find((g) => keys.includes(g.slot));
}

export interface TrackResult {
  slot: GearSlot;
  state: OwnState;
  isTarget: boolean;
  gaHave: string[];
}

/** Record a worn item into build progress. Returns what was recorded. */
export function recordEquipped(r: JudgeResult, item: ParsedItem, taken?: Set<string>): TrackResult | null {
  const { variant } = getActiveVariant();
  const gear = variant?.gear.filter((g) => g.group === "gear") ?? [];
  const g = slotForItem(item, gear, taken);
  if (!g) return null;
  const gaTargets = g.affixes.filter((a) => a.greater).map((a) => a.name);
  const gaHave = item.affixes
    .filter((a) => a.greater && a.match)
    .map((a) => a.match!)
    .filter((m) => gaTargets.some((t) => normName(t) === normName(m)));
  const isTarget =
    normName(item.name).includes(normName(g.itemName)) ||
    similarity(item.name, g.itemName) > 0.85 ||
    (g.kind === "aspect" && !!item.aspect?.name && similarity(item.aspect.name, g.itemName) > 0.75);
  const ratio = r.matched.length / Math.max(1, r.matched.length + r.missing.length);
  let state: OwnState = "have";
  if (isTarget && ratio >= 0.99 && gaHave.length >= gaTargets.length) state = "perfect";
  else if (isTarget && ratio >= 0.7) state = "upgrade";
  else if (!isTarget) state = "missing"; // wearing a stand-in; still need the real piece
  useBuilds.getState().setProgress(g.slot, { state, greater: gaHave, have: r.matched });
  useBuilds.getState().setWorn(g.slot, item);
  // shared judgements: you put on something the judge saw
  noteWorn(item);
  return { slot: g, state, isTarget, gaHave };
}
