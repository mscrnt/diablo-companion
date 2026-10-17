// Loot Judge decisions: a parsed tooltip (see parse.ts) → one plain-language action
// for the active build variant.
import { Archive, Backpack, Box, CircleHelp, Coins, Gem, Hammer, ShieldCheck, Shirt, Sparkles, type LucideIcon } from "lucide-react";
import { normName, similarity, table, trigramSim, type Category } from "./names";
import { knownWord, ocrVocabReady } from "./ocrfix";
import { buildProfile, compareValue, rowsFromItems, standaloneValue, statKey, statWeight, type BuildProfile } from "./statvalue";
import type { BuildVariant, CompareRow, GearSlot, JudgeResult, ParsedItem, SlotProgress, Talisman, Verdict } from "./types";

// ---- decision -------------------------------------------------------------------
// Everything below turns a parsed tooltip into ONE plain instruction:
// wear it / keep yours / scrap / sell / stash / take the power / cube it.

const SLOT_MAP: Record<string, string[]> = {
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

function targetsMatch(affixText: string, llmMatch: string | null | undefined, target: string): boolean {
  if (llmMatch && normName(llmMatch) === normName(target)) return true;
  return similarity(affixText, target) >= 0.8;
}

function sameItem(a: string, b: string) {
  const x = normName(a);
  const y = normName(b);
  return !!x && !!y && (x === y || x.includes(y) || y.includes(x));
}

/** "Critical Strike Damage Multiplier" → "Crit Damage" for short overlay text. */
export function shortStat(n: string) {
  return n
    .replace(/Critical Strike/g, "Crit")
    .replace(/ Multiplier/g, "")
    .replace(/Ranks to /g, "+Ranks ")
    .replace(/Resistance to All Elements/g, "All Resist")
    .replace(/Maximum /g, "Max ");
}

/** Drop ranges and deltas for display. */
export function cleanAffix(t: string) {
  return t.replace(/\[[^\]]*\]/g, "").replace(/\([^)]*\)/g, "").replace(/\s+/g, " ").trim();
}

interface Quality {
  matched: string[];
  missing: string[];
  greater: number;
  total: number;
  isTarget: boolean;
  q: number;
}

function quality(item: ParsedItem, slot: GearSlot): Quality {
  // a guide can list a stat twice for a slot (an implicit and an affix): one Intelligence line on the item
  // counted as two wanted stats, and the verdict card listed it twice (3,200 React key errors, 2026-10-16)
  const seen = new Set<string>();
  const targets = [...slot.implicits, ...slot.affixes].filter((t) => {
    const k = normName(t.name);
    return !seen.has(k) && !!seen.add(k);
  });
  const matched: string[] = [];
  let greater = 0;
  for (const t of targets) {
    const hit = item.affixes.find((a) => targetsMatch(a.text, a.match, t.name));
    if (hit) {
      matched.push(t.name);
      if (hit.greater) greater++;
    }
  }
  const isTarget =
    ((slot.kind === "unique" || slot.kind === "mythic") && sameItem(item.name, slot.itemName)) ||
    (slot.kind === "aspect" && !!item.aspect?.name && (sameItem(item.aspect.name, slot.itemName) || similarity(item.aspect.name, slot.itemName) > 0.75));
  return {
    matched,
    missing: targets.map((t) => t.name).filter((n) => !matched.includes(n)),
    greater,
    total: targets.length,
    isTarget,
    // a build UNIQUE is the real deal; a build ASPECT can be imprinted onto anything, so it barely counts
    q: matched.length + 0.6 * greater + (isTarget ? (slot.kind === "aspect" ? 0.3 : 4) : 0),
  };
}

export interface Ctx {
  prog: (slot: string) => SlotProgress;
  /** last seen stats of what you're wearing per build slot (from hovering your gear), and when; `doubt`: it may be gone */
  worn?: (slot: string) => (ParsedItem & { at?: number; doubt?: boolean }) | undefined;
  /** Horadric Cube recipe that can turn a white base into a build unique */
  cubeHint?: (slot: GearSlot) => { recipe: string; baseType: string; pool: string[] } | undefined;
  /** the aspect (by slug) is already in your Codex of Power (Collection page) */
  inCodex?: (slug: string) => boolean;
  /** the build's stat weights (filled in by decide) */
  prof?: BuildProfile;
  /** the build's class ("Necromancer"): another class's unique or aspect is no use to it */
  className?: string;
  /** the seal and charms you were last seen wearing */
  talisman?: Talisman;
}

type Out = Omit<JudgeResult, "id" | "at" | "ms" | "thumb">;

/** How long the memory of a ring (weapon) the game isn't showing is trusted: about a play session. */
const WORN_TRUST_MS = 6 * 3600_000;

/** "a", "a and b", "a, b and c" */
const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

