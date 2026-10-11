// Loot Judge decisions: a parsed tooltip (see parse.ts) → one plain-language action
// for the active build variant.
import { Archive, Box, CircleHelp, Coins, Gem, Hammer, ShieldCheck, Shirt, Sparkles, ThumbsUp, type LucideIcon } from "lucide-react";
import { normName, similarity, trigramSim } from "./names";
import { knownWord, ocrVocabReady } from "./ocrfix";
import { buildProfile, compareValue, rowsFromItems, standaloneValue, statKey, statWeight, type BuildProfile } from "./statvalue";
import type { BuildVariant, CompareRow, GearSlot, JudgeResult, ParsedItem, SlotProgress, Verdict } from "./types";

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
  const targets = [...slot.implicits, ...slot.affixes];
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
  /** last seen stats of what you're wearing per build slot (from hovering your gear) */
  worn?: (slot: string) => ParsedItem | undefined;
  /** Horadric Cube recipe that can turn a white base into a build unique */
  cubeHint?: (slot: GearSlot) => { recipe: string; baseType: string; pool: string[] } | undefined;
  /** the aspect (by slug) is already in your Codex of Power (Collection page) */
  inCodex?: (slug: string) => boolean;
  /** the build's stat weights (filled in by decide) */
  prof?: BuildProfile;
}

type Out = Omit<JudgeResult, "id" | "at" | "ms" | "thumb">;

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

/**
 * The to-do list for an item you wear (or are about to): Occultist imprint/enchant,
 * Blacksmith temper & masterwork, sockets, and a Horadric Cube mythic upgrade later.
 */
function upkeep(item: ParsedItem, slot: GearSlot, q: Quality, p: SlotProgress, wearing: boolean, prof?: BuildProfile): string[] {
  const steps: string[] = [];
  if (slot.kind === "aspect" && !q.isTarget) {
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
    return same.length ? `Same wanted stats as yours${named}: ${list(same)} — nothing to gain by swapping.` : `Neither has the stats your build wants on your ${slot.slotLabel}; keep yours${named}.`;
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
  if (r === "mythic") return out(item, "STASH", "Stash it — mythics are rare; keep it for other builds.", why, slot, q);
  // a top-tier roll is worth more than its materials, even when this build has no use for it
  const top = topTier(item, slot, ctx?.prof ?? null);
  if (top) return out(item, "STASH", `Save it for later — ${top}.`, reasons, slot, q);
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
        `Salvage it at the Blacksmith — that saves "${buildAspect.itemName}" to your Codex (keeps the bigger roll). Imprint it later at the Occultist.`,
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
  if (item.truncated) res.reasons = [...res.reasons, "Part of this tooltip is hidden — scroll it down to let me see everything."];
  if (res.verdict === "WEAR" && variant && res.slot) {
    const slot = variant.gear.find((g) => g.slot === res.slot);
    if (slot) res.steps = ["Equip it.", ...upkeep(item, slot, quality(item, slot), { ...ctx.prog(slot.slot), masterwork: 0, tempered: false }, false, buildProfile(variant))];
  }
  return res;
}

const titleSet = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

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
  if (/charm|seal|horadr/i.test(raw) && usesTalismans)
    return out(item, "SOCKET", "Use it on an Undercity run: it earns charms and a Seal, which your build uses.", reasons, null);
  if (/mythic|unique/i.test(raw) && missingUnique)
    return out(item, "STASH", "Keep it for an Undercity run when you're chasing uniques or a Mythic.", reasons, null);
  return out(item, "STASH", "Keep it: offer it at the Undercity Spirit Brazier before a run.", reasons, null);
}

