// Infernal Hordes helper: spots the Infernal Offers on screen, ranks them for
// Aether vs danger, advises which Spoils chest to open at the end, and times the run
// (wave by wave) from the quest tracker.
// Offer texts come from the game files read off this PC (gamedata/gen.ts genHordes).
import { isDungeonCleared } from "./dungeon";
import { isWarPlansScreen } from "./helltide";
import { generatedTable, normName, onStaticData, trigramSim } from "./names";
import type { OcrLine } from "./native";
import type { BuildVariant, SlotProgress } from "./types";

export interface Offer {
  key: string;
  title: string;
  bane: string;
  boon: string;
}
// filled from the game data read off this PC (names.ts loadStaticData); empty until then
export const OFFERS: Offer[] = [];
export const CHESTS: { key: string; name: string; detail: string; cost: number | null }[] = [];
/** The offers and Spoils chests from the generated tables. */
onStaticData(() => setHordesData(generatedTable("hordes")));
export function setHordesData(d: { offers?: Offer[]; chests?: typeof CHESTS } | null) {
  OFFERS.splice(0, OFFERS.length, ...(d?.offers ?? []));
  CHESTS.splice(0, CHESTS.length, ...(d?.chests ?? []));
}

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
  /** recognised by its effect text (you stand next to it), not its title */
  byEffect?: boolean;
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
    const why = sc.note ?? `${best.boon}, but ${best.bane.toLowerCase()}`;
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
  // 3) the offer you stand next to shows its effects instead of its title ("Soulspires grant 2.5x Aether" /
  //    "Soulspires spawn less often"): it was missed, and the best offer dropped out of the ranking (2026-10-15
  //    test). Its boon and bane, wrapped over several lines, both have to be there.
  //    Similar offers share most words ("Soulspires grant 2x / 2.25x / 2.5x Aether"), so numbers count, and each
  //    bit of text names one offer: the best match takes it.
  const words: { w: string; line: OcrLine }[] = [];
  for (const l of lines) for (const w of tokens(l.text)) words.push({ w, line: l });
  const matches: { o: Offer; score: number; boon: OcrLine; bane: OcrLine }[] = [];
  for (const o of candidates) {
    if (found.has(o.key)) continue;
    const boon = phraseAt(words, o.boon);
    const bane = phraseAt(words, o.bane);
    if (boon && bane) matches.push({ o, score: boon.hit + bane.hit, boon: boon.line, bane: bane.line });
  }
  const used = new Set<OcrLine>();
  for (const m of matches.sort((a, b) => b.score - a.score)) {
    if (used.has(m.boon) || used.has(m.bane)) continue;
    used.add(m.boon).add(m.bane);
    // two offers share a title ("The Summoned Hellborne": hunting you, or spawning with Aether Events); the effects
    // tell them apart, so they replace a guess made from the title alone
    for (const [k, f] of found) if (f.title === m.o.title && k !== m.o.key && !f.byEffect) found.delete(k);
    const box = [m.boon, m.bane].map((l) => boxOf(l)).reduce((a, b) => {
      const x0 = Math.min(a.x, b.x),
        y0 = Math.min(a.y, b.y);
      return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    });
    const o = m.o;
    const sc = scoreOffer(o, style);
    found.set(o.key, { key: o.key, title: o.title, boon: o.boon, bane: o.bane, box, score: sc.score, rank: 0, byEffect: true, why: sc.note ?? `${o.boon}, but ${o.bane.toLowerCase()}` });
  }
  const list = [...found.values()].sort(byRank);
  list.forEach((o, i) => (o.rank = i + 1));
  return list;
}

/** Offers seen on the current offer screen, one slot per title, with how many reads saw each. */
export type Remembered = Map<string, { offer: SeenOffer; hits: number }>;

/**
 * Add one read's offers. One slot per title: two offers share "The Summoned Hellborne", and once its effects
 * named it, a later read of the title alone doesn't turn it back into a guess.
 */
export function rememberOffers(remembered: Remembered, seenNow: SeenOffer[]) {
  for (const o of seenNow) {
    const had = remembered.get(o.title);
    remembered.set(o.title, { offer: had?.offer.byEffect && !o.byEffect ? had.offer : o, hits: (had?.hits ?? 0) + 1 });
  }
}

/**
 * The ranking shown: every offer seen on this screen (four pillars a wave). It used to keep the three this
 * player's camera read most often, so two players in one run got different picks (2026-10-15 test).
 */