/** How to call a worn item: its name, or its aspect when OCR garbled the name ("Eceues S Ef"). */
function itemLabel(it: ParsedItem): string {
  const ws = it.name.match(/[A-Za-z][A-Za-z'’\-]+/g) ?? [];
  const readable = ws.length > 0 && (!ocrVocabReady() || ws.filter(knownWord).length >= Math.ceil(ws.length / 2));
  return readable || !it.aspect?.name ? it.name : it.aspect.name;
}

/** The first number of each affix ("+3,577 Maximum Life" → "3577"), for telling two copies apart. */
const affixNumbers = (it: ParsedItem) =>
  it.affixes.map((a) => a.text.match(/\d[\d,]*(\.\d+)?/)?.[0].replace(/,/g, "").replace(/\.0+$/, "")).filter((n): n is string => !!n);

/**
 * Is this unequipped tooltip the item you wear in that slot? Same name or aspect, same
 * item power and (nearly) the same affix values: the Character panel's tooltip, read once
 * without its "EQUIPPED" header / "Unequip" hint. OCR may drop or garble a line or two.
 */
export function sameAsWorn(item: ParsedItem, worn: ParsedItem): boolean {
  const named = (!!normName(item.name) && normName(item.name) === normName(worn.name)) || (!!item.aspect?.name && !!worn.aspect?.name && normName(item.aspect.name) === normName(worn.aspect.name));
  if (!named || item.slot !== worn.slot) return false;
  if (item.itemPower && worn.itemPower && item.itemPower !== worn.itemPower) return false;
  return sameNumbers(item, worn);
}

/** (Nearly) the same affix values, for telling two copies apart: OCR may drop or garble a line or two. */
function sameNumbers(item: ParsedItem, worn: ParsedItem): boolean {
  const a = affixNumbers(item);
  const b = affixNumbers(worn);
  let common = 0;
  const rest = [...b];
  for (const n of a) {
    const k = rest.indexOf(n);
    if (k >= 0) {
      common++;
      rest.splice(k, 1);
    }
  }
  return common >= 3 && common >= 0.7 * Math.max(a.length, b.length);
}

/** Uniques and mythics keep their own power: the Occultist can't imprint an aspect onto them. */
const isUniqueItem = (item: ParsedItem) => /unique|mythic/i.test(item.rarity);

const CLASS_ONLY = /\b(barbarian|druid|necromancer|rogue|sorcerer|spiritborn|paladin|warlock)s?\s+only\b/i;
/** name → the classes that have it ("" = every class), per table */
const classesByName = new Map<Category, Map<string, Set<string>>>();

/**
 * The classes a unique, aspect or charm belongs to (the game's data), by name: one entry per class for
 * a shared aspect, none for one every class can use (null). Built once the tables are loaded.
 */
function classesOf(cat: Category, name: string): string[] | null {
  let m = classesByName.get(cat);
  if (!m) {
    const entries = Object.values(table(cat));
    if (!entries.length) return null;
    m = new Map();
    for (const e of entries) {
      const k = normName(e.n);
      if (!m.has(k)) m.set(k, new Set());
      m.get(k)!.add(e.c ?? "");
    }
    classesByName.set(cat, m);
  }
  const cs = m.get(normName(name));
  return cs && !cs.has("") ? [...cs] : null;
}

/**
 * The classes that can use this item (["necromancer"]), or null for any: the tooltip saying so
 * ("Sorcerer Only"), or a class's own unique, legendary aspect or charm. An imprinted aspect came from your Codex.
 */
export function itemClasses(item: ParsedItem): string[] | null {
  const said = `${item.itemType}\n${item.rawText ?? ""}`.match(CLASS_ONLY)?.[1];
  if (said) return [said.toLowerCase()];
  const r = rarityOf(item);
  if (r === "unique" || r === "mythic") return classesOf("uniques", item.name);
  if (item.category === "talisman" || item.slot === "charm") return classesOf("charms", item.name);
  if (r === "legendary" && item.aspect?.name && !item.aspect.imprinted) return classesOf("aspects", item.aspect.name);
  return null;
}

/**
 * The to-do list for an item you wear (or are about to): Occultist imprint/enchant,
 * Blacksmith temper & masterwork, sockets, and a Horadric Cube mythic upgrade later.
 */
function upkeep(item: ParsedItem, slot: GearSlot, q: Quality, p: SlotProgress, wearing: boolean, prof?: BuildProfile): string[] {
  const steps: string[] = [];
  if (slot.kind === "aspect" && !q.isTarget && !isUniqueItem(item)) {
    const current = item.aspect?.name && !sameItem(item.aspect.name, slot.itemName) ? ` (it replaces ${item.aspect.name})` : "";
    steps.push(`Occultist → Imprint "${slot.itemName}" onto it${current}.`);
  }
  // stats that are the build's temper target count as "tempered", never as reroll candidates
  const temperNames = slot.tempers.map((t) => t.name.replace(/\s*\(.*\)\s*$/, ""));
  const isTemperStat = (t: string) => temperNames.some((n) => similarity(t, n) >= 0.8);
  // the Occultist allows ONE enchant per item: if one stat is already enchanted, only that one can change
  const enchanted = item.affixes.find((a) => a.enchanted);
  const want = q.missing[0];
  // what a stat is worth here; without the build's weights, a wanted stat is worth 1 and anything else little
  const worth = (a: ParsedItem["affixes"][number]) => (prof ? statWeight(statKey(a.match ?? a.text), slot, prof) : a.match ? 1 : 0.1);
  const wantWorth = want ? (prof ? statWeight(normName(want), slot, prof) : 1) : 0;
  // a misread line can still be the wanted stat ("x26% Critical St e Ramäge Multiplier"): never re-roll into what it already is
  const isWant = (a: ParsedItem["affixes"][number]) =>
    !!want && (a.match ? normName(a.match) === normName(want) : similarity(cleanAffix(a.text).replace(/^[+x\-\d.,%\s]+/i, ""), want) >= 0.75);
  // the base stat above the line ("1,594 Armor", "288 All Resist") can't be enchanted
  const implicit = (a: ParsedItem["affixes"][number]) => a === item.affixes[0] && /^\d[\d,.]*\s+(armor|all resist)/i.test(a.text);
  if (want && enchanted) {
    const usefulHere = (!!enchanted.match && q.matched.some((m) => normName(m) === normName(enchanted.match!))) || isWant(enchanted);
    if (!usefulHere && worth(enchanted) < wantWorth)
      steps.push(`Occultist → re-roll the enchanted "${cleanAffix(enchanted.text)}" into ${shortStat(want)} (an item takes one enchant, and it's already on that stat).`);
  } else if (want && !item.affixes.some(isWant)) {
    // give up the stat worth least to the build — never a ★ greater affix or the temper
    const pool = item.affixes.filter((a) => !a.tempered && !a.greater && !implicit(a) && !isTemperStat(a.text)).sort((x, y) => worth(x) - worth(y));
    const swap = pool[0];
    if (swap && worth(swap) < wantWorth)
      steps.push(`Occultist → Enchant: change "${cleanAffix(swap.text)}" into ${shortStat(want)} (one stat per item; it's the stat worth least to your build).`);
  }
  const tempered = item.affixes.some((a) => a.tempered || isTemperStat(a.text)) || (wearing && p.tempered);
  if (slot.tempers.length && !tempered)
    steps.push(`Blacksmith → Temper: ${slot.tempers.map((t) => t.name).join(" / ")}.`);
  const mw = slot.affixes.find((a) => a.masterwork);
  if (p.masterwork < 12) steps.push(`Blacksmith → Masterwork to +12 (if not done yet)${mw ? `; the big crits should land on ${shortStat(mw.name)}` : ""}.`);
  if (slot.sockets.length) steps.push(`Sockets: ${slot.sockets.map((s) => s.name).join(" + ")}.`);
  if (q.isTarget && (slot.kind === "unique" || slot.kind === "mythic") && rarityOf(item) !== "mythic")
    steps.push("Endgame: Horadric Cube → upgrade to Mythic (keeps stats, temper & masterwork).");
  return steps;
}

function out(item: ParsedItem, verdict: Verdict, action: string, reasons: string[], slot: GearSlot | null, q?: Quality): Out {
  return {
    item,
    verdict,
    action,
    reasons,
    slot: slot?.slot ?? null,
    matched: q?.matched ?? [],
    missing: q?.missing ?? [],
    greaterOnTargets: q?.greater ?? 0,
    score: q ? Math.round((100 * q.matched.length) / Math.max(1, q.total) + 12 * q.greater) : 0,
  };
}

const rarityOf = (i: ParsedItem) => (i.rarity ?? "").toLowerCase();

/**
 * What makes yours better, in words: "Yours (Ocelot's Eye of Reanimation) has Crit Chance and
 * Summon Damage; this has neither." With nothing on record for the slot: what the build wants there.
 */
function betterLine(item: ParsedItem, slot: GearSlot, q: Quality, worn: ParsedItem | null, wornQ: Quality | null): string {
  if (worn && wornQ) {
    // an item rebuilt from the comparison view (rarity "unknown") has no name of its own;
    // a worn piece you hovered (or the EQUIPPED column) has its real name
    const named = worn.rarity === "unknown" || /^your equipped item$/i.test(worn.name) ? "" : ` (${itemLabel(worn)})`;
    const yours = `Yours${named}`;
    const extra = wornQ.matched.filter((m) => !q.matched.includes(m)).map(shortStat);
    if (extra.length) return `${yours} has ${list(extra)}; this ${extra.length === 1 ? "doesn't" : extra.length === 2 ? "has neither" : "has none of them"}.`;
    if (wornQ.isTarget && !q.isTarget)
      return slot.kind === "aspect"
        ? `${yours} has ${slot.itemName}, the power your build wants on your ${slot.slotLabel}; this doesn't.`
        : `Yours is ${slot.itemName}, the unique your build wants on your ${slot.slotLabel}.`;
    if (wornQ.greater > q.greater) return `${yours} has ${wornQ.greater}★ greater affixes on wanted stats; this has ${q.greater || "none"}.`;
    if (worn.itemPower && item.itemPower && worn.itemPower > item.itemPower) return `${yours} has higher item power (${worn.itemPower} vs ${item.itemPower}).`;
    const same = q.matched.map(shortStat);
    return same.length ? `Same wanted stats as yours${named}: ${list(same)}. Nothing to gain by swapping.` : `Neither has the stats your build wants on your ${slot.slotLabel}; keep yours${named}.`;
  }
  const want = [...slot.implicits, ...slot.affixes].map((t) => shortStat(t.name));
  if (!want.length) return `Your ${slot.slotLabel} should be ${slot.itemName}.`;
  const have = q.matched.map(shortStat);
  return `For your ${slot.slotLabel} your build wants ${list(want)}; this has ${have.length ? "only " + list(have) : "none of them"}.`;
}

/**
 * What to do with an item you're NOT going to wear. `better` says what beats it (any scrap/sell
 * verdict for a slot the build uses must say why and what's better).
 */
/**
 * Is this a roll to keep whatever the build: 3–4★ greater affixes, a unique with 2★, or a legendary
 * whose two ★ land on stats your class uses. Returns why, or null.
 */
function topTier(item: ParsedItem, slot: GearSlot | null, prof: BuildProfile | null): string | null {
  const greater = item.affixes.filter((a) => a.greater);
  const r = rarityOf(item);
  if (r !== "legendary" && r !== "unique") return null;
  if (greater.length >= 3) return `${greater.length}★ greater affixes is a top-tier roll`;
  if (greater.length < 2) return null;
  if (r === "unique") return "a unique with 2★ greater affixes is a top-tier roll";
  const forYou = !!slot && !!prof && greater.every((a) => statWeight(statKey(a.match ?? a.text), slot, prof) >= 0.4);
  return forYou ? "2★ greater affixes on stats your class uses" : null;
}

function dispose(item: ParsedItem, gear: GearSlot[], why: string[], slot: GearSlot | null, q?: Quality, ctx?: Ctx, better?: string): Out {
  const r = rarityOf(item);
  const reasons = better && !why.includes(better) ? [...why, better] : why;
  const buildAspect = item.aspect?.name
    ? gear.find((g) => g.kind === "aspect" && (sameItem(item.aspect!.name, g.itemName) || similarity(item.aspect!.name, g.itemName) > 0.75))
    : undefined;
  if (r === "mythic") return out(item, "STASH", "Stash it: mythics are rare; keep it for other builds.", why, slot, q);
  // a top-tier roll is worth more than its materials, even when this build has no use for it
  const top = topTier(item, slot, ctx?.prof ?? null);
  if (top) return out(item, "STASH", `Stash it for later: ${top}.`, reasons, slot, q);
  const notes: string[] = [];
  if (buildAspect && item.aspect?.imprinted) {
    // an imprinted power came from your Codex already — salvaging it adds nothing new
    notes.push(`Its ${buildAspect.itemName} is imprinted (it came from your Codex), so salvaging it saves nothing new.`);
  } else if (buildAspect) {
    // already in the Codex: salvaging only helps when the game says it would upgrade it
    const upgrades = /upgrades an aspect/i.test(item.rawText ?? "");
    if (!ctx?.inCodex?.(buildAspect.itemSlug) || upgrades)
      return out(
        item,
        "EXTRACT",
        `Salvage it at the Blacksmith: that saves "${buildAspect.itemName}" to your Codex (keeps the bigger roll). Imprint it later at the Occultist.`,
        [...why, `Your build uses this power on your ${buildAspect.slotLabel}.`],
        slot,
        q,
      );
    notes.push(`Your Codex already has ${buildAspect.itemName}, and this roll doesn't upgrade it.`);
  }
  if (r === "legendary" || r === "unique") return out(item, "SCRAP", "Scrap it at the Blacksmith (Salvage) for materials.", [...reasons, ...notes], slot, q);
  return out(item, "SELL", "Sell it to any vendor (or scrap it).", [...reasons, ...notes], slot, q);
}

export function decide(item: ParsedItem, variant: BuildVariant | undefined, ctx: Ctx, compareTo?: ParsedItem | null): Out {
  const res = decideCore(item, variant, { ...ctx, prof: buildProfile(variant) }, compareTo);
  if (item.truncated) res.reasons = [...res.reasons, "Part of this tooltip is hidden: scroll it down to let me see everything."];
  if (res.verdict === "WEAR" && variant && res.slot) {
    const slot = variant.gear.find((g) => g.slot === res.slot);
    if (slot) res.steps = ["Equip it.", ...upkeep(item, slot, quality(item, slot), { ...ctx.prog(slot.slot), masterwork: 0, tempered: false }, false, buildProfile(variant))];
  }
  return res;
}

const titleSet = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

/** A key, not gear: a Hordes compass, a Nightmare or Escalation sigil, a Chronicle of Nightmares (even just its bottom half). */
const isKeyText = (t: string) => /\bsigil\b|chronicle of nightmares|dungeon affixes|vivid account of horrors|\bcompass\b|gates of hell/i.test(t);

/**
 * An Undercity tribute: offered at the Spirit Brazier before a run for better rewards. Says what it
 * earns, whether that's something your build still needs, and how much harder it makes the run.
 */
function tributeAdvice(item: ParsedItem, variant: BuildVariant | undefined): Out {
  const raw = (item.rawText ?? "").replace(/\s*\n\s*/g, " ");
  const gear = variant?.gear ?? [];
  const earns = raw.match(/(?:chance to e[a-z]rn|e[a-z]rn)\s+(.+?)(?:\.|only usable|kurast undercity|$)/i)?.[1]?.trim();
  const upgrade = raw.match(/reward upgrades?:\s*([a-z ]+?)(?=\s+[^a-z ]|\s+difficulty|\s+starting|$)/i)?.[1]?.trim();
  const harder = [
    raw.match(/\+(\d+)\s*monster power/i)?.[1] && `+${raw.match(/\+(\d+)\s*monster power/i)![1]} Monster Power`,
    raw.match(/starting time:\s*(\d+)\s*seconds/i)?.[1] && `${raw.match(/starting time:\s*(\d+)\s*seconds/i)![1]} s to start`,
    raw.match(/time bonus penalty:\s*-?(\d+)%/i)?.[1] && `time bonuses -${raw.match(/time bonus penalty:\s*-?(\d+)%/i)![1]}%`,
  ].filter(Boolean) as string[];
  const reasons: string[] = [];
  if (earns) reasons.push(`It earns ${earns.replace(/\bEam\b/g, "earn")}.`);
  else if (upgrade) reasons.push(`Reward upgrade: ${upgrade}.`);
  if (harder.length) reasons.push(`The run is harder: ${harder.join(", ")}.`);
  const usesTalismans = gear.some((g) => g.group === "talisman");
  const missingUnique = gear.find((g) => g.group === "gear" && (g.kind === "unique" || g.kind === "mythic"));
  // decide from what it earns, not the whole capture (neighbouring stash items can mention seals)
  const effect = earns ?? upgrade ?? "";
  // you carry tributes and use them: "Keep it", never "Stash it"
  if (/charm|seal|horadr/i.test(effect) && usesTalismans)
    return out(item, "KEEP", "Keep it: use it on an Undercity run, it earns charms and a Seal, which your build uses.", reasons, null);
  if (/mythic|unique/i.test(effect) && missingUnique)
    return out(item, "KEEP", "Keep it: use it on an Undercity run when you're chasing uniques or a Mythic.", reasons, null);
  return out(item, "KEEP", "Keep it: offer it at the Undercity Spirit Brazier before a run.", reasons, null);
}

/** Gems, runes, splinters, charms, consumables: never "scrap" them by gear rules. */
/** "Unlocks 6 Charm Slots" → 6 */
const charmSlots = (text?: string) => {
  const m = text?.match(/unlocks\s+(\d+)\s+charm/i);
  return m ? Number(m[1]) : null;
};

const isSealItem = (x: ParsedItem | null | undefined): x is ParsedItem => !!x && x.rarity !== "unknown" && /seal/i.test(`${x.itemType} ${x.name}`);

/**
 * A seal against the one you wear: the game's comparison column, else its "Properties lost when
 * equipped", else the seal you were last seen wearing. A mythic seal and more charm slots win.
 * null when there's nothing to compare with.
 */
function sealVerdict(item: ParsedItem, worn: ParsedItem | null | undefined, remembered?: ParsedItem | null): Out | null {
  const why: string[] = [];
  if (!isSealItem(worn)) {
    // no column for yours: the tooltip's "Properties lost when equipped" still says what yours has more of
    // ("Unlocks 1 Charm Slots", "Seal Power" for each power this one lacks)
    const lost = (item.rawText ?? "").split(/properties lost when equipped/i)[1];
    const more = charmSlots(lost);
    const powers = (lost?.match(/seal power/gi) ?? []).length;
    if (more || powers) {
      const what = [more ? `${more} more charm slot${more > 1 ? "s" : ""}` : "", powers ? `${powers} seal power${powers > 1 ? "s" : ""} this one doesn't have` : ""].filter(Boolean).join(" and ");
      return out(item, "SCRAP", `Salvage it: the seal you wear is better (${what}).`, [], null);
    }
    // nothing from the game: the seal you were last seen wearing
    if (!isSealItem(remembered)) return null;
    worn = remembered;
    why.push("Compared with the seal you were last seen wearing.");
  }
  const mine = charmSlots(item.rawText);
  const yours = charmSlots(worn.rawText);
  const mythic = (x: ParsedItem) => /mythic/i.test(`${x.rarity} ${x.itemType}`);
  const slots = mine != null && yours != null ? ` (${mine} charm slots vs your ${yours})` : "";
  if ((mythic(worn) && !mythic(item)) || (mine != null && yours != null && yours > mine))
    return out(item, "SCRAP", `Salvage it: your ${worn.name} is better${mythic(worn) && !mythic(item) ? ", a mythic seal" : ""}${slots}.`, why, null);
  if (mine != null && yours != null && mine > yours) return out(item, "WEAR", `Wear this seal: it unlocks more charm slots${slots}.`, why, null);
  return null;
}

/**
 * A spare of a charm you wear (same name): the better roll stays on. null when you don't wear one,
 * or either item power wasn't read.
 */
function spareCharm(item: ParsedItem, yours: ParsedItem | undefined): Out | null {
  if (!yours || !item.itemPower || !yours.itemPower) return null;
  const ip = `Item power ${item.itemPower} vs yours ${yours.itemPower}.`;
  // the same numbers: it's the one you wear, opened from the talisman without its "Unequip" hint
  if (item.itemPower === yours.itemPower && affixNumbers(item).join() === affixNumbers(yours).join())
    return out(item, "WEARING", "You're wearing this: it's in your talisman.", [], null);
  const ga = (x: ParsedItem) => x.affixes.filter((a) => a.greater).length;
  if (item.itemPower > yours.itemPower || (item.itemPower === yours.itemPower && ga(item) > ga(yours)))
    return out(item, "WEAR", `Wear this one: a better roll than the ${yours.name} you wear.`, [ip], null);
  return out(item, "SCRAP", `Salvage it: you already wear ${yours.name}, and yours is as good.`, [ip], null);
}

function decideNonGear(item: ParsedItem, variant: BuildVariant | undefined, compareTo?: ParsedItem | null, ctx?: Ctx): Out {
  // one you wear, hovered in the talisman panel
  if (item.equipped && item.category === "talisman") return out(item, "WEARING", "You're wearing this: it's in your talisman.", [], null);
  const gear = variant?.gear ?? [];
  const uses: { name: string; where: string }[] = [];
  for (const g of gear) {
    for (const s of g.sockets) uses.push({ name: s.name, where: `${g.slotLabel} socket` });
    if (g.group === "talisman") uses.push({ name: g.itemName, where: g.slotLabel });
  }
  const n = normName(item.name);
  const hit = uses.filter((u) => {
    const un = normName(u.name);
    // set charms share most of their name ("Mlor / Phoba of the Black Shroud"): only the same piece counts
    // a build that just says "Seal" takes any seal
    if (item.category === "talisman") return un.length > 2 && (n === un || trigramSim(u.name, item.name) >= 0.92 || (un === "seal" && item.slot === "seal"));
    return un.length > 2 && (n.includes(un) || un.includes(n) || trigramSim(u.name, item.name) >= 0.75);
  });
  // a spare seal: the one you wear may simply be better
  const seal = /seal/i.test(`${item.itemType} ${item.slot}`);
  if (item.category === "talisman" && seal) {
    const v = sealVerdict(item, compareTo, ctx?.talisman?.seal);
    if (v) return v;
  }
  // a spare of a charm you wear: only the better roll is worth wearing
  if (item.category === "talisman" && !seal) {
    const v = spareCharm(item, ctx?.talisman?.charms.find((c) => normName(c.name) === normName(item.name)));
    if (v) return v;
  }
  if (hit.length) {
    const where = [...new Set(hit.map((h) => h.where))].join(", ");
    return out(item, "SOCKET", `Keep it: your build uses ${hit[0].name} (${where}).`, [], null);
  }
  const all = item.rawText ?? "";
  if (item.category === "tribute") return tributeAdvice(item, variant);
  // things you carry and use say "Keep it" (in your bag); "Stash it" is for what you store away
  if (item.category === "socketable") {
    if (/amalgam/i.test(all)) return out(item, "KEEP", "Keep it: amalgamate it with others in the Horadric Cube into a stronger one.", ["Your build doesn't socket this one directly."], null);
    return out(item, "SELL", "Your build doesn't use this socketable: sell it or keep it for another build.", [], null);
  }
  // keys: Hordes compass, Escalation and Nightmare sigils, Chronicles of Nightmares (each opens something different)
  const keyText = `${item.name}\n${item.itemType ?? ""}\n${all}`;
  if (isKeyText(keyText)) {
    const lines = all.split("\n").map((l) => l.trim());
    const dungeon = lines.find((l) => / in [A-Z][a-z]+/.test(l) && !/affix|gates of hell|hordes/i.test(l))?.replace(/\s+in\s+.*$/, "").replace(/^[^A-Za-z]+/, "") ?? null;
    const ai = lines.findIndex((l) => /dungeon affixes/i.test(l));
    const affixes = ai >= 0 ? lines.slice(ai + 1, ai + 4).filter((l) => l.length > 3 && !/vivid account|account bound|seasonal|sell value/i.test(l)) : [];
    const why = affixes.length ? [`Affixes: ${affixes.join(", ")}.`] : [];
    const at = dungeon ? ` (${dungeon})` : "";
    if (/compass|gates of hell|infernal hordes/i.test(keyText)) return out(item, "KEEP", "Keep it: it opens the Infernal Hordes. It isn't gear.", why, null);
    if (/escalation/i.test(keyText)) return out(item, "KEEP", `Keep it: it opens an Escalating Nightmare, a series of dungeons${at}. It isn't gear.`, why, null);
    if (/chronicle|vivid account of horrors/i.test(keyText)) return out(item, "KEEP", `Keep it: use it on a Waking Nightmare${at}. It isn't gear.`, why, null);
    return out(item, "KEEP", `Keep it: it opens a Nightmare Dungeon${at}. It isn't gear.`, why, null);
  }
  if (/horadric cube|cube material/i.test(keyText)) return out(item, "KEEP", "Keep it: it's for the Horadric Cube, not gear.", [], null);
  if (item.category === "talisman") {
    // "Peace of the Black Shroud": another piece of a set your build wears
    const setOf = (n: string) => normName(n).match(/ of the (.+)$/)?.[1] ?? "";
    const set = setOf(item.name);
    const sameSet = set ? gear.find((g) => g.group === "talisman" && setOf(g.itemName) === set) : undefined;
    if (sameSet) return out(item, "STASH", `Stash it: it's from the ${titleSet(set)} set your build uses.`, [`Your build wears ${gear.filter((g) => g.group === "talisman" && setOf(g.itemName) === set).map((g) => g.itemName).join(", ")}.`], null);
    return out(item, "STASH", "Stash it: it isn't part of your build's talisman (or salvage it if you have spares).", [], null);
  }
  if (/amount of\s+experience|experience tome/i.test(keyText)) return out(item, "KEEP", "Keep it: use it from your bag, it grants experience. It isn't gear.", [], null);
  if (/\bcache\b|receive your rewards/i.test(keyText)) return out(item, "KEEP", "Keep it: open it from your bag to get the rewards inside. It isn't gear.", [], null);
  return out(item, "KEEP", "Keep it: it isn't gear, nothing to judge here.", [], null);
}

/** An item you wear in a build slot: how it measures up and its to-do list (never a scrap verdict). */
function wearing(item: ParsedItem, slot: GearSlot, ctx: Ctx, lead?: string): Out {
  const q = quality(item, slot);
  const tips: string[] = lead ? [lead] : [];
  if (!q.isTarget) tips.push(`Your build wants ${slot.itemName} here: this is a stand-in.`);
  tips.push(`${q.matched.length} of ${q.total} stats your build wants${q.greater ? `, ${q.greater} are ★ greater` : ""}.`);
  const steps = upkeep(item, slot, q, ctx.prog(slot.slot), true, ctx.prof);
  const action = steps.length ? steps[0] : "Fully done: nothing left to improve here.";
  return { ...out(item, "WEARING", action, tips, slot, q), steps };
}

function decideCore(item: ParsedItem, variant: BuildVariant | undefined, ctx: Ctx, compareTo?: ParsedItem | null): Out {
  // the AI parse doesn't always say what kind of item it is: charms, seals and caches aren't gear
  const text = `${item.name}\n${item.itemType ?? ""}\n${item.rawText ?? ""}`;
  const category =
    /\btribute\b|undercity spirit brazier/i.test(text)
      ? "tribute"
      : isKeyText(text) || /horadric cube|cube material/i.test(text)
        ? "consumable"
        : (item.category ??
        (item.slot === "charm" || item.slot === "seal" ? "talisman" : item.slot === "other" && /\bcache\b|collection of/i.test(text) ? "consumable" : undefined));
  // only a seal "Unlocks N Charm Slots": a capture that starts below the title left the AI read guessing
  // ("Legendary Horadric Seal", slot "offhand"), and it was scrapped as gear (2026-10-11 RC test)
  if (category !== "tribute" && category !== "consumable" && /unlocks\s+\d+\s+charm\s+slots|horadric seal/i.test(`${text}\n${item.affixes.map((a) => a.text).join("\n")}`))
    return decideNonGear({ ...item, category: "talisman", slot: "seal", itemType: item.itemType || "Horadric Seal" }, variant, compareTo, ctx);
  if (category && category !== "gear") return decideNonGear({ ...item, category }, variant, compareTo, ctx);
  if (!variant) return out(item, "UNKNOWN", "Import your build first (Build page).", [], null);
  const gear = variant.gear.filter((g) => g.group === "gear");
  const r = rarityOf(item);
  const isWhite = r === "common" || /\bcommon\b/i.test(item.itemType);

  // ---- you're wearing it ----
  if (item.equipped) {
    const slot =
      gear.find((g) => (g.kind === "unique" || g.kind === "mythic") && sameItem(item.name, g.itemName)) ??
      (SLOT_MAP[item.slot] ?? []).map((k) => gear.find((g) => g.slot === k)).find(Boolean) ??
      null;
    if (!slot) return out(item, "WEARING", "You're wearing this: this slot isn't part of your build.", [], null);
    return wearing(item, slot, ctx);
  }

  // another class's own unique or aspect: no use to this build, whatever its stats
  const only = ctx.className ? itemClasses(item) : null;
  if (only && !only.includes(ctx.className!.toLowerCase())) return dispose(item, gear, [`It's for a ${only.map(titleSet).join(" or ")}, not your ${ctx.className}.`], null, undefined, ctx);

  // ---- white base that the cube turns into a build unique ----
  if (isWhite) {
    for (const g of gear) {
      if (g.kind !== "unique" && g.kind !== "mythic") continue;
      const hint = ctx.cubeHint?.(g);
      if (!hint) continue;
      // "2h Scythe" vs tooltip "Two-Handed Scythe": compare the last word + handedness
      const want = normName(hint.baseType);
      const have = normName(item.itemType).replace("two handed", "2h").replace("one handed", "1h");
      const typeOk = have.includes(want) || (have.split(" ").pop() === want.split(" ").pop() && have.includes("2h") === want.includes("2h"));
      if (!typeOk || ctx.prog(g.slot).state !== "missing") continue;
      const sure = hint.pool.length <= 1;
      return out(
        item,
        "CUBE",
        sure ? `Horadric Cube it → becomes ${g.itemName}!` : `Horadric Cube it → random ${hint.baseType} unique (${g.itemName} is 1 of ${hint.pool.length}).`,
        [`Recipe: ${hint.recipe}`, ...(sure ? [] : [`Possible results: ${hint.pool.join(", ")}.`]), `${g.itemName} is your build's ${g.slotLabel}.`],
        g,
      );
    }
  }

  // ---- which build slot would it go in? ----
  const named = gear.find((g) => (g.kind === "unique" || g.kind === "mythic") && sameItem(item.name, g.itemName));
  const candidates = named ? [named] : ((SLOT_MAP[item.slot] ?? []).map((k) => gear.find((g) => g.slot === k)).filter(Boolean) as GearSlot[]);
  // rings/weapons: the game compares with ONE of your two (Alt switches) and says which kind it is;
  // the other one is still judged, against what you were last seen wearing there
  const isUniq = (g: GearSlot) => g.kind === "unique" || g.kind === "mythic";
  // the game's piece belongs to the slot you were last seen wearing it in: its numbers (or the EQUIPPED
  // column's name and numbers) against each slot's memory; true / false / null = can't tell
  const seen =
    compareTo && candidates.length > 1
      ? candidates.map((c) => (isUniq(c) && compareTo.rarity !== "unknown" && sameItem(compareTo.name, c.itemName)) || comparedIsWorn(compareTo, item.compareRows, ctx.worn?.(c.slot)))
      : [];
  // it's none of the pieces you remember: you've replaced one since (a ring you took off stayed in Ring 1
  // and made a wrong "wear this"), and nothing says which, so the game's piece stands in for both
  const stale = seen.length > 0 && seen.every((m) => m === false);
  const compared = seen.some((m) => m === true)
    ? candidates.filter((_, i) => seen[i] === true)
    : stale
      ? candidates
      : seen.some((m) => m === false)
        ? candidates.filter((_, i) => seen[i] !== false)
        : !named && item.compareKind && candidates.length > 1
          ? candidates.filter((g) => (item.compareKind === "unique") === isUniq(g))
          : candidates;
  // the game's piece is what you wear now; the other ring's memory only counts while it's sure: not in
  // doubt (gearTrack.ts) unless the game shows it, and seen this play session
  const unsure = (c: GearSlot, i: number) => {
    const w = ctx.worn?.(c.slot);
    if (!w || seen[i] === true) return false;
    return stale || !!w.doubt || (!!compareTo && !compared.includes(c) && !!w.at && Date.now() - w.at > WORN_TRUST_MS);
  };
  const forget = new Set(candidates.filter(unsure).map((c) => c.slot));
  if (forget.size) {
    const remembered = ctx.worn;
    ctx = { ...ctx, worn: (s) => (forget.has(s) ? undefined : remembered?.(s)) };
  }
  const gameCompares = (c: GearSlot) => !compared.length || compared.includes(c);
  if (!candidates.length) return dispose(item, gear, ["Your build doesn't use this kind of item."], null, undefined, ctx);

  // the same name/aspect and stat values as what you wear there: it IS your item, opened from the
  // Character panel without its "EQUIPPED" header (the game never compares an item with itself)
  if (!compareTo && !item.compareRows?.length)
    for (const c of candidates) {
      const w = ctx.worn?.(c.slot);
      if (w && sameAsWorn(item, w)) return wearing(item, c, ctx, `This looks like the one you're wearing (your ${c.slotLabel}).`);
    }

  // pick the slot where it would help most (matters for rings)
  const prof = ctx.prof ?? buildProfile(variant);
  let best: { slot: GearSlot; q: Quality; gain: number; w: ParsedItem | null; wornQ: Quality | null; cmp: Swap | null } | null = null;
  for (const c of candidates) {
    const q = quality(item, c);
    const w = (compareTo && compareTo.slot === item.slot && gameCompares(c) ? compareTo : null) ?? ctx.worn?.(c.slot) ?? null;
    const wornQ = w ? quality(w, c) : null;
    // the game's comparison doesn't name your piece: what you were last seen wearing does
    const remembered = ctx.worn?.(c.slot);
    // (or names it so garbled it matches nothing: "Blood Mo N Che G" is the Blood Moon Breeches you wear)
    if (wornQ && remembered && !wornQ.isTarget && (w!.rarity === "unknown" || trigramSim(w!.name, remembered.name) >= 0.35)) wornQ.isTarget = quality(remembered, c).isTarget;
    const cmp = swapValue(item, c, q, w, wornQ, prof, gameCompares(c) ? item.compareRows : undefined, workOn(c, w, ctx), remembered);
    const gain = cmp ? cmp.score : standaloneValue(item, c, prof) - 99;
    if (!best || gain > best.gain) best = { slot: c, q, gain, w, wornQ, cmp };
  }
  const { slot, q, w, wornQ, cmp } = best!;
  const better = betterLine(item, slot, q, w, wornQ);
  const p = ctx.prog(slot.slot);
  const hasStr = (x: Quality) => `${x.matched.length} of ${x.total} wanted stats${x.greater ? ` (${x.greater}★)` : ""}`;

  // a build unique you don't have yet → wear it
  if (q.isTarget && (slot.kind === "unique" || slot.kind === "mythic") && !wornQ?.isTarget && p.state === "missing")
    return out(item, "WEAR", `Wear this! It's a core piece of your build (${slot.slotLabel}).`, [`Has ${hasStr(q)}.`], slot, q);

  // a unique slot where yours is the real thing and this isn't: the unique's power wins
  const slotIsUnique = slot.kind === "unique" || slot.kind === "mythic";
  if (slotIsUnique && !q.isTarget && (wornQ?.isTarget || (!w && p.state !== "missing")))
    return dispose(item, gear, [`Your ${slot.slotLabel} should be ${slot.itemName}.`], slot, q, ctx, w ? better : undefined);

  // compare with what you wear, weighing every stat by what it does for your build
  if (cmp) {
    const wornItem = ctx.worn?.(slot.slot) ?? w;
    const upgraded = !!wornItem?.affixes.some((a) => a.masterwork || a.tempered || a.enchanted) || p.masterwork > 0;
    // yours is compared without its masterwork/temper, so redoing them is the only extra cost
    const need = upgraded ? 0.8 : 0.5;
    // the biggest differences, and always the worst loss: a "better" with no downside shown hides the trade
    const top = cmp.lines.slice(0, 5);
    if (cmp.worstLoss && !top.includes(cmp.worstLoss)) top.splice(Math.min(4, top.length), 1, cmp.worstLoss);
    // a swap that gives up nearly as much as it gains isn't an upgrade, whatever the sum says
    const clear = cmp.score >= need && cmp.score >= 0.5 * cmp.loss;
    const yours = w && w.rarity !== "unknown" && !/^your equipped item$/i.test(w.name) ? ` (${itemLabel(w)})` : "";
    // rings / weapons: the game showed the other one; say which one this is weighed against
    const other = candidates.length > 1 && !gameCompares(slot) ? ` Weighed against your ${slot.slotLabel}, not the one the game compares it with.` : "";
    const verdictLine = `For your build: ${cmp.score >= 1.5 && clear ? "clearly better" : clear ? "better" : cmp.score > 0.15 ? "slightly better" : cmp.score > -0.15 ? "about the same as" : cmp.score > -1 ? "a bit worse" : "worse"}${cmp.score > -0.15 && cmp.score <= 0.15 ? "" : " than"} yours${yours}.${other}`;
    if (clear) {
      const extra = slot.kind === "aspect" && !q.isTarget && !isUniqueItem(item) ? ` Then put "${slot.itemName}" on it at the Occultist.` : "";
      const stand = slotIsUnique && !q.isTarget ? ` Use it until you find ${slot.itemName}.` : "";
      const why = [verdictLine, ...(cmp.work ? [cmp.work] : []), ...top];
      if (upgraded) why.push("Masterwork and temper it like your old one: budget the materials.");
      return out(item, "WEAR", `Wear this: it's better than yours.${extra}${stand}`, why, slot, q);
    }
    const why = [verdictLine, ...(cmp.work ? [cmp.work] : []), ...top];
    if (cmp.score >= need) why.push("It gives up nearly as much as it gains: a trade, not an upgrade.");
    else if (cmp.score > 0.15 && upgraded) why.push("Not enough to be worth redoing the masterwork/temper.");
    if (!top.length) why.push(better);
    return dispose(item, gear, why, slot, q, ctx);
  }

  // no idea what you're wearing yet: judge on its own
  const alone = standaloneValue(item, slot, prof);
  if (q.matched.length >= Math.min(3, q.total) || (q.matched.length >= 2 && alone >= 2.4)) {
    const extra = slot.kind === "aspect" && !q.isTarget && !isUniqueItem(item) ? ` Put "${slot.itemName}" on it at the Occultist.` : "";
    return out(item, "WEAR", `Probably wear this: good stats for your ${slot.slotLabel}.${extra}`, [`Has ${hasStr(q)}.`, "Hover your equipped piece once so I can compare exactly."], slot, q);
  }
  return dispose(item, gear, [`Only ${hasStr(q)} for your ${slot.slotLabel}.`], slot, q, ctx, better);
}

/** What's been done to the piece you wear in this slot: masterwork rank, tempered and masterwork-crit stats. */
interface Work {
  rank: number;
  tempered: Set<string>;
  crit: Set<string>;
  /** your piece's one Occultist enchant (a new item can get the same one) */
  enchanted: Set<string>;
}

function workOn(slot: GearSlot, w: ParsedItem | null, ctx: Ctx): Work | null {
  const remembered = ctx.worn?.(slot.slot);
  const src = [...(w?.affixes ?? []), ...(remembered?.affixes ?? [])];
  const key = (a: { text: string; match?: string | null }) => (a.match ? normName(a.match) : statKey(a.text));
  const crit = new Set(src.filter((a) => a.masterwork).map(key));
  const tempered = new Set(src.filter((a) => a.tempered).map(key));
  const enchanted = new Set(src.filter((a) => a.enchanted).map(key));
  const p = ctx.prog(slot.slot);
  if (p.tempered) for (const t of slot.tempers) tempered.add(normName(t.name.replace(/\s*\(.*\)\s*$/, "")));
  // a crit lands every 4th rank: seeing one means at least rank 4
  const rank = Math.max(p.masterwork ?? 0, 4 * Math.min(3, crit.size));
  return rank || tempered.size || enchanted.size ? { rank, tempered, crit, enchanted } : null;
}

// Masterworking (estimate): each non-crit rank adds ~5% to every affix, each crit (ranks 4/8/12) +25% to one.
const masterworkFactor = (rank: number, crit: boolean) => (1 + 0.05 * (rank - Math.floor(rank / 4))) * (crit ? 1.25 : 1);

interface Swap {
  /** "Yours is masterworked +12 and tempered: compared as if this one gets the same." */
  work?: string;
  score: number;
  /** the biggest differences first, ready to show */
  lines: string[];
  /** everything the swap gives up, summed (positive) */
  loss: number;
  /** the line for the single biggest loss */
  worstLoss?: string;
}

const firstNumber = (t: string) => {
  const m = t.match(/\d[\d,]*(\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
};
const rowKey = (label: string, match?: string | null) => (match ? normName(match) : statKey(label));

/**
 * The game's comparison lists what you'd lose under "Properties lost when equipped", and a tooltip
 * cut off at the bottom loses part of that list. When the piece you were last seen wearing matches
 * every number the game does show, its other stats are what's missing: add them as yours-only.
 */
function withRemembered(rows: CompareRow[], rem: ParsedItem | null | undefined): CompareRow[] {
  if (!rem || rem.rarity === "unknown" || !rem.affixes.length || rowsAgree(rows, rem) !== true) return rows;
  const theirs = rem.affixes.map((a) => ({ key: rowKey(a.text, a.match), v: firstNumber(a.text), a }));
  const have = new Set(rows.map((r) => rowKey(r.label, r.match)));
  const extra: CompareRow[] = [];
  for (const t of theirs) {
    if (t.v == null || have.has(t.key)) continue;
    have.add(t.key);
    extra.push({ label: cleanAffix(t.a.text).replace(/^[+x\-]?\s*[\d.,]+%?\s*/i, ""), mine: null, yours: t.v, unit: /%/.test(t.a.text) ? "%" : "", wanted: false, match: t.a.match ?? null });
  }
  return extra.length ? [...rows, ...extra] : rows;
}

/**
 * Do the comparison's numbers for yours (its deltas worked back) match a remembered piece? true when
 * they agree (one OCR slip in a few allowed), false when they don't, null when too few are shared to tell.
 */
function rowsAgree(rows: CompareRow[] | undefined, rem: ParsedItem): boolean | null {
  if (!rows?.length) return null;
  const theirs = rem.affixes.map((a) => ({ key: rowKey(a.text, a.match), v: firstNumber(a.text) }));
  let agree = 0;
  let differ = 0;
  for (const r of rows) {
    if (r.yours == null) continue;
    const same = theirs.filter((t) => t.key === rowKey(r.label, r.match) && t.v != null);
    if (!same.length) continue;
    if (same.some((t) => Math.abs(t.v! - r.yours!) <= Math.max(Math.abs(t.v!), 1) * 0.03)) agree++;
    else differ++;
  }
  if (agree >= 2 && differ * 3 <= agree) return true;
  return differ > 0 ? false : null;
}

/**
 * Is `worn` (what you were last seen wearing in a slot) the piece the game compares this item with?
 * The comparison's numbers decide; else the EQUIPPED column's stat values or name. null when nothing tells.
 */
export function comparedIsWorn(compareTo: ParsedItem | null | undefined, rows: CompareRow[] | undefined, worn: ParsedItem | null | undefined): boolean | null {
  if (!worn || worn.rarity === "unknown") return null;
  const byRows = rowsAgree(rows, worn);
  if (byRows !== null) return byRows;
  if (!compareTo || compareTo.rarity === "unknown" || /^your equipped item$/i.test(compareTo.name)) return null;
  // a garbled title ("Blood Mo N Che G") still has the same numbers
  return sameNumbers(compareTo, worn) || sameItem(compareTo.name, worn.name) || trigramSim(compareTo.name, worn.name) >= 0.6;
}

/** The numbers in a power's text, in order ("up to 100% and deal 235%" → [100, 235]). */
const powerNumbers = (text?: string) => [...(text ?? "").matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((m) => Number(m[1]));

/**
 * Swapping to `item` from what you wear, scored for the build: the in-game comparison's numbers
 * when there are some, else the two parsed items stat by stat. Uniques, build aspects and
 * greater affixes add to it. null when nothing is known about your piece.
 */
function swapValue(
  item: ParsedItem,
  slot: GearSlot,
  q: Quality,
  w: ParsedItem | null,
  wornQ: Quality | null,
  prof: BuildProfile,
  gameRows?: CompareRow[],
  work?: Work | null,
  remembered?: ParsedItem | null,
): Swap | null {
  const raw = gameRows?.length ? withRemembered(gameRows, remembered) : w ? rowsFromItems(item, w) : null;
  if (!raw) return null;
  // compare like with like: yours without its masterwork, and a temper this one can get too doesn't count against it
  // an item takes one temper per temper slot; one that shows no tempered line yet can still take yours
  const canTemper = !item.affixes.some((a) => a.tempered);
  // an item takes one enchant: if this one has none yet, it can get your enchanted stat in place of its weakest
  const canEnchant = !item.affixes.some((a) => a.enchanted);
  let enchantSwap = false;
  const shown = new WeakMap<CompareRow, number | null>(); // the number the game shows, for the reasons
  const rows = !work
    ? raw
    : raw.flatMap((r) => {
        const key = r.match ? normName(r.match) : statKey(r.label);
        if (canTemper && r.mine == null && work.tempered.has(key)) return [];
        if (canEnchant && r.mine == null && work.enchanted.has(key)) {
          enchantSwap = true;
          return [];
        }
        // skill ranks are whole numbers: no estimate of them "before masterwork"
        if (r.yours == null || !work.rank || /^ranks? (to|of) /.test(key)) return [r];
        const adj = { ...r, yours: Math.round((r.yours / masterworkFactor(work.rank, work.crit.has(key))) * 10) / 10 };
        shown.set(adj, r.yours);
        return [adj];
      });
  const workNote = work
    ? `Yours is ${[work.rank ? `masterworked +${work.rank}` : "", work.tempered.size ? "tempered" : "", work.enchanted.size ? "enchanted" : ""].filter(Boolean).join(" and ")}: compared as if this one gets the same work${work.rank ? " (masterwork bonus estimated)" : ""}.`
    : undefined;
  // a cut-off tooltip hides "Properties lost when equipped": its "yours has none" stats are only half the story
  const oneSided = !!gameRows?.length && !!item.truncated && !rows.some((r) => r.mine == null);
  const used = oneSided ? rows.filter((r) => r.yours != null) : rows;
  const { score: stats, deltas } = compareValue(used, slot, prof);
  let score = stats;
  const notes: { v: number; text: string }[] = [];
  // the enchant replaces this item's weakest stat (never a ★ or the base stat), so that stat's worth is lost
  if (enchantSwap) {
    const pool = item.affixes.filter((a) => !a.greater && !a.tempered && !(a === item.affixes[0] && /^\d[\d,.]*\s+(armor|all resist)/i.test(a.text)));
    const weakest = pool.map((a) => ({ a, w: statWeight(statKey(a.match ?? a.text), slot, prof) })).sort((x, y) => x.w - y.w)[0];
    if (weakest) {
      score -= weakest.w;
      notes.push({ v: -weakest.w, text: `− Enchanting your stat onto it replaces its ${shortStat(cleanAffix(weakest.a.text).replace(/^[+x\-\d.,%\s]+/i, ""))}` });
    }
  }
  // the build's unique (its power is the point of the slot)
  if (slot.kind === "unique" || slot.kind === "mythic") {
    if (q.isTarget && !wornQ?.isTarget) (score += 3), notes.push({ v: 3, text: `+ It's ${slot.itemName}, the unique your build wants here` });
    if (!q.isTarget && wornQ?.isTarget) (score -= 3), notes.push({ v: -3, text: `− Yours is ${slot.itemName}, the unique your build wants here` });
  }
  // a unique in a slot the build fills with an aspect: it can never get that aspect
  if (slot.kind === "aspect" && isUniqueItem(item) && !q.isTarget) {
    score -= 1;
    notes.push({ v: -1, text: `− It's a unique: it can't take ${slot.itemName} (only its stats can be changed)` });
  } else if (slot.kind === "aspect" && q.isTarget !== !!wornQ?.isTarget) {
    // the build's aspect on it saves an imprint (yours can be imprinted later, so it counts less)
    const v = q.isTarget ? 0.6 : -0.4;
    score += v;
    notes.push({ v, text: q.isTarget ? `+ Already has ${slot.itemName} (saves an imprint)` : `− Yours already has ${slot.itemName}` });
  }
  // the same unique: a bigger roll on its power is worth a lot (the power is the point of the slot). The game's
  // comparison copies this item's power text, so yours comes from what you were last seen wearing.
  if (slot.kind === "unique" || slot.kind === "mythic") {
    const theirs = [remembered, w].find((x) => x && x.rarity !== "unknown" && x.aspect?.text && sameItem(x.name, item.name));
    // the rolled number is the first one that differs (fixed ones like "up to 100%" are the same on both)
    const mineN = powerNumbers(item.aspect?.text);
    const theirN = powerNumbers(theirs?.aspect?.text);
    const at = mineN.findIndex((n, i) => theirN[i] != null && n !== theirN[i]);
    const a = at >= 0 ? mineN[at] : null;
    const b = at >= 0 ? theirN[at] : null;
    if (a != null && b != null && similarity(item.aspect!.text, theirs!.aspect!.text) >= 0.6) {
      const v = Math.max(-1, Math.min(1, ((a - b) / Math.max(a, b)) * 8));
      score += v;
      notes.push({ v, text: `${v > 0 ? "+" : "−"} Unique power ${a}% vs yours ${b}%` });
    }
  }
  // the game's own Toughness change for the swap (armor, resistances and life together)
  if (item.toughness != null && Math.abs(item.toughness) >= 2) {
    const v = Math.max(-0.5, Math.min(0.5, item.toughness / 30));
    score += v;
    notes.push({ v, text: item.toughness < 0 ? `− Toughness ${Math.abs(item.toughness)}% lower` : `+ Toughness ${item.toughness}% higher` });
  }
  // greater affixes on stats the build wants
  const gaWorth = (it: ParsedItem) =>
    it.affixes.filter((a) => a.greater).reduce((s, a) => s + 0.25 * statWeight(statKey(a.match ?? a.text), slot, prof), 0);
  const gaMine = gaWorth(item);
  const gaYours = !w || w.rarity === "unknown" ? 0 : gaWorth(w); // rebuilt from the comparison: greater unknown
  if (Math.abs(gaMine - gaYours) > 0.05) {
    score += gaMine - gaYours;
    notes.push({ v: gaMine - gaYours, text: gaMine > gaYours ? "+ More ★ greater affixes on stats you want" : "− Yours has more ★ greater affixes on stats you want" });
  }
  const fmt = (v: number | null, u: string) => (v == null ? "—" : `${v.toLocaleString()}${u}`);
  for (const [i, d] of deltas.entries()) {
    if (Math.abs(d.value) < 0.05) continue;
    const yours = shown.has(used[i]) ? shown.get(used[i])! : d.yours;
    // yours was compared without its masterwork: say which number that was, or "+ 461 vs yours 476" reads backwards
    const est = yours != null && d.yours != null && Math.abs(yours - d.yours) > Math.abs(yours) * 0.03 ? ` (about ${fmt(d.yours, d.unit)} before its masterwork)` : "";
    const name = shortStat(d.label.replace(/\s*\(.*$/, "").replace(/^to /i, "Ranks to ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (To|Of) /g, (m) => m.toLowerCase()));
    const minor = d.weight <= 0.1 ? " (minor for your build)" : "";
    const text =
      d.mine != null && d.yours == null
        ? `+ ${name} ${fmt(d.mine, d.unit)} (yours has none)${minor}`
        : d.mine == null
          ? `− ${name}: yours has ${fmt(yours, d.unit)}, this has none${minor}`
          : `${d.value > 0 ? "+" : "−"} ${name} ${fmt(d.mine, d.unit)} vs yours ${fmt(yours, d.unit)}${est}${minor}`;
    notes.push({ v: d.value, text });
  }
  notes.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));
  const losses = notes.filter((n) => n.v < 0);
  return {
    score,
    work: workNote,
    lines: notes.map((n) => n.text),
    loss: -losses.reduce((a, n) => a + n.v, 0),
    worstLoss: losses.sort((a, b) => a.v - b.v)[0]?.text,
  };
}

/** Back-compat wrapper. */
export function scoreItem(item: ParsedItem, variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress, equipped?: ParsedItem | null) {
  return decide(item, variant, { prog }, equipped);
}

/** How each verdict is shown: label, Lucide icon (render it in `color`) and colour. */
export const VERDICT_STYLE: Record<string, { label: string; icon: LucideIcon; color: string }> = {
  WEAR: { label: "Wear this", icon: Shirt, color: "#5fd18a" },
  WEARING: { label: "Wearing", icon: ShieldCheck, color: "#8fd3c7" },
  CUBE: { label: "Cube it", icon: Box, color: "#7fd6ff" },
  EXTRACT: { label: "Salvage for the power", icon: Sparkles, color: "#ff9b4a" },
  STASH: { label: "Stash it", icon: Archive, color: "#e08cff" },
  KEEP: { label: "Keep it", icon: Backpack, color: "#63a8ff" },
  SCRAP: { label: "Scrap it", icon: Hammer, color: "#b8aa9a" },
  SELL: { label: "Sell it", icon: Coins, color: "#c9b37a" },
  SOCKET: { label: "Keep (build uses it)", icon: Gem, color: "#7fd6ff" },
  UNKNOWN: { label: "?", icon: CircleHelp, color: "#b9a" },
  // older history entries
  BIS: { label: "Wear this", icon: Shirt, color: "#5fd18a" },
  UPGRADE: { label: "Wear this", icon: Shirt, color: "#5fd18a" },
  IMPRINT: { label: "Salvage for the power", icon: Sparkles, color: "#ff9b4a" },
  SALVAGE: { label: "Scrap it", icon: Hammer, color: "#b8aa9a" },
  EQUIPPED: { label: "Wearing", icon: ShieldCheck, color: "#8fd3c7" },
};

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
