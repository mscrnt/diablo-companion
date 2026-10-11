// OCR-anchored tooltip parsing.
// Windows OCR gives us the exact text lines of ONE tooltip; the vision LLM only
// LABELS those lines (name / stat / greater / tempered / power …) and reads the
// rarity colour. It never writes item text itself, so it can't invent names.
// Stat → build-target matching is done locally against the game's stat names.
import { chatJson, imagePart, type LlmConfig } from "./llm";
import { identifyAspect, normStat, similarity } from "./names";
import { snapLine } from "./ocrfix";
import type { BuildVariant, ParsedAffix, ParsedItem } from "./types";

export const ROLES = ["name", "type", "ip", "implicit", "affix", "tempered", "cont", "power", "socket", "flavor", "other"] as const;
export type Role = (typeof ROLES)[number];

const SCHEMA = {
  type: "object",
  properties: {
    found: { type: "boolean" },
    name: { type: "string" },
    rarity: { type: "string", enum: ["common", "magic", "rare", "legendary", "unique", "mythic", "unknown"] },
    slot: {
      type: "string",
      enum: ["helm", "chest", "gloves", "pants", "boots", "amulet", "ring", "weapon", "offhand", "charm", "seal", "other"],
    },
    lines: {
      type: "array",
      items: {
        type: "object",
        properties: {
          i: { type: "integer" },
          r: { type: "string", enum: ROLES },
          g: { type: "boolean" },
        },
        required: ["i", "r", "g"],
        additionalProperties: false,
      },
    },
  },
  required: ["found", "name", "rarity", "slot", "lines"],
  additionalProperties: false,
};

const SYSTEM = `You label the text lines of ONE Diablo IV item tooltip. The OCR lines are numbered; label every line by its number.
Roles:
- name: the item name (big coloured title at the very top; may span 2 lines; NOT the type line)
- type: the item type line ("Ancestral Legendary Gloves", "Unique Helm", "Two-Handed Scythe"…)
- ip: item power / quality / level / durability / sell value / "Equipped" / requirements / bound
- implicit: base stats above the divider (Armor, resistances on jewellery, damage per hit…)
- affix: a normal stat line ("+12.5% Critical Strike Chance", "+3 to Minion Skills")
- tempered: a stat added by tempering (hammer-style bullet, usually listed last)
- cont: continuation of the previous line when OCR wrapped it
- power: the legendary/unique power paragraph, including lines starting "Imprinted:"
- socket: socket / gem / rune lines
- flavor: italic lore text
- other: anything else (key hints like Equip/Drop/CTRL, "Properties lost when equipped:" and the stat lines listed under it: those belong to the OTHER item)
g = true only for a GREATER affix (small star/flame icon instead of the normal diamond bullet).
Also give: name = the item name exactly as printed; rarity from the NAME COLOUR (white common, blue magic, yellow rare, orange legendary, gold/tan unique, purple/pink mythic); slot.`;

export interface TooltipText {
  /** OCR lines of this tooltip, top → bottom */
  lines: string[];
  /** cropped image of this tooltip (base64 jpeg) */
  image: string;
  /** deterministic: the tooltip says "Equipped" (or its footer offers "Unequip") */
  equipped: boolean;
  /** OCR lines + bullet icon class (+ height and box), for the instant (no-LLM) parser */
  fast?: import("./fastparse").FastLine[];
}

export interface ParseDebug {
  ocr: string[];
  raw: unknown;
  ms: number;
}

/** Strip comparison deltas "(+17)", "(-8.5%)", "(3.2% Toughness)" and roll ranges "[10 - 14]%". */
export function cleanStat(t: string) {
  return t
    .replace(/\((?:[+\-]\s*)?[\d.,]+%?(?:\s+\w+)?\)/g, " ")
    .replace(/\[[^\]]*\]%?/g, " ")
    .replace(/^[◆♦•●▪★☆✦✧◇*·\s]+/, "")
    .replace(/\s+/g, " ")
    .trim();
}

function titleCase(n: string) {
  const t = n.trim();
  if (t !== t.toUpperCase()) return t;
  return t
    .toLowerCase()
    .replace(/(^|[\s-])([a-z])/g, (_m, p, c) => p + c.toUpperCase())
    .replace(/(?!^)\b(Of|The|And|To)\b/g, (w) => w.toLowerCase());
}

