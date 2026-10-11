// War Plans planner: 7 activity trees × 7 points. Recommends which nodes fit what
// you're farming (missing uniques → Lair Bosses, missing charms → talisman nodes,
// unfinished masterwork → materials, glyphs → the Pit) and plans a legal path
// (respecting each node's prerequisites). Node data: Mobalytics static data.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { chatJson, type LlmConfig } from "./llm";
import { table } from "./names";
import { persistStorage } from "./persist";
import type { BuildVariant, SlotProgress } from "./types";

export interface WpNode {
  slug: string;
  name: string;
  desc: string;
  tree: string;
  kind: string;
  depends: string[];
  x: number;
  y: number;
  icon?: string;
}

export function trees(): { slug: string; name: string; max: number }[] {
  return Object.entries(table("wpTrees")).map(([slug, t]: [string, any]) => ({ slug, name: t.n, max: t.max ?? 7 }));
}

export function nodes(tree?: string): WpNode[] {
  return Object.entries(table("wpNodes"))
    .map(([slug, n]: [string, any]) => ({ slug, name: n.n, desc: n.d ?? "", tree: n.t, kind: n.k ?? "", depends: n.dep ?? [], x: n.x ?? 0, y: n.y ?? 0, icon: n.ic }))
    .filter((n) => !tree || n.tree === tree);
}

// ---- what you need right now → keyword weights ------------------------------------------

export function needs(variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress, glyphGap: number) {
  const gear = variant?.gear ?? [];
  const missingUniques = gear.filter((g) => (g.kind === "unique" || g.kind === "mythic") && prog(g.slot).state === "missing").length;
  const upgradeable = gear.filter((g) => g.group === "gear" && prog(g.slot).state !== "perfect").length;
  const charms = gear.filter((g) => g.group === "talisman" && prog(g.slot).state === "missing").length;
  const mw = gear.filter((g) => g.group === "gear" && prog(g.slot).masterwork < 12).length;
  return { missingUniques, upgradeable, charms, mw, glyphGap };
}

type Needs = ReturnType<typeof needs>;

const RULES: { re: RegExp; w: (n: Needs) => number; why: string }[] = [
  { re: /unique item|hoard chest|mythic/i, w: (n) => 1 + n.missingUniques * 1.2 + n.upgradeable * 0.2, why: "more uniques for your missing build pieces" },
  { re: /talisman|horadric charm|seal/i, w: (n) => (n.charms ? 1.5 + n.charms * 0.6 : 0.3), why: "talisman pieces (charms/seal)" },
  { re: /glyph/i, w: (n) => (n.glyphGap > 0 ? 1.5 + Math.min(3, n.glyphGap / 40) : 0.4), why: "faster glyph levelling" },
  { re: /obducite|ingolith|neathiron|masterwork|material|salvage/i, w: (n) => (n.mw ? 1 + n.mw * 0.15 : 0.3), why: "masterworking materials" },
  { re: /greater affix|ancestral/i, w: (n) => 1 + n.upgradeable * 0.25, why: "better rolls (greater affixes)" },
  { re: /aether|cinder|grim favou?r/i, w: () => 1, why: "more activity currency" },
  { re: /experience|\bxp\b|paragon/i, w: () => 0.6, why: "more XP" },
  { re: /\bgold\b/i, w: () => 0.3, why: "gold" },
  { re: /monster power|more dangerous|increased damage taken/i, w: () => -0.4, why: "harder content" },
];

export function scoreNode(n: WpNode, need: Needs): { score: number; why: string[] } {
  let score = 0;
  const why: string[] = [];
  for (const r of RULES) {
    if (r.re.test(n.desc)) {
      const w = r.w(need);
      score += w;
      if (w > 0.5) why.push(r.why);
    }
  }
  return { score, why };
}

/** Greedy legal path: pick the best reachable node until the tree's points run out. */
export function planTree(tree: string, need: Needs, owned: Set<string>, points: number) {
  const all = nodes(tree);
  const chosen = new Set(owned);
  const picks: { node: WpNode; score: number; why: string[] }[] = [];
  const reachable = (n: WpNode) => !chosen.has(n.slug) && (n.depends.length === 0 || n.depends.some((d) => chosen.has(d)));
  for (let i = 0; i < points; i++) {
    const cands = all.filter(reachable).map((n) => ({ node: n, ...scoreNode(n, need) }));
    if (!cands.length) break;
    // look one step ahead: a mediocre node that unlocks a great one is worth it
    for (const c of cands) {
      const next = all.filter((m) => m.depends.includes(c.node.slug) && !chosen.has(m.slug));
      const bestNext = Math.max(0, ...next.map((m) => scoreNode(m, need).score));
      (c as any).look = c.score + 0.6 * bestNext;
    }
    cands.sort((a, b) => (b as any).look - (a as any).look);
    const pick = cands[0];
    chosen.add(pick.node.slug);
    picks.push(pick);
  }
  return picks;
}

