// Boss mode: spot a boss health bar by name (top centre of the screen), time the kill,
// and show what that boss can drop for your build + what rolls to look for.
import { knowledge } from "./farm";
import { normName, table, trigramSim } from "./names";
import type { OcrLine } from "./native";
import type { BuildVariant, SlotProgress } from "./types";

export interface BossInfo {
  name: string;
  /** build items this boss drops, with what you still want on them */
  wanted: { item: string; slot: string; state: string; lookFor: string }[];
  summon: string[];
  notes: string[];
}

let bossNames: string[] | null = null;
function names(): string[] {
  if (bossNames) return bossNames;
  const set = new Set<string>();
  for (const b of knowledge?.bosses ?? []) if (b.name) set.add(String(b.name).replace(/\s*\(.*\)$/, ""));
  for (const u of Object.values(table("uniques"))) if (u.src) set.add(u.src);
  bossNames = [...set].filter((n) => n.length > 3);
  return bossNames;
}

/** Find a known boss name among OCR lines of the health-bar area. */
export function findBoss(lines: OcrLine[]): string | null {
  for (const l of lines) {
    const t = l.text.trim();
    if (t.length < 5) continue;
    for (const n of names()) {
      const short = n.split(",")[0];
      if (trigramSim(t, n) >= 0.72 || (short.length > 4 && trigramSim(t.split(",")[0], short) >= 0.8)) return n;
    }
  }
  return null;
}

const shortName = (n: string) => n.replace(/Critical Strike/g, "Crit").replace(/ Multiplier/g, "");

export function bossInfo(name: string, variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress): BossInfo {
  const short = normName(name.split(",")[0]);
  const k = (knowledge?.bosses ?? []).find((b: any) => normName(String(b.name)).startsWith(short));
  const wanted: BossInfo["wanted"] = [];
  for (const g of variant?.gear ?? []) {
    if (g.kind !== "unique" && g.kind !== "mythic") continue;
    const src = table("uniques")[g.itemSlug]?.src ?? "";
    const fromKnowledge = (k?.notableDrops ?? []).some((d: string) => normName(d) === normName(g.itemName));
    if (!fromKnowledge && !normName(src).startsWith(short)) continue;
    const p = prog(g.slot);
    const missingStats = g.affixes.filter((a) => !p.have.some((h) => normName(h) === normName(a.name))).map((a) => a.name);
    const ga = g.affixes.filter((a) => a.greater).map((a) => a.name);
    const lookFor =
      p.state === "missing"
        ? "any copy — you don't have it yet"
        : `a copy with ${[...ga.map((x) => "★ " + shortName(x)), ...missingStats.filter((m) => !ga.includes(m)).map(shortName)].slice(0, 3).join(", ")}`;
    wanted.push({ item: g.itemName, slot: g.slotLabel, state: p.state, lookFor });
  }
  const notes: string[] = [];
  if (/lair|grigoire|beast|zir|varshan|duriel|andariel|harbinger|urivar/i.test(name)) notes.push("Any Lair boss kill has a small chance of a Belial's Ambush (Betrayer's Husks for Belial).");
  return { name, wanted, summon: k?.summonMaterials ?? [], notes };
}