export function rankRemembered(remembered: Remembered, seenNow: SeenOffer[]): SeenOffer[] {
  const nowTitles = new Set(seenNow.map((o) => o.title));
  return [...remembered.values()]
    .sort((x, y) => y.hits - x.hits)
    .slice(0, 4)
    .map(({ offer }) => ({ ...(seenNow.find((o) => o.key === offer.key) ?? offer), visible: nowTitles.has(offer.title) }))
    .sort(byRank)
    .map((o, i) => ({ ...o, rank: i + 1 }));
}

/** Best first; ties in a fixed order, so the list doesn't flip between reads. */
export const byRank = (a: { score: number; key: string }, b: { score: number; key: string }) => b.score - a.score || a.key.localeCompare(b.key);

/** Words of 3+ letters, and every number ("2.25x" → "2", "25x"): they tell similar offers apart. */
const tokens = (t: string) => normName(t).split(" ").filter((w) => w.length >= 3 || /\d/.test(w));

/**
 * Where an offer's effect text is on screen, and how much of it: the line its words start on, if most of them
 * appear within a short window. OCR slips ("Buming") cost a word, not the match.
 */
function phraseAt(words: { w: string; line: OcrLine }[], phrase: string): { line: OcrLine; hit: number } | null {
  const want = tokens(phrase);
  if (want.length < 3) return null;
  let best = 0;
  let at: OcrLine | null = null;
  for (let i = 0; i < words.length; i++) {
    if (!want.includes(words[i].w)) continue;
    const win = new Set(words.slice(i, i + want.length + 2).map((x) => x.w));
    const hit = want.filter((w) => win.has(w)).length / want.length;
    if (hit > best) {
      best = hit;
      at = words[i].line;
    }
  }
  return best >= 0.75 && at ? { line: at, hit: best } : null;
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
    why.push(`${gearMissing} gear slot${gearMissing > 1 ? "s" : ""} not perfect yet: Greater Equipment rolls greater affixes.`);
  }
  if (mwLeft) {
    order.push("Spoils of Materials");
    why.push(`Masterworking isn't finished on ${mwLeft} slot${mwLeft > 1 ? "s" : ""}: materials help.`);
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
  // OCR garbles it ("commss (37)", "Legendary Infemal Hordes" for the type line "Legendary Infernal Hordes Compass")
  const keyTooltip = /gates of hell|\bco[mn]{1,3}p?a?s{1,2}\b|pass through the|legendary\s+[il1]nfe(?:rn|m|r)al/i;
  if (keyTooltip.test(text) && !/wave[:\s]*\d+\s*\/\s*\d+/i.test(text)) return false;
  // the War Plans screen's "Infernal Hordes" tab isn't a run
  if (isWarPlansScreen(text)) return false;
  // tolerate OCR slips: "Infemal" (rn→m), "lnfernal", "WAVE: 10/10"
  return /[il1]nfe(?:rn|m|r)al\s*hordes|bu(?:rn|m)ing\s*aether|\baether\b|wave[:\s]*\d+\s*\/\s*\d+/i.test(text);
}

export function parseAether(text: string): number | null {
  // "+2 Aether" / "15-24 additional Aether" are offer descriptions, not your count
  const m = text.match(/(?<![+\-\d])(\d{1,4})\s*(?:burning\s+)?aether/i) ?? text.match(/aether[:\s]+(\d{1,4})/i);
  return m ? Number(m[1]) : null;
}

/** "WAVE: 6/10" as OCR reads it: "WAVE; 2/ 10", "MWAVE: 6/10". */
const WAVE = /wave\W{0,2}(\d{1,2})\s*\/\s*(\d{1,2})/i;

/** The Aether count from the tracker: the number on its own just below "WAVE: 6/10" (and the timer). */
export function trackerAether(lines: { text: string }[]): number | null {
  const i = lines.findIndex((l) => WAVE.test(l.text));
  if (i < 0) return null;
  for (const l of lines.slice(i + 1, i + 4)) {
    const m = l.text.trim().match(/^(\d{1,4})$/);
    if (m) return Number(m[1]);
  }
  return null;
}

/** The wave number from the tracker ("WAVE: 6/10" → 6). */
export function trackerWave(text: string): number | null {
  const m = text.match(WAVE);
  return m ? Number(m[1]) : null;
}

