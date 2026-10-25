// Shared build mapping for the importers: the app's gear-slot keys, and references
// resolved from the names a site shows the player.
//
// Mobalytics hands us its own slugs; Maxroll, Icy Veins and d4builds each have ids of
// their own, so those three are read by DISPLAY NAME: `slugOf(name)` against the app's
// tables (built from the game files), with the class where a table has one entry per
// class. None of their catalogs is fetched, bundled or stored.
import { slugOf } from "./gamedata/convert";
import { humanize, lookup, table, type Category } from "./names";
import type { GearSlot, ItemKind, SocketRef, StatRef } from "./types";

export const SLOT_LABELS: Record<string, string> = {
  helm: "Helm",
  "chest-armor": "Chest",
  gloves: "Gloves",
  pants: "Pants",
  boots: "Boots",
  amulet: "Amulet",
  "ring-1": "Ring 1",
  "ring-2": "Ring 2",
  weapon: "Weapon",
  offhand: "Offhand",
  "bludgeoning-weapon": "Bludgeoning Weapon",
  "slashing-weapon": "Slashing Weapon",
  "dual-wield-weapon-1": "Dual Wield 1",
  "dual-wield-weapon-2": "Dual Wield 2",
  "ranged-weapon": "Ranged Weapon",
};
export const GEAR_ORDER = Object.keys(SLOT_LABELS);

export function slotGroup(slot: string): GearSlot["group"] {
  if (/charm|seal/.test(slot)) return "talisman";
  if (/chaos-perk/.test(slot)) return "chaos";
  if (SLOT_LABELS[slot]) return "gear";
  return "other";
}

export function slotLabel(slot: string): string {
  if (SLOT_LABELS[slot]) return SLOT_LABELS[slot];
  const m = slot.match(/charm-(\d+)/);
  if (m) return `Charm ${m[1]}`;
  if (/seal/.test(slot)) return "Seal";
  if (/unique-chaos-perk/.test(slot)) return "Unique Chaos Perk";
  const p = slot.match(/chaos-perk-(\d+)/);
  if (p) return `Chaos Perk ${p[1]}`;
  return humanize(slot.replace(/^season-\d+-/, ""));
}

/** Gear first in the game's slot order, then talisman, chaos perks and the rest. */
export function sortGear(slots: GearSlot[]): GearSlot[] {
  return slots.sort((a, b) => {
    const ga = ["gear", "talisman", "chaos", "other"].indexOf(a.group);
    const gb = ["gear", "talisman", "chaos", "other"].indexOf(b.group);
    if (ga !== gb) return ga - gb;
    const ia = GEAR_ORDER.indexOf(a.slot);
    const ib = GEAR_ORDER.indexOf(b.slot);
    if (ia !== ib) return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib);
    return a.slot.localeCompare(b.slot, undefined, { numeric: true });
  });
}

/** "SkeletonWarrior_Reaper" → "Skeleton Warrior Reaper": one of the game's ids as words. */
export const camelWords = (s: string) => humanize(String(s ?? "").replace(/([a-z\d])([A-Z])/g, "$1-$2").replace(/_/g, "-"));

/** "Necromancer_BloodWave" → "Blood Wave": a power id from the game read as its name. */
export const skillNameOf = (id: string) => camelWords(String(id ?? "").replace(/^(?:NPC_Mercenary_|S\d+_)?[A-Za-z]+_/, ""));

// ---- names → the app's slugs ----------------------------------------------

export interface Ref {
  slug: string;
  name: string;
}

/**
 * A name as another site writes it → the app's slug plus the game's spelling. Tables with
 * one entry per class ("necromancer-sacrificial", "duelists-aspect-druid") are tried with
 * the class too. An unknown name keeps its own spelling, so nothing is lost.
 */
export function refOf(name: string, category?: Category, className?: string): Ref {
  const clean = String(name ?? "").trim();
  if (!clean) return { slug: "", name: "" };
  const slug = slugOf(clean);
  const cls = className ? slugOf(className) : "";
  for (const s of cls ? [slug, `${cls}-${slug}`, `${slug}-${cls}`] : [slug]) {
    const hit = lookup(s, category);
    if (hit?.n) return { slug: s, name: hit.n };
  }
  return { slug, name: clean };
}