/** Gems, runes, splinters, charms, consumables: never "scrap" them by gear rules. */
function decideNonGear(item: ParsedItem, variant: BuildVariant | undefined): Out {
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
  if (hit.length) {
    const where = [...new Set(hit.map((h) => h.where))].join(", ");
    return out(item, "SOCKET", `Keep it — your build uses ${hit[0].name} (${where}).`, [], null);
  }
  const all = item.rawText ?? "";
  if (item.category === "tribute") return tributeAdvice(item, variant);
  if (item.category === "socketable") {
    if (/amalgam/i.test(all)) return out(item, "STASH", "Keep it for the Horadric Cube — amalgamate it with others into a stronger one.", ["Your build doesn't socket this one directly."], null);
    return out(item, "SELL", "Your build doesn't use this socketable — sell it or keep it for another build.", [], null);
  }
  if (item.category === "talisman") {
    // "Peace of the Black Shroud": another piece of a set your build wears
    const setOf = (n: string) => normName(n).match(/ of the (.+)$/)?.[1] ?? "";
    const set = setOf(item.name);
    const sameSet = set ? gear.find((g) => g.group === "talisman" && setOf(g.itemName) === set) : undefined;
    if (sameSet) return out(item, "STASH", `Keep it — it's from the ${titleSet(set)} set your build uses.`, [`Your build wears ${gear.filter((g) => g.group === "talisman" && setOf(g.itemName) === set).map((g) => g.itemName).join(", ")}.`], null);
    return out(item, "STASH", "Not part of your build's talisman — stash it (or salvage if you have spares).", [], null);
  }
  return out(item, "STASH", "Not gear — use it or keep it; nothing to judge here.", [], null);
}

/** An item you wear in a build slot: how it measures up and its to-do list (never a scrap verdict). */
function wearing(item: ParsedItem, slot: GearSlot, ctx: Ctx, lead?: string): Out {
  const q = quality(item, slot);
  const tips: string[] = lead ? [lead] : [];
  if (!q.isTarget) tips.push(`Your build wants ${slot.itemName} here — this is a stand-in.`);
  tips.push(`${q.matched.length} of ${q.total} stats your build wants${q.greater ? `, ${q.greater} are ★ greater` : ""}.`);
  const steps = upkeep(item, slot, q, ctx.prog(slot.slot), true, ctx.prof);
  const action = steps.length ? steps[0] : "Fully done — nothing left to improve here.";
  return { ...out(item, "WEARING", action, tips, slot, q), steps };
}

function decideCore(item: ParsedItem, variant: BuildVariant | undefined, ctx: Ctx, compareTo?: ParsedItem | null): Out {
  // the AI parse doesn't always say what kind of item it is: charms, seals and caches aren't gear
  const text = `${item.name}\n${item.itemType ?? ""}\n${item.rawText ?? ""}`;
  const category =
    /\btribute\b|undercity spirit brazier/i.test(text)
      ? "tribute"
      : (item.category ??
        (item.slot === "charm" || item.slot === "seal" ? "talisman" : item.slot === "other" && /\bcache\b|collection of/i.test(text) ? "consumable" : undefined));
  if (category && category !== "gear") return decideNonGear({ ...item, category }, variant);
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
    if (!slot) return out(item, "WEARING", "You're wearing this — this slot isn't part of your build.", [], null);
    return wearing(item, slot, ctx);
  }

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
  // a named comparison (the EQUIPPED column) belongs to the slot you wear that piece in
  const byName =
    compareTo && compareTo.rarity !== "unknown" && candidates.length > 1
      ? candidates.filter((c) => {
          const r = ctx.worn?.(c.slot);
          return (!!r && sameItem(r.name, compareTo.name)) || (isUniq(c) && sameItem(compareTo.name, c.itemName));
        })
      : [];
  const compared = byName.length
    ? byName
    : !named && item.compareKind && candidates.length > 1
      ? candidates.filter((g) => (item.compareKind === "unique") === isUniq(g))
      : candidates;
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
    if (wornQ && w!.rarity === "unknown" && remembered && !wornQ.isTarget) wornQ.isTarget = quality(remembered, c).isTarget;
    const cmp = swapValue(item, c, q, w, wornQ, prof, gameCompares(c) ? item.compareRows : undefined, workOn(c, w, ctx));
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
    const need = upgraded ? 0.6 : 0.35;
    const top = cmp.lines.slice(0, 4);
    const yours = w && w.rarity !== "unknown" && !/^your equipped item$/i.test(w.name) ? ` (${itemLabel(w)})` : "";
    const verdictLine = `For your build: ${cmp.score >= 1.5 ? "clearly better" : cmp.score >= need ? "better" : cmp.score > 0.15 ? "slightly better" : cmp.score > -0.15 ? "about the same as" : cmp.score > -1 ? "a bit worse" : "worse"}${cmp.score > -0.15 && cmp.score <= 0.15 ? "" : " than"} yours${yours}.`;
    if (cmp.score >= need) {
      const extra = slot.kind === "aspect" && !q.isTarget ? ` Then put "${slot.itemName}" on it at the Occultist.` : "";
      const stand = slotIsUnique && !q.isTarget ? ` Use it until you find ${slot.itemName}.` : "";
      const why = [verdictLine, ...(cmp.work ? [cmp.work] : []), ...top];
      if (upgraded) why.push("Masterwork and temper it like your old one — budget the materials.");
      return out(item, "WEAR", `Wear this — it's better than yours.${extra}${stand}`, why, slot, q);
    }
    const why = [verdictLine, ...(cmp.work ? [cmp.work] : []), ...top];
    if (cmp.score > 0.15 && upgraded) why.push("Not enough to be worth redoing the masterwork/temper.");
    if (!top.length) why.push(better);
    return dispose(item, gear, why, slot, q, ctx);
  }

  // no idea what you're wearing yet: judge on its own
  const alone = standaloneValue(item, slot, prof);
  if (q.matched.length >= Math.min(3, q.total) || (q.matched.length >= 2 && alone >= 2.4)) {
    const extra = slot.kind === "aspect" && !q.isTarget ? ` Put "${slot.itemName}" on it at the Occultist.` : "";
    return out(item, "WEAR", `Probably wear this — good stats for your ${slot.slotLabel}.${extra}`, [`Has ${hasStr(q)}.`, "Hover your equipped piece once so I can compare exactly."], slot, q);
  }
  return dispose(item, gear, [`Only ${hasStr(q)} for your ${slot.slotLabel}.`], slot, q, ctx, better);
}

