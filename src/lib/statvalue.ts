// How much each stat is worth to YOUR build, and how two items compare on that scale.
// The guide lists a few exact stats per slot; everything else still has some value
// (Crit Chance on a crit build, Max Life anywhere, +Minion ranks on a minion build) and
// a bigger roll beats a smaller one. The judge uses this instead of counting matches.
import { normName, table, trigramSim } from "./names";
import type { BuildVariant, CompareRow, GearSlot, ParsedItem } from "./types";

export interface BuildProfile {
  /** normalised stat name → wanted on some slot (or as a temper) */
  wanted: Set<string>;
  /** words the build is about: "minion", "shadow", "darkness", "skeleton warrior"… */
  tags: string[];
  mainStat: string | null;
}

const MAIN_STATS = ["intelligence", "strength", "dexterity", "willpower"];
const GENERIC_OFFENCE = /critical strike|crit |attack speed|vulnerable|overpower|all damage|^damage$|damage multiplier$|weapon damage/;
const GENERIC_DEFENCE = /maximum life|^armor$|all elements|damage reduction|life regeneration|life on hit|life per second|dodge|barrier|fortify|toughness|healing/;
const UTILITY = /resource cost|cooldown reduction|lucky hit|resource generation|essence|fury|spirit|energy|mana|movement speed|maximum resolve/;
const ELEMENTS = ["fire", "cold", "lightning", "poison", "shadow", "physical", "non-physical"];

/** "+1,304 Maximum Life (+1,155)" / "Intelligence 17)" → "maximum life" / "intelligence". */
export function statKey(text: string): string {
  const t = text
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/\([^)]*\)?/g, " ")
    .replace(/[+x]?\s*-?\d[\d.,]*\s*%?\s*\)?/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  // the tooltip says "+4 to Minion Skills", the guide "Ranks to Minion Skills"
  return canonicalStat(normName(t).replace(/^to /, "ranks to "));
}

const base = (name: string) => canonicalStat(normName(name.replace(/\s*\(.*\)\s*$/, "")));

// The stat names come from the game (the tooltip, the tables read off this PC), a build's from the site it was
// imported from, which words some of them its own way ("Core Skill Damage" for the game's "Core Damage",
// "Critical Strike Damage" for "Critical Strike Damage Multiplier"). Both sides go through this, so they meet.
let canonOf: object | null = null;
let gameNames = new Set<string>();
const canon = new Map<string, string>();
export function canonicalStat(key: string): string {
  const k = key.replace(/ multiplier$/, "");
  const t = table("stats");
  if (canonOf !== t) {
    canonOf = t;
    canon.clear();
    gameNames = new Set(Object.values(t).map((e) => normName(e.n).replace(/ multiplier$/, "")));
  }
  if (!gameNames.size || gameNames.has(k) || k.length < 4) return k;
  let hit = canon.get(k);
  if (hit === undefined) {
    let best = 0.8;
    hit = k;
    for (const n of gameNames) {
      const s = trigramSim(k, n);
      if (s > best) (best = s), (hit = n);
    }
    canon.set(k, hit);
  }
  return hit;
}

export function buildProfile(variant: BuildVariant | undefined): BuildProfile {
  const wanted = new Set<string>();
  const words = new Map<string, number>();
  const count = (w: string) => words.set(w, (words.get(w) ?? 0) + 1);
  for (const g of variant?.gear ?? []) {
    if (g.group !== "gear") continue;
    for (const s of [...g.implicits, ...g.affixes, ...g.tempers]) {
      const k = base(s.name);
      wanted.add(k);
      // "Ranks to Minion Skills" → minion; "Shadow Damage Multiplier" → shadow; "Summon Damage" → summon
      const rank = k.match(/ranks? (?:to|of) (.+?)(?: skills?)?$/);
      if (rank) count(rank[1]);
      const dmg = k.match(/^(\w+) damage/);
      if (dmg && !/all|weapon|critical|vulnerable|overpower/.test(dmg[1])) count(dmg[1]);
    }
  }
  for (const s of variant?.skillBar ?? []) count(normName(s.name));
  // the build's category words show up in skill names too ("Skeleton Warrior" → minion is already a tag)
  if ([...words.keys()].some((w) => /skeleton|golem|army of the dead|raise/.test(w))) count("minion"), count("summon");
  const mainStat = MAIN_STATS.find((m) => wanted.has(m)) ?? null;
  return { wanted, tags: [...words.keys()], mainStat };
}

