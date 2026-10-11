// Infernal Hordes helper: spots the Infernal Offers on screen, ranks them for
// Aether vs danger, and advises which Spoils chest to open at the end.
// Offer texts come from the game files (src/generated/hordes.json, scripts/gen-hordes.mjs).
import data from "../generated/hordes.json";
import { normName, trigramSim } from "./names";
import type { OcrLine } from "./native";
import type { BuildVariant, SlotProgress } from "./types";

export interface Offer {
  key: string;
  title: string;
  bane: string;
  boon: string;
}
export const OFFERS: Offer[] = (data as any).offers;
export const CHESTS: { key: string; name: string; detail: string; cost: number | null }[] = (data as any).chests;

/**
 * Hand-tuned estimates from each offer's boon/bane text:
 * aether = how much extra Aether it tends to give (0–5), risk = added danger (0–5),
 * slow = how much it slows clearing (0–3). Starting points — adjust as we learn.
 */
const SCORES: Record<string, { aether: number; risk: number; slow: number; note?: string }> = {
  AetherGoblins: { aether: 3, risk: 1, slow: 3, note: "goblins pay well but every monster gets tanky" },
  AetherRush: { aether: 1, risk: 2, slow: -1, note: "speed boost only" },
  AmbushingHellborne: { aether: 2, risk: 2, slow: 0 },
  AnchoredMasses: { aether: 2, risk: 2, slow: 0 },
  BlightedSpires: { aether: 3, risk: 1, slow: 0 },
  BlightedVerge: { aether: 2, risk: 1, slow: 0 },
  BlisteringHordes: { aether: 3, risk: 2, slow: 0, note: "faster Aether events" },
  ChaoticOffering: { aether: 4, risk: 3, slow: 1, note: "a Chaos Wave with bonus Aether" },
  ColossalFiends: { aether: 5, risk: 3, slow: 1, note: "fiends become lords and drop 3× Aether" },
  CorruptingSpires: { aether: 3, risk: 2, slow: 1 },
  CovetedSpires: { aether: 4, risk: 0, slow: 0, note: "2× Aether from spires, no real downside" },
  DeadlySpires: { aether: 3, risk: 2, slow: 0 },
  DesolateVerge: { aether: 2, risk: 0, slow: 0 },
  EmpoweredCouncil: { aether: 3, risk: 3, slow: 0, note: "+25 Aether, harder Council" },
  EmpoweredElites: { aether: 3, risk: 1, slow: 2 },
  EmpoweredHellborne: { aether: 2, risk: 2, slow: 0 },
  EnduringLords: { aether: 2, risk: 1, slow: 2 },
  FiendishLegions: { aether: 4, risk: 3, slow: 0, note: "fiends replace elites" },
  FiendishMasses: { aether: 4, risk: 1, slow: 0, note: "+3 Aether per mass" },
  FiendishSpires: { aether: 4, risk: 1, slow: 0, note: "+3 Aether per spire" },
  ForceChaosWaves: { aether: 4, risk: 4, slow: 1, note: "every wave becomes a Chaos Wave" },
  ForceNextChaosWave: { aether: 2, risk: 1, slow: 0 },
  ForceNoChaosWaves: { aether: 0, risk: -1, slow: 0, note: "safe, but no Chaos bonus" },
  GestatingMasses: { aether: 3, risk: 1, slow: 1 },
  GorgingMasses: { aether: 3, risk: 1, slow: 2 },
  HellishMasses: { aether: 2, risk: 2, slow: 0 },
  HellsWrath: { aether: 5, risk: 2, slow: 0, note: "+15–24 Aether at the end of every wave" },
  IncreasedEvadeCooldown: { aether: 2, risk: 1, slow: 0, note: "+25 Aether from the Council" },
  IncreasedPotionCooldown: { aether: 2, risk: 1, slow: 0, note: "+25 Aether from the Council" },
  InfernalLords: { aether: 4, risk: 2, slow: 1, note: "+4 Aether per lord" },
  InfernalStalker: { aether: 5, risk: 4, slow: 1, note: "+100 Aether if you kill the devil" },
  InsatiableSpires: { aether: 4, risk: 0, slow: 1, note: "2× Aether from spires" },
  InvigoratingHellborne: { aether: 0, risk: 2, slow: -1 },
  MassingMasses: { aether: 3, risk: 1, slow: 2 },
  MeteoricHellborne: { aether: 2, risk: 2, slow: 0 },
  PreciousMasses: { aether: 2, risk: 0, slow: 2 },
  PreciousSpires: { aether: 5, risk: 0, slow: 0, note: "2.5× Aether from spires, no real downside" },
  PuffingMasses: { aether: 3, risk: 2, slow: 0 },
  RagingHellfire: { aether: 4, risk: 2, slow: 0, note: "+9–15 Aether at the end of every wave" },
  ReduceAllResistance: { aether: 2, risk: 2, slow: 0, note: "+25 Aether from the Council" },
  RuthlessLords: { aether: 4, risk: 3, slow: 1, note: "+5 Aether per lord" },
  SkulkingHellborne: { aether: 2, risk: 2, slow: 0 },
  SummonedHellborne: { aether: 2, risk: 1, slow: 0 },
  SurgingElites: { aether: 3, risk: 2, slow: 0 },
  SurgingHellborne: { aether: 1, risk: 1, slow: 1 },
  ThrivingMasses: { aether: 4, risk: 3, slow: 0, note: "two extra masses every wave" },
  TransitiveSpires: { aether: 3, risk: 2, slow: 0 },
  TreasuredSpires: { aether: 4.5, risk: 0, slow: 0, note: "2.25× Aether from spires" },
  UnstoppableElites: { aether: 3, risk: 1, slow: 0, note: "your minions don't care about CC" },
};