/** What's been done to the piece you wear in this slot: masterwork rank, tempered and masterwork-crit stats. */
interface Work {
  rank: number;
  tempered: Set<string>;
  crit: Set<string>;
}

function workOn(slot: GearSlot, w: ParsedItem | null, ctx: Ctx): Work | null {
  const remembered = ctx.worn?.(slot.slot);
  const src = [...(w?.affixes ?? []), ...(remembered?.affixes ?? [])];
  const key = (a: { text: string; match?: string | null }) => (a.match ? normName(a.match) : statKey(a.text));
  const crit = new Set(src.filter((a) => a.masterwork).map(key));
  const tempered = new Set(src.filter((a) => a.tempered).map(key));
  const p = ctx.prog(slot.slot);
  if (p.tempered) for (const t of slot.tempers) tempered.add(normName(t.name.replace(/\s*\(.*\)\s*$/, "")));
  // a crit lands every 4th rank: seeing one means at least rank 4
  const rank = Math.max(p.masterwork ?? 0, 4 * Math.min(3, crit.size));
  return rank || tempered.size ? { rank, tempered, crit } : null;
}

// Masterworking (estimate): each non-crit rank adds ~5% to every affix, each crit (ranks 4/8/12) +25% to one.
const masterworkFactor = (rank: number, crit: boolean) => (1 + 0.05 * (rank - Math.floor(rank / 4))) * (crit ? 1.25 : 1);

interface Swap {
  /** "Yours is masterworked +12 and tempered: compared as if this one gets the same." */
  work?: string;
  score: number;
  /** the biggest differences first, ready to show */
  lines: string[];
}

/**
 * Swapping to `item` from what you wear, scored for the build: the in-game comparison's numbers
 * when there are some, else the two parsed items stat by stat. Uniques, build aspects and
 * greater affixes add to it. null when nothing is known about your piece.
 */
