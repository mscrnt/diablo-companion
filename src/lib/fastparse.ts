// Instant tooltip parser: OCR lines + bullet-icon colours + rules. No LLM.
// Returns null (→ fall back to the LLM labeller) when it isn't confident.
import { buildTargetNames, cleanStat, matchTarget } from "./parse";
import { aspectFromItemName, canonicalUnique, identifyAspect, identifyUnique, similarity, table, trigramSim } from "./names";
import { confident, identifyUnique as identifyUniqueFrom } from "./identify";
import { confusionKey, editDistance, knownStat, knownWord, ocrVocabReady, sheetLabel, snapLines } from "./ocrfix";
import type { Bullet } from "./vision";
import type { BuildVariant, CompareRow, ParsedAffix, ParsedItem } from "./types";

export interface FastLine {
  text: string;
  bullet: Bullet;
  /** OCR line height (px) — the item name uses a bigger font */
  h?: number;
  /** OCR line box (capture px), when known: text of a panel behind the tooltip sits in another column */
  x?: number;
  y?: number;
  w?: number;
}

const JUNK = /^(equipped|slot transmog.*|n slot|character|scroll down|.{0,2})$/i;
const FOOTER =
  /item power|^\d+\s*\(.*\)\s*quality|quality$|requires level|account bound|sell value|durability|tempers:|^equip$|^drop$|^\+?\s*drop$|^\+?\s*link$|^\W*link$|^\W*unequip$|^\W*unmark\b|ctrl|shift|hide comparison|mark as|scroll down|lord of hatred item|^legendary power$|^unique power$|^\W*legendary power|^\W*unique power|^socket|empty socket|^!?\s*[\d,]{6,}$/i;
/** The bottom of the tooltip: nothing after these is part of the item (key hints, glossary popups). */
const END = /requires level|sell value|tempers:|account bound/i;
/** A number on its own: a Character panel value ("4,574", "V 977,620", "2,7Q"), never an item line. */
const BARE_NUMBER = /^[A-WYZa-wyz]?\s*\d[\d,.]*\s*[A-Za-z]?$/;

const UNEQUIP_KEY = confusionKey("unequip");
/**
 * The footer hint "Unequip": the game only offers it on an item you're wearing, which is how
 * a tooltip opened from the Character panel shows (it has no EQUIPPED header). Items in your
 * bags say "Equip"; ground, vendor and stash items show neither.
 */
export function isUnequipLine(text: string): boolean {
  const t = text.trim().replace(/^[^A-Za-z]+/, "").replace(/[^A-Za-z0-9|!]+$/, "");
  if (!/^u/i.test(t) || /\s\S*\s/.test(t)) return false;
  return editDistance(confusionKey(t.replace(/\s+/g, "")), UNEQUIP_KEY, 1) <= 1;
}
// the rarity word, OCR slips included ("Ancestrah1ya1ic Nique" = Ancestral Mythic Unique at 1080p)
const RARITY = /\b(mythic|unique|legendary|rare|magic|common)\b|myth|[1il]?ya[1il]ic\b|uniq|\bn[il1]que\b/i;
const SLOT_NOUN =
  /\b(helm|headgear|head|chest armor|chest|gloves|pants|boots|amulet|ring|scythe|sword|axe|mace|dagger|wand|staff|bow|crossbow|polearm|glaive|quarterstaff|flail|focus|shield|totem|charm|seal|two-handed|one-handed)\b/i;
export const STAT_START = /^[+x\-]?\s*[\d][\d.,\s]*%?\s+\S/i;
const NONGEAR = /\b(gem|rune|soul splinter|splinter|socketable|charm|seal|talisman|tribute|chronicle|elixir|incense|potion|key|sigil|material|cache|scroll|consumable)\b/i;

function categoryOf(type: string, all: string): ParsedItem["category"] {
  if (/\b(gem|rune|splinter|socketable)\b/i.test(type) || /can be inserted into|amalgamate|^weapon:|jewelry:/im.test(all)) return "socketable";
  if (/\btribute\b/i.test(type) || /undercity spirit brazier/i.test(all)) return "tribute";
  // Nightmare keys ("Rare Chronicle of Nightmares … Dungeon Affixes")
  if (/\bchronicle\b|\bsigil\b/i.test(type) || /dungeon affixes/i.test(all)) return "consumable";
  if (/\b(charm|seal|talisman)\b/i.test(type)) return "talisman";
  if (NONGEAR.test(type)) return "consumable";
  return "gear";
}

