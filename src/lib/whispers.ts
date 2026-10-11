// Tree of Whispers helper: rank the Bounty Caches on the reward screen for the
// active build (slot caches for missing pieces, Talismans for missing charms,
// Primordial Dust for cube crafts…). Cache names come from the game files.
import data from "../generated/hordes.json";
import { table, trigramSim } from "./names";
import type { OcrLine } from "./native";
import type { BuildVariant, SlotProgress } from "./types";

export interface WhisperCache {
  key: string;
  kind: string;
  tier: "normal" | "greater" | "ancestral";
  name: string;
  description: string;
}
export const WHISPER_CACHES: WhisperCache[] = (data as any).whisperCaches ?? [];

const KIND_SLOTS: Record<string, string[]> = {
  Helms: ["helm"],
  Gloves: ["gloves"],
  Legs: ["pants"],
  ChestArmors: ["chest-armor"],
  Boots: ["boots"],
  Rings: ["ring-1", "ring-2"],
  Amulets: ["amulet"],
  "2HWeapons": ["weapon"],
  "1HWeapons": ["weapon", "offhand", "dual-wield-weapon-1", "dual-wield-weapon-2"],
};

export interface RankedCache {
  key: string;
  name: string;
  score: number;
  why: string;
  rank: number;
  box?: { x: number; y: number; w: number; h: number };
}

export function rankCache(c: WhisperCache, variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress): { score: number; why: string } {
  const gear = variant?.gear ?? [];
  const tierBonus = c.tier === "ancestral" ? 1 : c.tier === "greater" ? 0.5 : 0;
  const slots = KIND_SLOTS[c.kind];
  if (slots) {
    const mine = gear.filter((g) => g.group === "gear" && slots.includes(g.slot));
    // a 1H cache is useless for a two-handed build and vice versa
    // the unique's own type says it ("Bloodless Scream" → "2h Scythe"); the name rarely does
    const twoHanded = gear.some((g) => g.slot === "weapon" && /two-?handed|\b2h\b/i.test(`${g.itemName} ${g.itemSlug ?? ""} ${table("uniques")[g.itemSlug]?.t ?? ""}`));
    if (c.kind === "1HWeapons" && twoHanded && !gear.some((g) => g.slot === "offhand")) return { score: 0.2, why: "Your build uses a two-handed weapon." };
    if (!mine.length) return { score: 0.3, why: "Your build doesn't use this slot." };
    let best = { score: 0.5, why: `Your ${mine[0].slotLabel} is already done.` };
    for (const g of mine) {
      const st = prog(g.slot).state;
      const isUnique = g.kind === "unique" || g.kind === "mythic";
      const s =
        st === "missing" ? (isUnique ? 8 : 4.5) : st === "have" ? 3.5 : st === "upgrade" ? 2.5 : 0.5;
      const why =
        st === "missing"
          ? `You still need ${g.itemName} (${g.slotLabel}) — this cache focuses on that slot.`
          : st === "perfect"
            ? `Your ${g.slotLabel} is already perfect.`
            : `Your ${g.slotLabel} (${g.itemName}) can still be upgraded.`;
      if (s > best.score) best = { score: s, why };
    }
    return { score: best.score + tierBonus, why: best.why };
  }
  const talismans = gear.filter((g) => g.group === "talisman");
  const charmsMissing = talismans.filter((g) => prog(g.slot).state === "missing").length;
  const mwLeft = gear.filter((g) => g.group === "gear" && prog(g.slot).masterwork < 12).length;
  const cubeCraft = gear.find((g) => (g.kind === "unique" || g.kind === "mythic") && prog(g.slot).state === "missing" && /scythe|bloodless/i.test(g.itemName));
  switch (c.kind) {
    case "Talisman":
      return charmsMissing
        ? { score: 9 + tierBonus, why: `You still need ${charmsMissing} talisman piece${charmsMissing > 1 ? "s" : ""}${c.tier !== "normal" ? " — Greater guarantees a Horadric Seal" : ""}.` }
        : { score: 1, why: "Your talisman is complete." };
    case "CubeMats":
      return cubeCraft
        ? { score: 6, why: `Primordial Dust for the Horadric Cube — craft ${cubeCraft.itemName}.` }
        : { score: 2.5, why: "Primordial Dust for Horadric Cube upgrades (e.g. Mythic upgrades)." };
    case "CraftingMats":
    case "GemMaterials":
      return { score: mwLeft ? 2.8 : 1.2, why: mwLeft ? `Masterworking/tempering materials — ${mwLeft} slots not maxed.` : "Materials (you're mostly maxed)." };
    case "Keys":
      return { score: 1.8, why: "Infernal Hordes compasses and Nightmare sigils." };
    case "Gold":
    case "Avarice":
      return { score: 1, why: "Gold and materials." };
    default:
      return { score: 2 + tierBonus, why: "Random mix — a gamble." };
  }
}

/** Find cache names in an OCR'd frame and rank them. */
export function findWhisperCaches(lines: OcrLine[], region: { x: number; y: number }, variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress): RankedCache[] {
  const found = new Map<string, RankedCache>();
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 10 || !/collection|cache/i.test(t)) continue;
    let best: WhisperCache | null = null;
    let bs = 0;
    for (const c of WHISPER_CACHES) {
      const s = trigramSim(t, c.name);
      if (s > bs) {
        bs = s;
        best = c;
      }
    }
    if (!best || bs < 0.75 || found.has(best.key)) continue;
    const r = rankCache(best, variant, prog);
    found.set(best.key, { key: best.key, name: best.name, ...r, rank: 0, box: { x: region.x + l.x, y: region.y + l.y, w: l.w, h: l.h } });
  }
  const list = [...found.values()].sort((a, b) => b.score - a.score);
  list.forEach((c, i) => (c.rank = i + 1));
  return list;
}

/** "Grim Favors 10/10" style counters in the tracker or map. */
export function parseGrimFavors(text: string): { have: number; max: number } | null {
  const m = text.match(/grim favou?rs?\D{0,12}(\d{1,3})\s*\/\s*(\d{1,3})/i);
  return m ? { have: Number(m[1]), max: Number(m[2]) } : null;
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
