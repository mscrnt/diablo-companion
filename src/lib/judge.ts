// Loot Judge decisions: a parsed tooltip (see parse.ts) → one plain-language action
// for the active build variant.
import { Archive, Box, CircleHelp, Coins, Gem, Hammer, ShieldCheck, Shirt, Sparkles, ThumbsUp, type LucideIcon } from "lucide-react";
import { normName, similarity, trigramSim } from "./names";
import { knownWord, ocrVocabReady } from "./ocrfix";
import type { BuildVariant, GearSlot, JudgeResult, ParsedItem, SlotProgress, Verdict } from "./types";

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
function upkeep(item: ParsedItem, slot: GearSlot, q: Quality, p: SlotProgress, wearing: boolean): string[] {
  const steps: string[] = [];
  if (slot.kind === "aspect" && !q.isTarget) steps.push(`Occultist → Imprint "${slot.itemName}" onto it.`);
  // stats that are the build's temper target count as "tempered", never as reroll candidates
  const temperNames = slot.tempers.map((t) => t.name.replace(/\s*\(.*\)\s*$/, ""));
  const isTemperStat = (t: string) => temperNames.some((n) => similarity(t, n) >= 0.8);
  // the Occultist allows ONE enchant per item: if one stat is already enchanted, only that one can change
  const enchanted = item.affixes.find((a) => a.enchanted);
  if (q.missing.length && enchanted) {
    const usefulHere = !!enchanted.match && q.matched.some((m) => normName(m) === normName(enchanted.match!));
    if (!usefulHere) steps.push(`Occultist → re-roll the enchanted "${cleanAffix(enchanted.text)}" into ${shortStat(q.missing[0])} (its one enchant is already on that stat).`);
  } else if (q.missing.length) {
    const bad = item.affixes.find((a) => !a.match && !a.tempered && !isTemperStat(a.text) && !/armor|all resist|resistance/i.test(a.text));
    steps.push(
      bad
        ? `Occultist → Enchant: change "${cleanAffix(bad.text)}" into ${shortStat(q.missing[0])} (one stat per item).`
        : `Occultist → Enchant one stat into ${shortStat(q.missing[0])} (one stat per item).`,
    );
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
function dispose(item: ParsedItem, gear: GearSlot[], why: string[], slot: GearSlot | null, q?: Quality, ctx?: Ctx, better?: string): Out {
  const r = rarityOf(item);
  const reasons = better && !why.includes(better) ? [...why, better] : why;
  const buildAspect = item.aspect?.name
    ? gear.find((g) => g.kind === "aspect" && (sameItem(item.aspect!.name, g.itemName) || similarity(item.aspect!.name, g.itemName) > 0.75))
    : undefined;
  if (r === "mythic") return out(item, "STASH", "Stash it — mythics are rare; keep it for other builds.", why, slot, q);
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
  const res = decideCore(item, variant, ctx, compareTo);
  if (item.truncated) res.reasons = [...res.reasons, "Part of this tooltip is hidden — scroll it down to let me see everything."];
  if (res.verdict === "WEAR" && variant && res.slot) {
    const slot = variant.gear.find((g) => g.slot === res.slot);
    if (slot) res.steps = ["Equip it.", ...upkeep(item, slot, quality(item, slot), { ...ctx.prog(slot.slot), masterwork: 0, tempered: false }, false)];
  }
  return res;
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
    return un.length > 2 && (n.includes(un) || un.includes(n) || trigramSim(u.name, item.name) >= 0.75);
  });
  if (hit.length) {
    const where = [...new Set(hit.map((h) => h.where))].join(", ");
    return out(item, "SOCKET", `Keep it — your build uses ${hit[0].name} (${where}).`, [], null);
  }
  const all = item.rawText ?? "";
  if (item.category === "socketable") {
    if (/amalgam/i.test(all)) return out(item, "STASH", "Keep it for the Horadric Cube — amalgamate it with others into a stronger one.", ["Your build doesn't socket this one directly."], null);
    return out(item, "SELL", "Your build doesn't use this socketable — sell it or keep it for another build.", [], null);
  }
  if (item.category === "talisman") return out(item, "STASH", "Not part of your build's talisman — stash it (or salvage if you have spares).", [], null);
  return out(item, "STASH", "Not gear — use it or keep it; nothing to judge here.", [], null);
}