export type Playstyle = "safe" | "balanced" | "greedy";
const RISK_W: Record<Playstyle, number> = { safe: 0.9, balanced: 0.5, greedy: 0.2 };

export function scoreOffer(o: Offer, style: Playstyle) {
  const s = SCORES[o.key] ?? { aether: 2, risk: 2, slow: 1 };
  return { score: s.aether - s.risk * RISK_W[style] - s.slow * 0.35, ...s };
}

export interface SeenOffer {
  key: string;
  title: string;
  boon: string;
  bane: string;
  /** absolute screen box of the label (for the overlay badge) */
  box: { x: number; y: number; w: number; h: number };
  score: number;
  rank: number;
  why: string;
  /** label on screen in the latest scan (remembered offers still rank, but get no badge) */
  visible?: boolean;
}

/** Find offer labels in an OCR'd frame (titles or their exact boon/bane lines). */
export function findOffers(lines: OcrLine[], region: { x: number; y: number }, style: Playstyle): SeenOffer[] {
  const found = new Map<string, SeenOffer>();
  const candidates = OFFERS.filter((o) => !/^(SelectBartuc|SelectCouncil)$/.test(o.key));
  const boxOf = (l: OcrLine) => ({ x: region.x + l.x, y: region.y + l.y, w: l.w, h: l.h });
  // 1) only an offer's title line creates an offer: description text also shows in other places
  //    (the "View Prior Choices" panel, the chosen banner), and a boss name like "THE FELL COUNCIL"
  //    must not pass for "The Exalted Council"
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 8) continue;
    let best: Offer | null = null;
    let bestS = 0;
    for (const o of candidates) {
      if (t.length > o.title.length + 8) continue;
      // offer titles read "The …": a wrapped description fragment ("Aether Goblins") must not pass for one
      if (/^the /i.test(o.title) && !/^\W{0,3}the/i.test(t)) continue;
      const s = trigramSim(t, o.title);
      if (s > bestS) {
        bestS = s;
        best = o;
      }
    }
    // the "The" prefix and length checks above keep this loose enough for OCR slips ("The Wrath 0fHell")
    if (!best || bestS < 0.68 || found.has(best.key)) continue;
    const sc = scoreOffer(best, style);
    const why = sc.note ?? `${best.boon} — but ${best.bane.toLowerCase()}`;
    found.set(best.key, { key: best.key, title: best.title, boon: best.boon, bane: best.bane, box: boxOf(l), score: sc.score, rank: 0, why });
  }
  // 2) description lines only grow the box of an offer already found by its title
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 12) continue;
    for (const o of found.values()) {
      const def = candidates.find((c) => c.key === o.key)!;
      if (Math.max(def.bane.length > 12 ? trigramSim(t, def.bane) : 0, def.boon.length > 12 ? trigramSim(t, def.boon) : 0) < 0.72) continue;
      const box = boxOf(l);
      const x0 = Math.min(o.box.x, box.x),
        y0 = Math.min(o.box.y, box.y);
      o.box = { x: x0, y: y0, w: Math.max(o.box.x + o.box.w, box.x + box.w) - x0, h: Math.max(o.box.y + o.box.h, box.y + box.h) - y0 };
    }
  }
  const list = [...found.values()].sort((a, b) => b.score - a.score);
  list.forEach((o, i) => (o.rank = i + 1));
  return list;
}

export interface SeenChest {
  key: string;
  name: string;
  cost: number | null;
  box: { x: number; y: number; w: number; h: number };
}

export function findChests(lines: OcrLine[], region: { x: number; y: number }): SeenChest[] {
  const out: SeenChest[] = [];
  for (const l of lines) {
    if (!/spoils/i.test(l.text)) continue;
    let best = null as (typeof CHESTS)[number] | null;
    let bestS = 0;
    for (const c of CHESTS) {
      const s = trigramSim(l.text, c.name);
      if (s > bestS) {
        bestS = s;
        best = c;
      }
    }
    if (best && bestS >= 0.75 && !out.some((o) => o.key === best!.key))
      out.push({ key: best.key, name: best.name, cost: best.cost, box: { x: region.x + l.x, y: region.y + l.y, w: l.w, h: l.h } });
  }
  return out;
}