function slotOf(type: string): string {
  const t = type.toLowerCase();
  if (/helm|headgear|\bhead\b/.test(t)) return "helm";
  if (/chest/.test(t)) return "chest";
  if (/gloves/.test(t)) return "gloves";
  if (/pants/.test(t)) return "pants";
  if (/boots/.test(t)) return "boots";
  if (/amulet/.test(t)) return "amulet";
  if (/\bring\b/.test(t)) return "ring";
  if (/focus|shield|totem|off-?hand/.test(t)) return "offhand";
  if (/charm/.test(t)) return "charm";
  if (/seal/.test(t)) return "seal";
  if (SLOT_NOUN.test(t)) return "weapon";
  return "other";
}

function titleCase(n: string) {
  const t = n.replace(/[^A-Za-z0-9'’\- ]+/g, " ").replace(/\s+/g, " ").trim();
  if (!t) return t;
  const lower = t.toLowerCase();
  return lower.replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase()).replace(/(?!^)\b(Of|The|And|To)\b/g, (w) => w.toLowerCase());
}

function deltaOf(t: string): string | null {
  return t.match(/\(\s*([+\-]\s*[\d.,]+%?)/)?.[1]?.replace(/\s+/g, "") ?? null;
}

function sameMagnitude(text: string, delta: string): boolean {
  const v = Number((text.match(/[\d.,]+/)?.[0] ?? "").replace(/,/g, ""));
  const d = Math.abs(Number(delta.replace(/[^\d.\-]/g, "")));
  // "(+22%)" on a 23% stat still means yours doesn't have it (the game rounds/scales deltas)
  return v > 0 && Math.abs(v - d) / v < 0.1;
}

function finalNameFor(name: string, rarity: string) {
  return rarity === "unique" || rarity === "mythic" ? canonicalUnique(name) ?? name : name;
}

export function fastParse(lines: FastLine[], equippedLabel: boolean, variant: BuildVariant | undefined, opts: { snap?: boolean } = {}): ParsedItem | null {
  // OCR reads the bullet icons as letters ("o +9.8% Crit…", "0 +4,375 Armor") — strip them;
  // then fix misread words against the game's own text ("ARIT10R" → "ARMOR")
  // a greater-affix starburst read as a character ("* +225 Intelligence") marks the line greater: its
  // colour check looked left of the star, at the tooltip frame (checked before word snapping drops the "*")
  const starred = lines.map((l) =>
    /^\s*[*✸✷✹✺❋]\s*(?=[+x\-]?\s*\d)/.test(l.text) && (l.bullet === "normal" || l.bullet === "none") ? { ...l, bullet: "greater" as const } : l,
  );
  const L = (opts.snap === false ? starred : snapLines(starred))
    .map((l) => ({ ...l, text: l.text.trim().replace(/^(?:[oO0•*◆◇¤✸✷·°]\s*)+(?=[+x\-]?\s*\d)/, "") }))
    .filter((l) => l.text.length > 0);
  const hs = L.map((l) => l.h ?? 0).filter(Boolean).sort((a, b) => a - b);
  const bodyH = hs[Math.floor(hs.length / 2)] ?? 0;
  // 1) type line: has a rarity word (+ maybe the slot noun on the next line)
  const typeLike = (l: FastLine, i: number) => i < 8 && RARITY.test(l.text) && (SLOT_NOUN.test(l.text) || SLOT_NOUN.test(L[i + 1]?.text ?? "") || NONGEAR.test(l.text));
  // the title can look like a type line too ("MYTHIC TRIBUTE"): prefer one with a name above it
  let ti = L.findIndex((l, i) => i > 0 && typeLike(l, i));
  if (ti < 0) ti = L.findIndex(typeLike);
  // gems show "Weapon: … / Armor: … / Jewelry: …" and often no rarity line at all
  if (ti < 0 && L.some((l) => /^(weapon|armor|jewelry):/i.test(l.text))) {
    const all = L.map((l) => l.text).join("\n");
    const bonus = L.filter((l) => /^(weapon|armor|jewelry):/i.test(l.text)).map((l) => l.text).join(" ");
    // name the gem by its bonuses ("Weapon: x28% Shadow Damage…" → Amethyst)
    let gem = "";
    let gs = 0;
    for (const g of Object.values(table("gems"))) {
      const sc = trigramSim(bonus.replace(/[\d.,%x+]/g, ""), (g.d ?? "").replace(/[\d.,%x+]/g, ""));
      if (sc > gs) {
        gs = sc;
        gem = g.n;
      }
    }
    const nameLine = gs >= 0.6 ? gem : L.find((l) => /\bgem\b|\brune\b|splinter/i.test(l.text) && !/:/.test(l.text))?.text ?? "Gem";
    return {
      name: titleCase(nameLine),
      rarity: "common",
      itemType: "Gem",
      slot: "other",
      itemPower: null,
      affixes: [],
      aspect: { name: "", text: L.filter((l) => /^(weapon|armor|jewelry):/i.test(l.text)).map((l) => l.text).join(" · ") },
      rawText: all,
      category: "socketable",
    };
  }
  // caches and experience tomes: the capture often starts below their title ("A collection of items as a
  // reward for …", "Grants a substantial amount of experience"), and their text is enough to know them
  if (ti < 0) {
    const all = L.map((l) => l.text).join("\n");
    const tome = /amount of\s+experience|experience tome/i.test(all);
    if (tome || /use this cache to receive your rewards|collection of items as a reward/i.test(all))
      return { name: tome ? "Experience Tome" : "Cache", rarity: "rare", itemType: tome ? "Experience Tome" : "Cache", slot: "other", itemPower: null, affixes: [], aspect: null, rawText: all, category: "consumable" };
    // the bottom of a seasonal socketable ("Amalgamable / Account Bound / Seasonal Item / Sell Value"): the AI
    // read guessed a unique helm and scrapped it (2026-10-13 test)
    if (/^\W*amalgamable\W*$|can be inserted into/im.test(all) && !/item power/i.test(all))
      return { name: "Socketable", rarity: "common", itemType: "Socketable", slot: "other", itemPower: null, affixes: [], aspect: null, rawText: all, category: "socketable" };
    // the bottom of an Escalating Nightmare sigil ("Brave a series of dungeons … Ancient Reservoir in Hawezar /
    // AFFIXES"): the AI read made boots of it and scrapped it (2026-10-16 test)
    if (/brave a series of dungeons|series of dungeons, each/i.test(all) && !/item power/i.test(all))
      return { name: "Nightmare Escalation Sigil", rarity: "rare", itemType: "Escalation Sigil", slot: "other", itemPower: null, affixes: [], aspect: null, rawText: all, category: "consumable" };
  }
  // a garbled rarity word ("ii/ölakic Scythe" = Magic Scythe): a short Title-case line ending in the item
  // kind, under an ALL-CAPS title
  if (ti < 0)
    ti = L.findIndex(
      (l, i) =>
        i > 0 && i < 8 && /^\S{1,12}\s+(two-handed |one-handed )?(scythe|sword|axe|mace|dagger|wand|staff|bow|crossbow|polearm|glaive|quarterstaff|flail|focus|shield|totem|helm|gloves|pants|boots|amulet|ring)$/i.test(l.text.trim()) &&
        /[a-z]/.test(l.text) && L[i - 1].text === L[i - 1].text.toUpperCase() && /[A-Z]{3}/.test(L[i - 1].text),
    );
  // a bare item kind ("Boots") — last, since the Character panel's slot labels look the same
  // (a white item has no rarity word at all: "Ancestral Axe (Slashing)", "Ancestral Two-Handed Mace")
  const bareKind = (l?: FastLine) => !!l && /^(ancestral |sacred )?(two-handed |one-handed )?(scythe|sword|axe|mace|dagger|wand|staff|bow|crossbow|polearm|glaive|quarterstaff|flail|focus|shield|totem|helm|chest armor|gloves|pants|boots|amulet|ring)(\s*\([a-z]+\))?$/i.test(l.text.trim());
  if (ti < 0) {
    ti = L.findIndex((l, i) => i < 8 && bareKind(l));
    // a white item's title is its kind too ("AMULET" / "Amulet"): the type line is the one under it
    if (ti >= 0 && bareKind(L[ti + 1])) ti++;
  }
  if (ti < 0) {
    // no item power, no rarity, but an item's footer ("Account Bound", "Sell Value"): a key, material or other
    // non-gear item seen without its title. The AI read used to make gear of these and scrap them.
    const all = L.map((l) => l.text).join("\n");
    // (gear whose top is cut off still shows stat lines "+120 Intelligence" or "Requires Level": that's left to the AI)
    const gearish = /^\W*[+x]?\s*\d[\d.,]*%?\s+[A-Za-z]/im.test(all) || /requires level|durability/i.test(all);
    if (!/item power/i.test(all) && !RARITY.test(all) && !gearish && /account bound|sell value|cannot be sold/i.test(all)) {
      const title = L.find((l) => /[A-Za-z]{3}/.test(l.text) && !/account bound|sell value|affixes/i.test(l.text))?.text ?? "Item";
      return { name: titleCase(title.replace(/[^A-Za-z' -]+/g, " ").trim()).slice(0, 40) || "Item", rarity: "common", itemType: "", slot: "other", itemPower: null, affixes: [], aspect: null, rawText: all, category: "consumable", untitled: true };
    }
    return null; // top of tooltip not visible → let the LLM try
  }
  let typeLine = L[ti].text;
  let after = ti + 1;
  // the type wraps: "Ancestral Magic Two-" / "Handed Mace (Bludgeoning)"
  const wrapped = /\b(two|one)\s*-\s*$/i.test(typeLine);
  if (!SLOT_NOUN.test(typeLine) && L[ti + 1] && SLOT_NOUN.test(L[ti + 1].text) && (L[ti + 1].text.length < 24 || (wrapped && L[ti + 1].text.length < 40))) {
    typeLine += " " + L[ti + 1].text;
    after = ti + 2;
  }
  const vocab = opts.snap !== false && ocrVocabReady();

  // Text of the panel behind the tooltip (the Character panel's stats, its section headers)
  // gets mixed into the lines. With line boxes it sits outside the tooltip's own column:
  // left of its text margin (cut off by the tooltip's edge) or right of it.
  const panel = new Set<number>();
  const anchors = L.filter((l, i) => l.x != null && l.w != null && (i === ti || /item power|requires level|sell value|tempers:/i.test(l.text) || (STAT_START.test(l.text) && (!vocab || knownStat(l.text)))));
  if (anchors.length >= 2) {
    const left = Math.min(...anchors.map((l) => l.x!));
    const right = Math.max(...anchors.map((l) => l.x! + l.w!));
    const slack = (bodyH || 20) / 2;
    L.forEach((l, i) => {
      if (l.x != null && l.w != null && (l.x + l.w < left + slack || l.x > right - slack)) panel.add(i);
    });
  }
  // without boxes (or as well): its labels on their own line are known words ("Toughness", "Stats & Material")
  if (vocab) L.forEach((l, i) => i !== ti && sheetLabel(l.text) && panel.add(i));

  // 2) name: the lines just above the type line (skip header junk); trailing ✸ marks = greater-affix count
  const nameParts: string[] = [];
  const nameLines: FastLine[] = [];
  for (let i = ti - 1; i >= 0 && nameParts.length < 3; i--) {
    // a speck of OCR junk between the title and the type line ("CRUDE HAmmER" / "s" / "Ancestral …")
    if (L[i].text.trim().length <= 2) continue;
    if (JUNK.test(L[i].text) || /slot|transmog|equipped|character/i.test(L[i].text)) break;
    // a panel label between the two lines of a long title ("OCELOT'S EYE OF" / "Stats & Material" / "REANIMATION")
    if (panel.has(i)) continue;
    // a stack count under the title ("(2)") isn't part of the name
    if (/^\(\d+\)$/.test(L[i].text.trim())) continue;
    // the title font is clearly bigger than body text; small lines above it are UI (character name…)
    // all-caps title lines measure about body height; small UI text (character name) is clearly shorter
    if (bodyH && L[i].h && L[i].h! < bodyH * 0.85) break;
    nameParts.unshift(L[i].text);
    nameLines.unshift(L[i]);
  }
  // a smaller top line with no game word at all is the character name above the tooltip
  const words = (t: string) => t.match(/[A-Za-z][A-Za-z'’\-]+/g) ?? [];
  const titleH = Math.max(...nameLines.map((l) => l.h ?? 0));
  while (ocrVocabReady() && opts.snap !== false && nameParts.length > 1 && titleH && (nameLines[0].h ?? titleH) < titleH * 0.9 && !words(nameParts[0]).some(knownWord)) {
    nameParts.shift();
    nameLines.shift();
  }
  const rawName = nameParts.join(" ");
  const starMarks = (rawName.match(/[*✸✹✺❋✷]/g) ?? []).length;
  // the title scrolled or cut off above the capture: the type line names it ("Legendary Sword") — judging
  // its stats here beats a slow AI read that can't see the name either
  const name = titleCase(rawName.replace(/[*✸✹✺❋✷]/g, "")) || (ti === 0 ? titleCase(typeLine.replace(/^(ancestral|sacred)\s+/i, "")) : "");
  if (!name || name.length < 3) return null;

  // 3) walk the body. A line WITH a bullet icon starts a new entry; lines without one
  //    (or obvious wraps like "Multiplier", "+22%)", "6 seconds.") continue it.
  const lostStart = L.findIndex((l) => /properties lost when equipped/i.test(l.text));
  type Entry = { text: string; bullet: Bullet; lost: boolean };
  const entries: Entry[] = [];
  let lostPower = false;
  let lostPowerKind: "unique" | "legendary" | null = null;
  let inLost = false;
  let closed = true;
  for (let i = after; i < L.length; i++) {
    const { text, bullet } = L[i];
    if (i === lostStart) {
      inLost = true;
      closed = true;
      continue;
    }
    // the panel behind the tooltip: its labels and values, and specks of icon text ("S111vr")
    if (panel.has(i) || BARE_NUMBER.test(text) || (bodyH && L[i].h && L[i].h! < bodyH * 0.55)) continue;
    // weapon base lines (DPS / damage per hit / attacks per second) aren't affixes
    if (/damage per second|damage per hit|attacks per second/i.test(text)) {
      closed = true;
      continue;
    }
    if (FOOTER.test(text)) {
      if (inLost && /unique power|legendary power/i.test(text)) {
        lostPower = true;
        lostPowerKind = /unique/i.test(text) ? "unique" : "legendary";
      }
      if (inLost) break; // footer ends the "lost" block and the useful part of the tooltip
      // below "Requires Level" / "Sell Value" come key hints ("Unequip", "Unmark Item") and keyword popups
      if (END.test(text)) break;
      closed = true;
      continue;
    }
    const prev = entries[entries.length - 1];
    // an OCR'd icon ("* Gain …", "• +12 …") always marks a new entry
    const iconLead = /^[*•◆◇o]\s+\S/.test(text);
    const clean = iconLead ? text.replace(/^[*•◆◇o]\s+/, "") : text;
    const deltaTail = /^[+\-]?\s*[\d.,]+%?\s*\)\s*$/.test(clean);
    const numStart = /^[+x\-]?\s*\d/i.test(clean) && !deltaTail && !/^\d+(\.\d+)?\s*(seconds?)\b/i.test(clean);
    const looksWrapped =
      deltaTail ||
      /^[a-z]/.test(text) || // continues mid-sentence
      /^(multiplier|speed|chance|damage|skills?|seconds?|resistance|generation|reduction)\b/i.test(text) ||
      /^\d+(\.\d+)?\s*(seconds?|second)\b/i.test(text) ||
      (!!prev && /[(,]\s*$/.test(prev.text));
    // a finished stat line doesn't run on into a fragment that makes it unknown: "+100 Intelligence"
    // + "Damage" / "ess" (text of the panel behind the tooltip) or + an unbulleted power paragraph
    const finished =
      vocab && !deltaTail && /^[+x\-]?\s*\d/.test(prev?.text ?? "") && knownStat(prev!.text) && !knownStat(prev!.text + " " + clean);
    if (finished && !/\d/.test(clean) && !/\s/.test(clean.trim()) && !knownWord(clean)) continue; // stray fragment: drop it, keep the stat open for its delta
    // a number-led line is a new stat (icon detection can miss on bright backgrounds), unless the line
    // before stopped mid-sentence: "…Critical Strike Chance and" / "50% Critical Strike Damage for 4" is
    // the power paragraph going on, not a +50% Crit Damage stat (it made a ring a WEAR, 2026-10-13 report)
    const midSentence = !!prev && !closed && bullet === "none" && /\s(and|or|for|to|by|of|with|you|your|an?|the|up to)\s*$/i.test(prev.text);
    if (prev && !closed && !finished && prev.lost === inLost && !iconLead && ((!numStart && (bullet === "none" || looksWrapped)) || midSentence)) {
      prev.text += " " + clean;
      continue;
    }
    if (!/[a-z]{2,}/i.test(clean)) continue; // icon junk ("*", "o") and stray numbers
    entries.push({ text: clean, bullet: iconLead && bullet === "none" ? "normal" : bullet, lost: inLost });
    closed = false;
  }

  const stats: { text: string; bullet: Bullet; delta: string | null }[] = [];
  const lost: string[] = [];
  const power: string[] = [];
  let imprinted = false;
  for (const e of entries) {
    const t = e.text.replace(/\s+/g, " ").trim();
    const numStart = /^[+x\-]?\s*\d/i.test(t);
    if (e.lost) {
      if (/[a-z]{3,}/i.test(t)) lost.push(cleanStat(t));
      continue;
    }
    const sentence = /\b(deal|deals|grant|grants|gain|gains|your|when|while|chance to|increased|after|every)\b/i.test(t) && t.length > 45;
    // no game word at all: text of the panel behind the tooltip ("terials", "Acrurqed Abbot")
    if (vocab && !numStart && !(t.match(/[A-Za-z][A-Za-z'’\-]+/g) ?? []).some(knownWord)) continue;
    // with the game's stat lines at hand, prose that isn't one is part of the power paragraph
    const prose = vocab && !knownStat(t) && (!numStart || /[.,]\s*$/.test(t) || t.split(" ").length > 8);
    const isPower = /^\W*imprinted:/i.test(t) || (!numStart && (e.bullet === "greater" || sentence || t.length > 70)) || prose;
    if (isPower) {
      if (/^\W*imprinted:/i.test(t)) imprinted = true;
      power.push(t.replace(/^\W*imprinted:\s*/i, ""));
      continue;
    }
    if (!/\d/.test(t)) continue;
    // "54.0% increased damage." = tail of a power paragraph, not an affix
    if (/\.\s*$/.test(t) && /\b(increased|damage|seconds?|chance)\b/i.test(t) && power.length) {
      power.push(t);
      continue;
    }
    stats.push({ text: cleanStat(t), bullet: e.bullet, delta: deltaOf(t) });
  }
  const category = categoryOf(typeLine, L.map((l) => l.text).join("\n"));
  // white, blue and yellow items carry few stats, often none we can read: still worth a "sell it" verdict
  // (without an AI model they used to be unreadable, 2026-10-12 player report)
  const plain = !/mythic|unique|legendary/i.test(typeLine);
  if (stats.length < 2 && category === "gear" && !plain) return null;

  // 4) assemble
  const targets = buildTargetNames(variant);
  // the base stat line ("801 Armor", "288 All Resist") has no bullet: never a greater affix, whatever the
  // icon check saw beside it (a 4★ Paingorger's was read as 5★, 2026-10-11)
  const baseLine = (t: string, i: number) => i === 0 && /^\d[\d,.]*\s+(armor|all resist)\b/i.test(t);
  const affixes: ParsedAffix[] = stats.map((s, i) => ({
    text: s.text,
    greater: s.bullet === "greater" && !baseLine(s.text, i),
    tempered: s.bullet === "tempered",
    masterwork: s.bullet === "masterwork",
    enchanted: s.bullet === "enchanted",
    match: matchTarget(s.text, targets),
  }));
  // sanity: the ✸ marks after the name count greater affixes — if the icon check disagrees, trust the marks for the count
  const ga = affixes.filter((a) => a.greater).length;
  if (starMarks > 0 && ga === 0) {
    // couldn't see icons (low res) — no guess about which; leave as is
  }
  const tl = typeLine.toLowerCase();
  // OCR slips at 1080p: "Ancestrah1ya1ic Nique" / "Mythieunique" / "Uniqye" (a mythic read as common
  // got Occultist imprint advice, 2026-10-12 player report)
  const rarity0 = /myth|[1il]?ya[1il]ic\b/.test(tl) ? "mythic" : /uniq|un[il1]que|\bn[il1]que\b/.test(tl) ? "unique" : /legendary/.test(tl) ? "legendary" : /\brare\b/.test(tl) ? "rare" : /magic|[a-z]?[aä]k[il1]c\b|m[a-z]g[il1]c/.test(tl) ? "magic" : "common"; // "ii/ölakic" = Magic
  const rarity = rarity0;
  // blue and white items never roll ★ greater affixes: an icon check that saw one was wrong
  if (rarity === "magic" || rarity === "common") for (const a of affixes) a.greater = false;
  const powerText = power.join(" ").replace(/\s+/g, " ").trim();
  // the power text names the aspect; when it's garbled or cut short, the item's name does
  // ("Ocelot's Eye of Reanimation" → Aspect of Reanimation)
  const nameAspect = rarity === "legendary" ? aspectFromItemName(name) : null;
  const legendaryName =
    rarity === "legendary"
      ? identifyAspect(powerText) ?? nameAspect ?? (/ of /i.test(name) ? `Aspect ${name.slice(name.toLowerCase().lastIndexOf(" of ")).trim()}` : "")
      : "";
  const all = L.map((l) => l.text).join(" ");
  const tempers = all.match(/tempers:\s*(\d)\s*\/\s*(\d)/i);

  let compare: ParsedItem | null = null;
  let compareRows: CompareRow[] | undefined;
  if (lostStart >= 0 || stats.some((s) => s.delta)) {
    const lacks = (s: { text: string; delta: string | null }) => !!s.delta && !s.delta.startsWith("-") && sameMagnitude(s.text, s.delta);
    const shared = stats.filter((s) => s.delta && !lacks(s)).map((s) => s.text);
    const samePower = lostStart >= 0 && !lostPower && power.length > 0;
    const num = (t: string) => Number((t.match(/[\d][\d,]*\.?\d*/)?.[0] ?? "").replace(/,/g, "")) || 0;
    const rows: CompareRow[] = [];
    for (const st of stats) {
      const mine = num(st.text);
      const label = cleanStat(st.text).replace(/^[+x\-]?\s*[\d.,]+%?\s*/, "");
      const pct = /%/.test(st.text) ? "%" : "";
      let yours: number | null = mine;
      if (st.delta) yours = lacks(st) ? null : Math.round((mine - Number(st.delta.replace(/[^\d.\-]/g, ""))) * 10) / 10;
      rows.push({ label, mine, yours, unit: pct, wanted: !!matchTarget(st.text, targets), match: matchTarget(st.text, targets) });
    }
    for (const t of lost) {
      const label = cleanStat(t).replace(/^[+x\-]?\s*[\d.,]+%?\s*/, "");
      rows.push({ label, mine: null, yours: num(t), unit: /%/.test(t) ? "%" : "", wanted: !!matchTarget(t, targets), match: matchTarget(t, targets) });
    }
    compareRows = rows;
    compare = {
      // if switching wouldn't lose a power, you're wearing the same unique / aspect
      name: samePower ? finalNameFor(name, rarity) : "Your equipped item",
      rarity: "unknown",
      itemType: typeLine,
      slot: slotOf(typeLine),
      itemPower: null,
      affixes: [...shared, ...lost].map((t) => ({ text: t, greater: false, match: matchTarget(t, targets) })),
      aspect: samePower ? { name: legendaryName, text: powerText } : null,
      equipped: true,
    };
  }

  // repair OCR'd titles: snap uniques to the official name; for legendaries fix the "of X" suffix from the aspect
  let finalName = name;
  // uniques: title, unique power and the stats it always rolls, together (identify.ts), so a mangled or
  // missing title, or one merged with the comparison column's ("DEATHGRIP F o c USED STRIDER'S"), still names
  // it; a clear winner only, else the title or power on its own as before
  if (rarity === "unique" || rarity === "mythic") {
    const pick = confident(identifyUniqueFrom({ title: rawName.replace(/[*✸✹✺❋✷]/g, ""), itemType: typeLine, power: powerText, stats: stats.map((s) => s.text) }));
    finalName = pick?.name ?? (rawName.trim() ? canonicalUnique(name, typeLine) : null) ?? identifyUnique(powerText, typeLine) ?? name;
  }
  else if (legendaryName && / of /i.test(name)) {
    const suffix = legendaryName.replace(/^aspect\s+of\s+/i, "").replace(/\s+aspect$/i, "");
    const cut = name.toLowerCase().lastIndexOf(" of ");
    if (suffix && trigramSim(name.slice(cut + 4), suffix) >= 0.45) finalName = name.slice(0, cut + 4) + suffix;
  }

  return {
    name: finalName,
    rarity,
    itemType: typeLine,
    slot: slotOf(typeLine),
    itemPower: Number(all.match(/(\d{3,4})\s*item power/i)?.[1] ?? 0) || null,
    ancestral: /ancestral/i.test(typeLine),
    affixes,
    aspect: power.length ? { name: legendaryName, text: powerText, imprinted } : nameAspect ? { name: nameAspect, text: "" } : null,
    sockets: L.filter((l) => /socket/i.test(l.text)).length,
    rawText: L.map((l) => l.text).join("\n"),
    // opened from the Character panel there's no EQUIPPED header, but the footer offers "Unequip";
    // a tooltip comparing itself with your gear ("Properties lost when equipped", "(+23%)") is never
    // the one you wear, whatever stray "Unequip" a neighbouring panel adds to the read
    equipped: equippedLabel || (lostStart < 0 && !stats.some((s) => s.delta) && L.some((l, i) => i > ti && isUnequipLine(l.text))),
    truncated: L.some((l) => /scroll down/i.test(l.text)),
    untitled: !rawName.trim() || undefined,
    category,
    tempersUsed: tempers ? Number(tempers[1]) : undefined,
    toughness: toughnessOf(all),
    compare,
    compareRows,
    compareKind: lostPowerKind,
  };
}

/** The game's Toughness change for the swap: "(-11.5% Toughness)" on the armor / resist line. */
export function toughnessOf(text: string): number | undefined {
  const m = text.match(/\(\s*([+\-−]?)\s*(\d{1,3}(?:[.,]\d)?)\s*%\s*toughness/i);
  if (!m) return undefined;
  const v = Number(m[2].replace(",", "."));
  return m[1] === "-" || m[1] === "−" ? -v : v;
}

/** Quick check used by tests: how sure are we the parse makes sense? */
export function looksSane(p: ParsedItem): boolean {
  if (p.category && p.category !== "gear") return p.name.length >= 3;
  // white, blue and yellow gear may have no stats, and a white item's title is its kind ("RING" / "Ancestral
  // Ring"): rejected here, they went to the AI read, which called them unique and scrapped them, or were
  // unreadable without one (2026-10-13 test). No power paragraph, so a legendary that lost its rarity word still goes on.
  if (/^(common|magic|rare)$/.test(p.rarity) && !p.aspect) return p.name.length >= 3 && p.slot !== "other" && !!p.itemPower;
  return p.name.length >= 3 && p.affixes.length >= 2 && p.slot !== "other" && (!!p.untitled || similarity(p.name, p.itemType) < 0.8);
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