/** Where a Hordes wave is: choosing an offer, offer just chosen / wave running, or unknown. */
export function offerPhase(text: string): "selecting" | "chosen" | null {
  if (/you['’]?ve\s*chosen|begin\s*wave/i.test(text)) return "chosen";
  if (/select\s*an\s*[il1]nfe(?:rn|m|r)al\s*offer/i.test(text)) return "selecting";
  return null;
}

export const offerByTitle = (t: string) => OFFERS.find((o) => normName(o.title) === normName(t));

// ---- timing a run from the quest tracker ----
// The block reads "WAVE: 3/10 / 0:50 / 134 (Aether) / Torment XI / The Infernal Hordes / <objective> / Onslaught /
// Revives remaining: 4". The wave number is the wave being fought, and stays on the offer screen after it:
// "WAVE: 0/10" + "Select an Infernal Offer" before wave 1, "WAVE: 1/10" + "Slay monsters to draw out Aether" in
// it, "WAVE: 1/10" + "Select an Infernal Offer" after it. After wave 10: "Defeat the Fell Council", then
// "Dungeon cleared" with the Spoils chests (2026-10-15 and 2026-10-17 runs).

/** offer = choosing an Infernal Offer, wave = fighting, council = the Fell Council, cleared = the run is won */
export type HordesPhase = "offer" | "wave" | "council" | "cleared";

export interface HordesRead {
  wave: number;
  waves: number;
  phase: HordesPhase | null;
  /** "XI" from "Torment X1" */
  torment: string | null;
  revives: number | null;
}

/** Read the Hordes block off the tracker; null when it isn't there. */
export function readHordesTracker(lines: { text: string }[]): HordesRead | null {
  const text = lines.map((l) => l.text).join("\n");
  const m = text.match(WAVE);
  if (!m) return null;
  const wave = Number(m[1]);
  const waves = Number(m[2]);
  if (waves < 5 || waves > 20 || wave > waves) return null;
  // the rest of the block, so another tracker's "WAVE n/N" never passes for it
  if (!/[il1]nfe(?:rn|m|r)al\s*hordes|onslaught|revives\s*remaining|aether|fe[l1]{2}\s*council|select\s*an\W{0,3}[il1]nfe/i.test(text)) return null;
  const phase: HordesPhase | null =
    isDungeonCleared(text) || /spoils\s*of/i.test(text)
      ? "cleared"
      : // "Defeat th�Fell Council"; the council's name over its NPCs in the arena ("THE FELL COUNCIL") has no "Defeat"
        /defeat\W*th\S{0,3}\s*fe[l1]{2}/i.test(text)
        ? "council"
        : /select\s*an\W{0,3}[il1]nfe/i.test(text)
          ? "offer"
          : // the wave's objectives ("Slay monsters to draw out Aether", "Stay near the Soulspire…", "Slay the Aether
            // Fiend: 0/1") or its countdown ("xo:50" for 0:50)
            /slay\s*monsters|draw\s*out|soulspire|aether\s*fiend|^\W{0,2}[xX]?[o0\d]{0,2}\s*[:.;]\s*\d{2}\s*$/im.test(text)
            ? "wave"
            : null;
  const torment = lines.map((l) => l.text.match(/torment\s*([ivxl1]{1,5})\b/i)?.[1]).find(Boolean)?.toUpperCase().replace(/[1L]/g, "I") ?? null;
  const rv = text.match(/revives?\s*remaining\W*(\d{1,2})\b/i);
  return { wave, waves, phase, torment, revives: rv ? Number(rv[1]) : null };
}

/** One Hordes run as the tracker shows it. */
export interface HordesRun {
  /** the wave on the tracker (0 = the first offer screen, before wave 1) */
  wave: number;
  /** a run is timed for it (not when the app came in mid-run, or another run was going) */
  running: boolean;
  startAt: number | null;
  council: boolean;
  done: boolean;
  lastSeen: number;
  /** when the first offer screen ("WAVE: 0/10") was last read: wave 1 began right after it */
  wave0At: number | null;
  /** a jump of more than one wave waits for a second read to agree */
  pending: number | null;
  /** so does a drop back to the start (a new run) */
  restart: number | null;
  revives: number | null;
  revivesPending: number | null;
  /** picked up again after an app restart: the first read sets the wave quietly */
  resumed?: boolean;
}

export interface HordesTracker {
  run: HordesRun | null;
  /** when a run was last seen won ("Dungeon cleared"): its end screen never starts another */
  endSeen: number;
}

export type HordesAction =
  | { kind: "start"; at: number; torment: string | null }
  | { kind: "split"; label: string }
  | { kind: "finish"; success: boolean; at: number; why: string; wave: number }
  /** a run too short to be one (a misread): drop it instead of saving it */
  | { kind: "discard"; why: string; wave: number }
  | { kind: "death"; n: number };

/** the tracker hides behind the map, the bag and loading screens: only this long without it means you left */
export const HORDES_GONE_MS = 90_000;

/**
 * Feed one tracker read (null = no Hordes block on it). Returns what to do with the run timer: start it on
 * wave 1, split per wave and for the Fell Council, finish on "Dungeon cleared" (or when the tracker is gone for
 * good, ending when it was last seen).
 */
export function stepHordes(t: HordesTracker, read: HordesRead | null, now: number, canStart = true): HordesAction[] {
  const out: HordesAction[] = [];
  let s = t.run;
  if (!read) {
    if (s && !s.done && now - s.lastSeen > HORDES_GONE_MS) {
      if (s.running) out.push(endRun(s, false, s.lastSeen, "tracker gone for 90 s"));
      t.run = null;
    } else if (s?.done && now - s.lastSeen > 15_000) t.run = null;
    return out;
  }
  if (read.phase === "cleared") t.endSeen = now;
  if (s?.done) {
    s.lastSeen = now;
    // the end screen stays up while you open the Spoils ("WAVE: 10/10"): only a new first offer screen starts over
    if (read.phase === "cleared" || read.wave > 1) return out;
    t.run = s = null;
  }
  if (s && !s.resumed && read.wave < s.wave - 1 && read.wave <= 1 && read.phase !== "cleared") {
    // back to the start: a new run began before the old one's tracker was gone long enough to end it
    if (s.restart !== read.wave) {
      s.restart = read.wave;
      return out;
    }
    if (s.running) out.push(endRun(s, s.council, s.lastSeen, "a new run began"));
    t.run = s = null;
  }
  if (!s) {
    s = t.run = { wave: read.wave, running: false, startAt: null, council: read.phase === "council", done: false, lastSeen: now, wave0At: read.wave === 0 ? now : null, pending: null, restart: null, revives: read.revives, revivesPending: null };
    // a run starts on wave 1 itself: not on its offer screen (that's after the wave), and not right after a
    // clear (a misread of the end screen)
    if (read.wave === 1 && read.phase !== "offer" && read.phase !== "cleared" && now - t.endSeen > 20_000 && canStart) out.push(startRun(s, now, read));
    return out;
  }
  s.lastSeen = now;
  s.restart = null;
  if (s.resumed) {
    s.resumed = false;
    s.wave = read.wave;
    s.council = read.phase === "council";
    s.revives = read.revives;
    return out;
  }
  if (read.wave === 0 && s.wave === 0) s.wave0At = now;
  if (read.wave > s.wave) {
    // one wave on is the normal step; a bigger jump (reads missed, or a digit slip) needs a second read, unless
    // it's the Fell Council or the clear: they come after the last wave
    const last = (read.phase === "council" || read.phase === "cleared") && read.wave === read.waves;
    if (read.wave === s.wave + 1 || s.pending === read.wave || last) {
      s.pending = null;
      if (s.wave === 0) {
        // wave 1 began. Read in the wave: it began now. Read on the offer screen after it (the tracker was hidden
        // all wave long): it began when the first offer screen was last seen
        if (!s.running && read.wave === 1 && now - t.endSeen > 20_000 && canStart) {
          const at = read.phase === "offer" && s.wave0At && now - s.wave0At < 180_000 ? s.wave0At : read.phase === "offer" ? null : now;
          if (at != null) out.push(startRun(s, at, read));
        }
      } else if (s.running) out.push({ kind: "split", label: read.wave === s.wave + 1 ? `Wave ${s.wave}` : `Waves ${s.wave}-${read.wave - 1}` });
      s.wave = read.wave;
    } else s.pending = read.wave;
  } else if (read.wave === s.wave) s.pending = null;
  if (read.phase === "council" && !s.council && s.wave >= 1) {
    s.council = true;
    if (s.running) out.push({ kind: "split", label: `Wave ${s.wave}` });
  }
  if (read.phase === "cleared" && s.wave >= 1) {
    if (s.running) {
      out.push({ kind: "split", label: s.council ? "Fell Council" : `Wave ${s.wave}` });
      out.push(endRun(s, true, now, "dungeon cleared"));
    }
    s.done = true;
    return out;
  }
  // a revive used: two reads agree on fewer left (they never come back in a run, so more is a misread)
  if (read.revives != null) {
    if (s.revives == null) s.revives = read.revives;
    else if (read.revives < s.revives) {
      if (s.revivesPending === read.revives) {
        if (s.running) out.push({ kind: "death", n: s.revives - read.revives });
        s.revives = read.revives;
        s.revivesPending = null;
      } else s.revivesPending = read.revives;
    } else s.revivesPending = null;
  }
  return out;
}

function startRun(s: HordesRun, at: number, read: HordesRead): HordesAction {
  s.running = true;
  s.startAt = at;
  return { kind: "start", at, torment: read.torment };
}

function endRun(s: HordesRun, success: boolean, at: number, why: string): HordesAction {
  s.running = false;
  // a run that ends within seconds of its start was never one (2 s runs from one misread)
  if (!success && s.startAt != null && at - s.startAt < 20_000) return { kind: "discard", why, wave: s.wave };
  return { kind: "finish", success, at, why, wave: s.wave };
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