/** Which Spoils to open, given what the build still needs and the Aether you have. */
export function chestAdvice(variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress, aether: number | null): { order: string[]; why: string[] } {
  const gear = variant?.gear ?? [];
  const charmsMissing = gear.filter((g) => g.group === "talisman" && prog(g.slot).state === "missing").length;
  const gearMissing = gear.filter((g) => g.group === "gear" && prog(g.slot).state !== "perfect").length;
  const mwLeft = gear.filter((g) => g.group === "gear" && prog(g.slot).masterwork < 12).length;
  const order: string[] = [];
  const why: string[] = [];
  if (charmsMissing) {
    order.push("Spoils of Talismans");
    why.push(`You still need ${charmsMissing} talisman piece${charmsMissing > 1 ? "s" : ""} (charms/seal) for your build.`);
  }
  if (gearMissing) {
    order.push("Spoils of Greater Equipment");
    why.push(`${gearMissing} gear slot${gearMissing > 1 ? "s" : ""} not perfect yet — Greater Equipment rolls greater affixes.`);
  }
  if (mwLeft) {
    order.push("Spoils of Materials");
    why.push(`Masterworking isn't finished on ${mwLeft} slot${mwLeft > 1 ? "s" : ""} — materials help.`);
  }
  order.push("Spoils of Equipment", "Spoils of Gold");
  if (aether != null) {
    const plan: string[] = [];
    let left = aether;
    let dump: string | null = null;
    for (const name of order) {
      const c = CHESTS.find((x) => x.name === name);
      if (!c) continue;
      if (!c.cost) {
        dump = name; // "exchange all remaining Aether" chest — everything left goes here
        break;
      }
      const n = Math.floor(left / c.cost);
      if (n > 0) {
        plan.push(`${name} ×${name === "Spoils of Talismans" ? Math.min(n, 1) : n}`);
        left -= c.cost * (name === "Spoils of Talismans" ? Math.min(n, 1) : n);
      }
    }
    if (plan.length || dump)
      why.unshift(`With ${aether} Aether: ${[...plan, ...(left > 0 && dump ? [`the rest (${left}) into ${dump}`] : [])].join(", ")}.`);
  }
  return { order, why };
}

/** "Infernal Hordes" / "Aether" / "Wave 3" in the quest tracker → we're in a Hordes run. */
export function looksLikeHordes(text: string) {
  // a Hordes compass tooltip in the bag says "Pass through the Gates of Hell to face the Infernal Hordes":
  // that's the key, not the run
  if (/gates of hell|\bcompass\b|pass through the/i.test(text) && !/wave[:\s]*\d+\s*\/\s*\d+/i.test(text)) return false;
  // tolerate OCR slips: "Infemal" (rn→m), "lnfernal", "WAVE: 10/10"
  return /[il1]nfe(?:rn|m|r)al\s*hordes|bu(?:rn|m)ing\s*aether|\baether\b|wave[:\s]*\d+\s*\/\s*\d+/i.test(text);
}

export function parseAether(text: string): number | null {
  // "+2 Aether" / "15-24 additional Aether" are offer descriptions, not your count
  const m = text.match(/(?<![+\-\d])(\d{1,4})\s*(?:burning\s+)?aether/i) ?? text.match(/aether[:\s]+(\d{1,4})/i);
  return m ? Number(m[1]) : null;
}

/** The Aether count from the tracker: the number on its own just below "WAVE: 6/10" (and the timer). */
export function trackerAether(lines: { text: string }[]): number | null {
  const i = lines.findIndex((l) => /wave[:\s]*\d+\s*\/\s*\d+/i.test(l.text));
  if (i < 0) return null;
  for (const l of lines.slice(i + 1, i + 4)) {
    const m = l.text.trim().match(/^(\d{1,4})$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The wave number from the tracker ("WAVE: 6/10" → 6). */
export function trackerWave(text: string): number | null {
  const m = text.match(/wave[:\s]*(\d{1,2})\s*\/\s*\d{1,2}/i);
  return m ? Number(m[1]) : null;
}

/** Where a Hordes wave is: choosing an offer, offer just chosen / wave running, or unknown. */
export function offerPhase(text: string): "selecting" | "chosen" | null {
  if (/you['’]?ve\s*chosen|begin\s*wave/i.test(text)) return "chosen";
  if (/select\s*an\s*[il1]nfe(?:rn|m|r)al\s*offer/i.test(text)) return "selecting";
  return null;
}

export const offerByTitle = (t: string) => OFFERS.find((o) => normName(o.title) === normName(t));

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