/**
 * `refOf` for the few small tables whose entries carry a title the sites leave off
 * ("Varyana" for "Varyana, the Berserker Crone", "Injured" for the opportunity's whole
 * sentence, "ShieldBearer" for "Shieldbearer"). Only one candidate may match, so a
 * half-name never picks the wrong entry.
 */
export function looseRef(name: string, category: Category, className?: string): Ref {
  const exact = refOf(name, category, className);
  if (lookup(exact.slug, category) || exact.slug.length < 4) return exact;
  const flat = exact.slug.replace(/-/g, "");
  const hits = Object.entries(table(category)).filter(([k]) => k.replace(/-/g, "").includes(flat));
  return hits.length === 1 ? { slug: hits[0][0], name: hits[0][1].n } : exact;
}

export function statRef(name: string, flags: { greater?: boolean; masterwork?: boolean } = {}): StatRef {
  const r = refOf(name, "stats");
  return { slug: r.slug, name: r.name, greater: !!flags.greater, masterwork: !!flags.masterwork };
}

/**
 * A tempering line as the sites print it → "Critical Strike Damage (Berserking Finesse)",
 * the shape the rest of the app expects. The roll range and the recipe's category go.
 */
export function temperRef(text: string, flags: { greater?: boolean; masterwork?: boolean } = {}): StatRef {
  const m = String(text ?? "").match(/^\s*(.*?)\s*(?:\(([^)]*)\))?\s*$/);
  const stat = (m?.[1] ?? text).replace(/\[[^\]]*\]/g, " ").replace(/[+x-]?\d[\d.,]*%?/g, " ").replace(/\s+/g, " ").trim();
  const recipe = (m?.[2] ?? "").split(" - ")[0].trim();
  const r = refOf(stat, "stats");
  return { slug: r.slug, name: recipe ? `${r.name} (${recipe})` : r.name, greater: !!flags.greater, masterwork: !!flags.masterwork };
}

// gems and splinters are named by tier on some sites ("Horadric Ruby", "Abyssal Splinter of Sin")
const SOCKET_TIER = /^(crude|chipped|flawed|regular|flawless|royal|grand|lesser|greater|horadric|abyssal)\s+/i;

export function socketRef(name: string): SocketRef {
  const base = String(name ?? "").trim().replace(SOCKET_TIER, "");
  if (!base) return { slug: "", name: "", kind: "other" };
  const rune = refOf(base, "runes");
  if (lookup(rune.slug, "runes")) return { slug: rune.slug, name: rune.name, kind: "rune" };
  const gem = refOf(base, "gems");
  if (lookup(gem.slug, "gems")) return { slug: gem.slug, name: gem.name, kind: "gem" };
  return { slug: slugOf(base), name: base, kind: "other" };
}

/**
 * What kind of thing fills a slot, from its name and the app's tables. `hint` is what the
 * slot or the site calls it ("charm", "seal", "mythic", "unique", "legendary", "set"): a
 * charm that copies a unique carries the unique's name, so the slot decides which it is,
 * and the hint also names what no table knows.
 */
export function itemKindOf(slug: string, name: string, hint = ""): ItemKind {
  if (lookup(slug, "aspects") || /^aspect of\b|\baspect$/i.test(name)) return "aspect";
  const h = hint.toLowerCase();
  const unique = () => {
    const u = lookup(slug, "uniques");
    return u ? (u.m ? "mythic" : "unique") : null;
  };
  const talisman = () => (lookup(slug, "seals") ? "seal" : lookup(slug, "charms") ? "charm" : null);
  const kind = h.includes("charm") || h.includes("seal") ? (talisman() ?? unique()) : (unique() ?? talisman());
  if (kind) return kind;
  if (lookup(slug, "chaosPerks")) return "chaosPerk";
  if (h.includes("mythic")) return "mythic";
  if (h.includes("unique") || h.includes("set")) return "unique";
  if (h.includes("legendary")) return "aspect";
  return "other";
}