/** An item you wear in a build slot: how it measures up and its to-do list (never a scrap verdict). */
function wearing(item: ParsedItem, slot: GearSlot, ctx: Ctx, lead?: string): Out {
  const q = quality(item, slot);
  const tips: string[] = lead ? [lead] : [];
  if (!q.isTarget) tips.push(`Your build wants ${slot.itemName} here — this is a stand-in.`);
  tips.push(`${q.matched.length} of ${q.total} stats your build wants${q.greater ? `, ${q.greater} are ★ greater` : ""}.`);
  const steps = upkeep(item, slot, q, ctx.prog(slot.slot), true);
  const action = steps.length ? steps[0] : "Fully done — nothing left to improve here.";
  return { ...out(item, "WEARING", action, tips, slot, q), steps };
}

function decideCore(item: ParsedItem, variant: BuildVariant | undefined, ctx: Ctx, compareTo?: ParsedItem | null): Out {
  if (item.category && item.category !== "gear") return decideNonGear(item, variant);
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
  let candidates = named ? [named] : ((SLOT_MAP[item.slot] ?? []).map((k) => gear.find((g) => g.slot === k)).filter(Boolean) as GearSlot[]);
  // rings/weapons: the game says which of your two it's comparing against (Alt switches)
  if (!named && item.compareKind && candidates.length > 1) {
    const want = candidates.filter((g) => (item.compareKind === "unique") === (g.kind === "unique" || g.kind === "mythic"));
    if (want.length) candidates = want;
  }
  if (!candidates.length) return dispose(item, gear, ["Your build doesn't use this kind of item."], null, undefined, ctx);

  // the same name/aspect and stat values as what you wear there: it IS your item, opened from the
  // Character panel without its "EQUIPPED" header (the game never compares an item with itself)
  if (!compareTo && !item.compareRows?.length)
    for (const c of candidates) {
      const w = ctx.worn?.(c.slot);
      if (w && sameAsWorn(item, w)) return wearing(item, c, ctx, `This looks like the one you're wearing (your ${c.slotLabel}).`);
    }

  // pick the slot where it would help most (matters for rings)
  let best: { slot: GearSlot; q: Quality; gain: number; w: ParsedItem | null; wornQ: Quality | null } | null = null;
  for (const c of candidates) {
    const q = quality(item, c);
    const w = (compareTo && compareTo.slot === item.slot ? compareTo : null) ?? ctx.worn?.(c.slot) ?? null;
    const wornQ = w ? quality(w, c) : null;
    const gain = q.q - (wornQ?.q ?? -1);
    if (!best || gain > best.gain) best = { slot: c, q, gain, w, wornQ };
  }
  const { slot, q, w, wornQ } = best!;
  const better = betterLine(item, slot, q, w, wornQ);
  const p = ctx.prog(slot.slot);
  const hasStr = (x: Quality) => `${x.matched.length} of ${x.total} wanted stats${x.greater ? ` (${x.greater}★)` : ""}`;

  // a build unique you don't have yet → wear it
  if (q.isTarget && (slot.kind === "unique" || slot.kind === "mythic") && !wornQ?.isTarget && p.state === "missing")
    return out(item, "WEAR", `Wear this! It's a core piece of your build (${slot.slotLabel}).`, [`Has ${hasStr(q)}.`], slot, q);

  // a unique slot where this item isn't the real thing
  const slotIsUnique = slot.kind === "unique" || slot.kind === "mythic";
  if (slotIsUnique && !q.isTarget) {
    if (wornQ && !wornQ.isTarget && q.q > wornQ.q + 0.4)
      return out(item, "WEAR", `Wear this for now — better than your current ${slot.slotLabel} until you find ${slot.itemName}.`, [`This: ${hasStr(q)}. Yours: ${hasStr(wornQ)}.`], slot, q);
    return dispose(item, gear, [`Your ${slot.slotLabel} should be ${slot.itemName}.`], slot, q, ctx, w ? better : undefined);
  }

  // The game showed a comparison: use the real numbers, stat by stat (only this slot's wanted stats count)
  if (item.compareRows?.length && (!slotIsUnique || q.isTarget)) {
    const wanted = new Set([...slot.implicits, ...slot.affixes].map((a) => normName(a.name)));
    const fmt = (v: number | null, u: string) => (v == null ? "—" : `${v.toLocaleString()}${u}`);
    let score = 0;
    const notes: { w: number; text: string }[] = [];
    for (const r of item.compareRows) {
      if (!r.match || !wanted.has(normName(r.match))) continue;
      const name = shortStat(r.match);
      if (r.mine != null && r.yours == null) {
        score += 1;
        notes.push({ w: 1, text: `+ ${name} ${fmt(r.mine, r.unit)} (yours has none)` });
      } else if (r.mine == null && r.yours != null) {
        score -= 1;
        notes.push({ w: 1, text: `− ${name}: yours has ${fmt(r.yours, r.unit)}, this has none` });
      } else if (r.mine != null && r.yours != null) {
        const diff = (r.mine - r.yours) / Math.max(1, Math.abs(r.yours));
        if (diff > 0.05) {
          score += 0.5;
          notes.push({ w: 0.5, text: `+ ${name} ${fmt(r.mine, r.unit)} vs yours ${fmt(r.yours, r.unit)}` });
        } else if (diff < -0.05) {
          score -= 0.5;
          notes.push({ w: 0.5, text: `− ${name} ${fmt(r.mine, r.unit)} vs yours ${fmt(r.yours, r.unit)}` });
        }
      }
    }
    score += 0.4 * q.greater; // greater affixes on wanted stats are worth a little extra
    const top = notes.sort((a, b) => b.w - a.w).slice(0, 4).map((n) => n.text);
    if (score >= 0.75) {
      const extra = slot.kind === "aspect" && !q.isTarget ? ` Then put "${slot.itemName}" on it at the Occultist.` : "";
      return out(item, "WEAR", `Wear this — better than yours for your build.${extra}`, top.length ? top : [`This: ${hasStr(q)}.`], slot, q);
    }
    if (!top.length) return dispose(item, gear, ["About the same as yours — not worth swapping."], slot, q, ctx, better);
    return dispose(item, gear, [score <= -0.5 ? "Yours is better:" : "About the same as yours — not worth swapping:", ...top], slot, q, ctx);
  }

  // compare against what you're wearing
  if (wornQ) {
    const wornItem = ctx.worn?.(slot.slot) ?? w;
    const myIp = item.itemPower ?? 0;
    const theirIp = wornItem?.itemPower ?? 0;
    const lowerIp = myIp > 0 && theirIp > 0 && theirIp - myIp >= 25;
    const need = lowerIp ? 1.0 : 0.4; // a lower item-power copy has to be clearly better
    if (q.q > wornQ.q + need) {
      const extra = slot.kind === "aspect" && !q.isTarget ? ` Then put "${slot.itemName}" on it at the Occultist.` : "";
      const why = [`This: ${hasStr(q)}.`, `Yours: ${hasStr(wornQ)}.`];
      // swapping away from an upgraded item costs materials
      const upgraded = wornItem?.affixes.some((a) => a.masterwork || a.tempered || a.enchanted) || ctx.prog(slot.slot).masterwork > 0;
      if (upgraded) why.push("You'll lose your masterwork/temper on the old one — worth it for the extra stats, but budget the materials.");
      if (lowerIp) why.push(`Lower item power than yours (${myIp} vs ${theirIp}).`);
      return out(item, "WEAR", `Wear this — it's better than yours.${extra}`, why, slot, q);
    }
    const why = [better, `Wanted stats: yours ${hasStr(wornQ)}, this ${hasStr(q)}.`];
    if (lowerIp && !/item power/.test(better)) why.push(`It also has lower item power (${myIp} vs ${theirIp}).`);
    return dispose(item, gear, why, slot, q, ctx);
  }

  // no idea what you're wearing yet: judge on its own
  if (q.matched.length >= Math.min(3, q.total)) {
    const extra = slot.kind === "aspect" && !q.isTarget ? ` Put "${slot.itemName}" on it at the Occultist.` : "";
    return out(item, "WEAR", `Probably wear this — great stats for your ${slot.slotLabel}.${extra}`, [`Has ${hasStr(q)}.`, "Hover your equipped piece once so I can compare exactly."], slot, q);
  }
  return dispose(item, gear, [`Only ${hasStr(q)} for your ${slot.slotLabel}.`], slot, q, ctx, better);
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