/** 0…1.2: what one stat line is worth on this slot for this build. */
export function statWeight(key: string, slot: GearSlot, prof: BuildProfile): number {
  if (!key) return 0;
  const here = [...slot.implicits, ...slot.affixes].find((s) => base(s.name) === key || key.startsWith(base(s.name)));
  if (here) return here.masterwork ? 1.2 : 1;
  // your main stat adds damage on every piece: a little more than a stat wanted on another slot
  if (prof.mainStat && key === prof.mainStat) return 0.7;
  if (prof.wanted.has(key)) return 0.6;
  if (key === "all stats") return 0.5;
  if (MAIN_STATS.includes(key)) return 0.05; // another class's main stat
  // "+3 to Corpse Explosion", "Ranks to Curse Skills": only your skills count
  const tagged = (s: string) => s.length >= 4 && prof.tags.some((t) => t.length >= 4 && (s.includes(t) || t.includes(s)));
  const rank = key.match(/^ranks? (?:to|of) (.+?)(?: skills?)?$/);
  if (rank) return tagged(rank[1]) ? 0.6 : 0.05;
  // element/skill-type damage: yours counts, another element barely does
  const el = ELEMENTS.find((e) => key.startsWith(e + " "));
  if (el && /damage/.test(key)) return prof.tags.includes(el) ? 0.5 : 0.05;
  if (/damage/.test(key) && tagged(key.replace(/ damage.*$/, ""))) return 0.5;
  if (GENERIC_OFFENCE.test(key)) return 0.4;
  if (/movement speed/.test(key)) return slot.slot === "boots" ? 0.5 : 0.3;
  if (GENERIC_DEFENCE.test(key)) return 0.25;
  if (UTILITY.test(key)) return 0.25;
  if (/resistance/.test(key)) return 0.1; // a single element's resistance
  return 0.1;
}

export interface StatDelta {
  key: string;
  label: string;
  weight: number;
  mine: number | null;
  yours: number | null;
  unit: string;
  /** signed contribution to the score */
  value: number;
}

const num = (t: string) => {
  const m = t.match(/\d[\d,]*(\.\d+)?/);
  return m ? Number(m[0].replace(/,/g, "")) : null;
};

/** Pair two parsed items' stat lines by stat name (no in-game comparison available). */
export function rowsFromItems(item: ParsedItem, worn: ParsedItem): CompareRow[] {
  const rows: CompareRow[] = [];
  const theirs = worn.affixes.map((a) => ({ key: statKey(a.match ?? a.text), a, used: false }));
  for (const a of item.affixes) {
    const key = statKey(a.match ?? a.text);
    const t = theirs.find((x) => !x.used && x.key === key);
    if (t) t.used = true;
    rows.push({ label: key, mine: num(a.text), yours: t ? num(t.a.text) : null, unit: /%/.test(a.text) ? "%" : "", wanted: false, match: a.match ?? null });
  }
  for (const t of theirs) if (!t.used) rows.push({ label: t.key, mine: null, yours: num(t.a.text), unit: /%/.test(t.a.text) ? "%" : "", wanted: false, match: t.a.match ?? null });
  return rows;
}

/**
 * Score swapping to this item: + when it's better for the build. A stat the other piece
 * lacks counts its full weight; a bigger roll counts part of it, by how much bigger.
 */
export function compareValue(rows: CompareRow[], slot: GearSlot, prof: BuildProfile): { score: number; deltas: StatDelta[] } {
  const deltas: StatDelta[] = [];
  for (const r of rows) {
    const key = r.match ? base(r.match) : statKey(r.label);
    const w = statWeight(key, slot, prof);
    let value = 0;
    if (r.mine != null && r.yours == null) value = w;
    else if (r.mine == null && r.yours != null) value = -w;
    else if (r.mine != null && r.yours != null) {
      const rel = (r.mine - r.yours) / Math.max(Math.abs(r.mine), Math.abs(r.yours), 1e-9);
      value = Math.abs(rel) < 0.03 ? 0 : w * Math.max(-1, Math.min(1, rel * 1.5));
    }
    deltas.push({ key, label: r.match ?? r.label, weight: w, mine: r.mine, yours: r.yours, unit: r.unit, value });
  }
  return { score: deltas.reduce((a, d) => a + d.value, 0), deltas };
}

/** Worth of an item on its own (no comparison): the sum of its stats' weights. */
export function standaloneValue(item: ParsedItem, slot: GearSlot, prof: BuildProfile): number {
  return item.affixes.reduce((a, x) => a + statWeight(statKey(x.match ?? x.text), slot, prof), 0);
}