/** Best build target for a stat line, or null. Strict enough that Crit Chance ≠ Crit Damage. */
export function matchTarget(text: string, targets: string[]): string | null {
  const t = normStat(cleanStat(text));
  if (!t) return null;
  let best: string | null = null;
  let bestS = 0;
  for (const name of targets) {
    const s = similarity(t, name);
    if (s > bestS) {
      bestS = s;
      best = name;
    }
  }
  // "Physical Resistance" must not count as "Resistance to All Elements"
  if (best && /all elements/i.test(best) && !/all/i.test(text)) return null;
  return bestS >= 0.75 ? best : null;
}

export function buildTargetNames(variant: BuildVariant | undefined): string[] {
  const s = new Set<string>();
  for (const g of variant?.gear ?? []) {
    if (g.group !== "gear") continue;
    g.affixes.forEach((a) => s.add(a.name));
    g.implicits.forEach((a) => s.add(a.name));
    g.tempers.forEach((a) => s.add(a.name.replace(/\s*\(.*\)\s*$/, "")));
  }
  return [...s];
}

export async function parseTooltipText(cfg: LlmConfig, tip: TooltipText, variant: BuildVariant | undefined): Promise<{ item: ParsedItem | null; debug: ParseDebug }> {
  const t0 = performance.now();
  // misread words fixed against the game's own text first, so the model labels clean lines
  // (the log keeps what OCR really read, so replays can measure the snapping)
  const ocrRaw = tip.lines.map((l) => l.trim()).filter(Boolean);
  const ocr = ocrRaw.map(snapLine);
  const numbered = ocr.map((l, i) => `${i}: ${l}`).join("\n");
  const raw = await chatJson<{ found: boolean; name: string; rarity: string; slot: string; lines: { i: number; r: Role; g: boolean }[] }>(
    cfg,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: [imagePart(tip.image), { type: "text", text: `OCR lines:\n${numbered}` }] },
    ],
    { jsonSchema: { name: "d4_lines", schema: SCHEMA }, maxTokens: 1600, timeoutMs: 45000 },
  );
  const debug: ParseDebug = { ocr: ocrRaw, raw, ms: Math.round(performance.now() - t0) };
  if (!raw.found) return { item: null, debug };

  const role = new Map<number, { r: Role; g: boolean }>();
  for (const l of raw.lines ?? []) if (l.i >= 0 && l.i < ocr.length) role.set(l.i, { r: l.r, g: !!l.g });

  // Comparison view (hovering a backpack item): the game appends
  //   "Properties lost when equipped:" + the stats YOUR item has that this one lacks.
  // Everything in that block belongs to the equipped item, never to the hovered one.
  const lostStart = ocr.findIndex((l) => /properties lost when equipped/i.test(l));
  const blockEnd = (from: number) => {
    for (let i = from; i < ocr.length; i++) if (SECTION_END.test(ocr[i])) return i;
    return ocr.length;
  };
  const lostEnd = lostStart >= 0 ? blockEnd(lostStart + 1) : -1;
  const inLost = (i: number) => lostStart >= 0 && i > lostStart && i < lostEnd;

  type Stat = { text: string; greater: boolean; tempered: boolean; implicit: boolean; delta: string | null };
  const stats: Stat[] = [];
  const lost: string[] = [];
  const power: string[] = [];
  const nameLines: string[] = [];
  const typeLines: string[] = [];
  let last: "stat" | "lost" | "power" | null = null;
  ocr.forEach((text, i) => {
    const lab = role.get(i) ?? { r: "other" as Role, g: false };
    let r = lab.r;
    if (i === lostStart) {
      last = null;
      return;
    }
    if (inLost(i)) {
      // wrapped lines inside the block start without a number → continuation
      if (!/^[+x\-]?\s*[\d.,]+/i.test(text) && lost.length) lost[lost.length - 1] += " " + text;
      else lost.push(cleanStat(text));
      last = "lost";
      return;
    }
    // safety nets: "Imprinted: ..." and long sentences are powers, never stats
    if (/^\W*imprinted:/i.test(text)) r = "power";
    if ((r === "affix" || r === "implicit") && text.length > 70 && !/^[+x\-]?\s*[\d.,]+/i.test(text)) r = "power";
    if (r === "name") nameLines.push(text);
    else if (r === "type") typeLines.push(text);
    else if (r === "implicit" || r === "affix" || r === "tempered") {
      stats.push({ text: cleanStat(text), greater: lab.g, tempered: r === "tempered", implicit: r === "implicit", delta: deltaOf(text) });
      last = "stat";
    } else if (r === "power") {
      power.push(text.replace(/^\W*imprinted:\s*/i, ""));
      last = "power";
    } else if (r === "cont") {
      if (last === "stat" && stats.length) {
        const s = stats[stats.length - 1];
        s.text = cleanStat(s.text + " " + text);
        s.delta ??= deltaOf(text);
      } else if (last === "power") power.push(text);
    } else last = null;
  });

  // name: the model's spelling is cleaner, but only trust it when it agrees with what OCR saw
  const ocrName = nameLines.join(" ").replace(/[^A-Za-z0-9'’\- ]+/g, " ").replace(/\s+/g, " ").trim();
  const agrees = !!raw.name && !!ocrName && similarity(raw.name, ocrName) >= 0.6;
  let name = agrees ? raw.name : ocrName;
  // OCR missed the title entirely and the model's answer is just the type line → unknown name
  const typeLine = typeLines.join(" ").replace(/\s+/g, " ").trim();
  if (!name) name = raw.name && !similarity(raw.name, typeLine) ? raw.name : "";
  if (name && typeLine && similarity(name, typeLine) > 0.8) name = "";
  name = titleCase(name || `(${typeLine || "item"}: name not visible)`);

  // rarity from the type line beats colour guessing
  const tl = typeLine.toLowerCase();
  const rarity = /mythic/.test(tl) ? "mythic" : /unique/.test(tl) ? "unique" : /legendary/.test(tl) ? "legendary" : /\brare\b/.test(tl) ? "rare" : /magic/.test(tl) ? "magic" : raw.rarity;

  const targets = buildTargetNames(variant);
  const affixes: ParsedAffix[] = stats.map((s) => ({ text: s.text, greater: s.greater, tempered: s.tempered, match: matchTarget(s.text, targets) }));
  const legendaryName = /\bof\b/i.test(name) ? `Aspect ${name.slice(name.toLowerCase().lastIndexOf(" of ")).trim()}` : "";
  const tempers = ocr.join(" ").match(/tempers:\s*(\d)\s*\/\s*(\d)/i);

  // Reconstruct the EQUIPPED item from the comparison: stats whose delta isn't the full
  // value exist on both items; "(+full value)" means yours lacks it; plus the lost block.
  let compare: ParsedItem | null = null;
  if (lostStart >= 0 || stats.some((s) => s.delta)) {
    const lacks = (s: { text: string; delta: string | null }) => !!s.delta && !s.delta.startsWith("-") && sameMagnitude(s.text, s.delta);
    const shared = stats.filter((s) => s.delta && !lacks(s)).map((s) => s.text);
    const theirs = [...shared, ...lost].map((t) => ({ text: t, greater: false, match: matchTarget(t, targets) }));
    compare = {
      name: "Your equipped item",
      rarity: "unknown",
      itemType: typeLine,
      slot: raw.slot,
      itemPower: null,
      affixes: theirs,
      aspect: null,
      equipped: true,
    };
  }

  const item: ParsedItem = {
    name,
    rarity,
    itemType: typeLine,
    slot: raw.slot,
    itemPower: Number(ocr.join(" ").match(/(\d{3,4})\s*item power/i)?.[1] ?? 0) || null,
    ancestral: /ancestral/i.test(typeLine),
    affixes,
    aspect: power.length
      ? {
          name: rarity === "legendary" ? identifyAspect(power.join(" ")) ?? legendaryName : "",
          text: power.join(" ").replace(/\s+/g, " ").trim(),
          imprinted: ocr.some((l) => /^\W*imprinted:/i.test(l)),
        }
      : null,
    truncated: ocr.some((l) => /scroll down/i.test(l)),
    sockets: ocr.filter((_, i) => role.get(i)?.r === "socket").length,
    rawText: ocr.join("\n"),
    equipped: tip.equipped,
    tempersUsed: tempers ? Number(tempers[1]) : undefined,
    compare,
  };
  return { item, debug };
}

const SECTION_END = /legendary power|unique power|^socket|empty socket|requires level|account bound|sell value|durability|tempers:|lord of hatred item/i;

/** "(+28%)" / "(-73)" delta at the end of a stat line, if any. */
function deltaOf(t: string): string | null {
  return t.match(/\(\s*([+\-]\s*[\d.,]+%?)\s*\)?\s*$/)?.[1]?.replace(/\s+/g, "") ?? t.match(/\(\s*([+\-][\d.,]+%?)/)?.[1] ?? null;
}

/** "+24% Movement Speed" with delta "+24%" → the equipped item doesn't have the stat. */
function sameMagnitude(text: string, delta: string): boolean {
  const v = Number((text.match(/[\d.,]+/)?.[0] ?? "").replace(/,/g, ""));
  const d = Math.abs(Number(delta.replace(/[^\d.\-]/g, "")));
  // "(+22%)" on a 23% stat still means yours doesn't have it (the game rounds/scales deltas)
  return v > 0 && Math.abs(v - d) / v < 0.1;
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