/** Which tree to put the next point in, given what you need most. */
export function bestTrees(need: Needs, owned: Set<string>) {
  return trees()
    .map((t) => {
      const ownedHere = nodes(t.slug).filter((n) => owned.has(n.slug)).length;
      const left = Math.max(0, t.max - ownedHere);
      const plan = planTree(t.slug, need, owned, Math.min(left, 3));
      return { tree: t, value: plan.reduce((a, p) => a + p.score, 0), next: plan[0] ?? null, left };
    })
    .filter((x) => x.left > 0)
    .sort((a, b) => b.value - a.value);
}

// ---- your unlocked nodes + War Plan progress (persisted) ------------------------------------

interface WpState {
  owned: Record<string, boolean>;
  progress: { step: number; of: number; quest: string; at: number } | null;
  toggle: (slug: string) => void;
  setProgress: (p: WpState["progress"]) => void;
}

export const useWarPlans = create<WpState>()(
  persist(
    (set) => ({
      owned: {},
      progress: null,
      toggle: (slug) => set((s) => ({ owned: { ...s.owned, [slug]: !s.owned[slug] } })),
      setProgress: (progress) => set({ progress }),
    }),
    { name: "warplans", storage: persistStorage },
  ),
);

/** "War Plan: 3/5" in the quest tracker (+ the quest title above it). */
export function parseWarPlan(lines: { text: string; y: number }[]): { step: number; of: number; quest: string } | null {
  const i = lines.findIndex((l) => /war\s*plan\s*:?\s*\d+\s*\/\s*\d+/i.test(l.text));
  if (i < 0) return null;
  const m = lines[i].text.match(/(\d+)\s*\/\s*(\d+)/)!;
  const above = lines
    .filter((l) => l.y < lines[i].y && lines[i].y - l.y < 140)
    .sort((a, b) => b.y - a.y)
    .map((l) => l.text.trim())
    .filter((t) => t.length > 3 && !/torment|tab\b|\d{1,2}:\d{2}/i.test(t));
  // the quest title is usually the line 1–2 rows above the objective text
  return { step: Number(m[1]), of: Number(m[2]), quest: above[above.length > 1 ? 1 : 0] ?? "" };
}

/** Ask the local LLM for a ranked plan (text-only, uses the real node descriptions). */
export async function llmPlan(cfg: LlmConfig, buildSummary: string, need: Needs, owned: Set<string>) {
  const lines = trees()
    .map((t) => `## ${t.name} (${t.slug})\n` + nodes(t.slug).map((n) => `- ${n.slug}${owned.has(n.slug) ? " [OWNED]" : ""}: ${n.name}: ${n.desc.replace(/\*\*/g, "").replace(/\s+/g, " ").slice(0, 200)}${n.depends.length ? ` (needs ${n.depends.join(" or ")})` : ""}`).join("\n"))
    .join("\n\n");
  const schema = {
    type: "object",
    properties: {
      picks: {
        type: "array",
        items: {
          type: "object",
          properties: { tree: { type: "string" }, node: { type: "string" }, why: { type: "string" } },
          required: ["tree", "node", "why"],
          additionalProperties: false,
        },
      },
      summary: { type: "string" },
    },
    required: ["picks", "summary"],
    additionalProperties: false,
  };
  return chatJson<{ picks: { tree: string; node: string; why: string }[]; summary: string }>(
    cfg,
    [
      {
        role: "system",
        content:
          "You plan Diablo IV Season 15 War Plan activity-tree points (7 trees, 7 points each; a node needs one of its listed prerequisites). Recommend the next 6 nodes to take, in order, for the player's current goals. Only use node slugs from the list. Keep each 'why' under 18 words, plain language.",
      },
      {
        role: "user",
        content: `${buildSummary}\n\nCurrent needs: ${JSON.stringify(need)}\n\nTREES:\n${lines}`,
      },
    ],
    { jsonSchema: { name: "warplan", schema }, maxTokens: 1200, timeoutMs: 60000 },
  );
}