function swapValue(item: ParsedItem, slot: GearSlot, q: Quality, w: ParsedItem | null, wornQ: Quality | null, prof: BuildProfile, gameRows?: CompareRow[], work?: Work | null): Swap | null {
  const raw = gameRows?.length ? gameRows : w ? rowsFromItems(item, w) : null;
  if (!raw) return null;
  // compare like with like: yours without its masterwork, and a temper this one can get too doesn't count against it
  // an item takes one temper per temper slot; one that shows no tempered line yet can still take yours
  const canTemper = !item.affixes.some((a) => a.tempered);
  const shown = new WeakMap<CompareRow, number | null>(); // the number the game shows, for the reasons
  const rows = !work
    ? raw
    : raw.flatMap((r) => {
        const key = r.match ? normName(r.match) : statKey(r.label);
        if (canTemper && r.mine == null && work.tempered.has(key)) return [];
        if (r.yours == null || !work.rank) return [r];
        const adj = { ...r, yours: Math.round((r.yours / masterworkFactor(work.rank, work.crit.has(key))) * 10) / 10 };
        shown.set(adj, r.yours);
        return [adj];
      });
  const workNote = work
    ? `Yours is ${[work.rank ? `masterworked +${work.rank}` : "", work.tempered.size ? "tempered" : ""].filter(Boolean).join(" and ")}: compared as if this one gets the same work (masterwork bonus estimated).`
    : undefined;
  // a cut-off tooltip hides "Properties lost when equipped": its "yours has none" stats are only half the story
  const oneSided = !!gameRows?.length && !!item.truncated && !rows.some((r) => r.mine == null);
  const used = oneSided ? rows.filter((r) => r.yours != null) : rows;
  const { score: stats, deltas } = compareValue(used, slot, prof);
  let score = stats;
  const notes: { v: number; text: string }[] = [];
  // the build's unique (its power is the point of the slot)
  if (slot.kind === "unique" || slot.kind === "mythic") {
    if (q.isTarget && !wornQ?.isTarget) (score += 3), notes.push({ v: 3, text: `+ It's ${slot.itemName}, the unique your build wants here` });
    if (!q.isTarget && wornQ?.isTarget) (score -= 3), notes.push({ v: -3, text: `− Yours is ${slot.itemName}, the unique your build wants here` });
  }
  // the build's aspect on it saves an imprint (yours can be imprinted later, so it counts less)
  if (slot.kind === "aspect" && q.isTarget !== !!wornQ?.isTarget) {
    const v = q.isTarget ? 0.6 : -0.4;
    score += v;
    notes.push({ v, text: q.isTarget ? `+ Already has ${slot.itemName} (saves an imprint)` : `− Yours already has ${slot.itemName}` });
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
    const name = shortStat(d.label.replace(/^to /i, "Ranks to ").replace(/\b\w/g, (c) => c.toUpperCase()).replace(/ (To|Of) /g, (m) => m.toLowerCase()));
    const minor = d.weight <= 0.1 ? " (minor for your build)" : "";
    const text =
      d.mine != null && d.yours == null
        ? `+ ${name} ${fmt(d.mine, d.unit)} (yours has none)${minor}`
        : d.mine == null
          ? `− ${name}: yours has ${fmt(yours, d.unit)}, this has none${minor}`
          : `${d.value > 0 ? "+" : "−"} ${name} ${fmt(d.mine, d.unit)} vs yours ${fmt(yours, d.unit)}${minor}`;
    notes.push({ v: d.value, text });
  }
  return { score, work: workNote, lines: notes.sort((a, b) => Math.abs(b.v) - Math.abs(a.v)).map((n) => n.text) };
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
  SCRAP: { label: "Scrap it", icon: Hammer, color: "#b8aa9a" },
  SELL: { label: "Sell it", icon: Coins, color: "#c9b37a" },
  SOCKET: { label: "Keep (build uses it)", icon: Gem, color: "#7fd6ff" },
  UNKNOWN: { label: "?", icon: CircleHelp, color: "#b9a" },
  // older history entries
  BIS: { label: "Wear this", icon: Shirt, color: "#5fd18a" },
  UPGRADE: { label: "Wear this", icon: Shirt, color: "#5fd18a" },
  KEEP: { label: "Keep", icon: ThumbsUp, color: "#63a8ff" },
  IMPRINT: { label: "Salvage for the power", icon: Sparkles, color: "#ff9b4a" },
  SALVAGE: { label: "Scrap it", icon: Hammer, color: "#b8aa9a" },
  EQUIPPED: { label: "Wearing", icon: ShieldCheck, color: "#8fd3c7" },
};

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
