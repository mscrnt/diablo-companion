// Automatic gear tracking: whenever a parsed tooltip is an item you're wearing,
// update the build progress for that slot (state, Greater affixes, matched stats).
import { sameAsWorn } from "./judge";
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

type Worn = Record<string, ParsedItem & { at: number; doubt?: boolean }>;

/** A charm or seal (the AI parse can leave out the category; only a seal "Unlocks 6 Charm Slots"). */
const isTalismanItem = (item: ParsedItem) =>
  item.category === "talisman" || item.slot === "charm" || item.slot === "seal" || /horadric seal|unlocks\s+\d+\s+charm\s+slots/i.test(`${item.itemType}\n${item.affixes.map((a) => a.text).join("\n")}`);

/** The slot already remembering this piece (its stat values, or its name when only one slot has that name). */
function wornIn(item: ParsedItem, slots: GearSlot[], worn: Worn): GearSlot | undefined {
  const exact = slots.find((g) => worn[g.slot] && sameAsWorn(item, worn[g.slot]));
  if (exact) return exact;
  const named = slots.filter((g) => worn[g.slot] && normName(worn[g.slot].name) === normName(item.name));
  return named.length === 1 ? named[0] : undefined;
}

export function slotForItem(item: ParsedItem, gear: GearSlot[], taken?: Set<string>, worn?: Worn): GearSlot | undefined {
  const keys = SLOT_KEYS[item.slot] ?? [];
  const slots = gear.filter((g) => keys.includes(g.slot));
  // rings / weapons: a piece you were seen wearing before stays in its slot
  const again = worn && slots.length > 1 ? wornIn(item, slots, worn) : undefined;
  if (again) return again;
  const byName = gear.find((g) => normName(g.itemName) === normName(item.name) || similarity(g.itemName, item.name) > 0.85);
  if (byName) return byName;
  if (item.aspect?.name) {
    const byAspect = gear.find((g) => g.kind === "aspect" && similarity(item.aspect!.name, g.itemName) > 0.75);
    if (byAspect) return byAspect;
  }
  const open = slots.filter((g) => !taken?.has(g.slot));
  if (!worn || open.length < 2) return open[0] ?? slots[0];
  // a new piece: it goes where nothing is remembered, else where the memory is in doubt, else replaces the oldest
  return open.find((g) => !worn[g.slot]) ?? open.find((g) => worn[g.slot].doubt) ?? [...open].sort((a, b) => worn[a.slot].at - worn[b.slot].at)[0];
}

/**
 * A new ring (weapon) went into `slot`: if nothing said which of yours it replaced, the other one may be
 * gone too, so its memory is in doubt until the game shows it again. Not when a slot was free or in doubt.
 */
function doubtOthers(item: ParsedItem, slot: GearSlot, gear: GearSlot[], worn: Worn) {
  const slots = gear.filter((g) => (SLOT_KEYS[item.slot] ?? []).includes(g.slot));
  const prev = worn[slot.slot];
  if (slots.length < 2 || !prev || prev.doubt || wornIn(item, slots, worn)) return;
  const others = slots.filter((g) => g.slot !== slot.slot && worn[g.slot]).map((g) => g.slot);
  if (others.length) useBuilds.getState().doubtWorn(others);
}

export interface TrackResult {
  slot: GearSlot;
  state: OwnState;
  isTarget: boolean;
  gaHave: string[];
}

/** Record a worn item into build progress. Returns what was recorded. */
export function recordEquipped(r: JudgeResult, item: ParsedItem, taken?: Set<string>): TrackResult | null {
  // your seal and charms: remembered to judge spares against
  if (isTalismanItem(item)) {
    useBuilds.getState().setTalisman(item);
    return null;
  }
  const { variant } = getActiveVariant();
  const gear = variant?.gear.filter((g) => g.group === "gear") ?? [];
  const { worn } = useBuilds.getState();
  const g = slotForItem(item, gear, taken, worn);
  if (!g) return null;
  doubtOthers(item, g, gear, worn);
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
