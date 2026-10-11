// Farming planner: what to chase next for the active build and where it drops.
// Sources: build priority list + your slot progress + unique drop sources
// (Mobalytics static data) + research/s15-knowledge.json (if present).
import { lookup, normName, similarity, table } from "./names";
import type { BuildVariant, GameEvent, GearSlot, SlotProgress } from "./types";

const knowledgeFiles = import.meta.glob("../../research/s15-knowledge.json", { import: "default", eager: true }) as Record<string, any>;
export const knowledge: any = Object.values(knowledgeFiles)[0] ?? null;

export interface ObtainMethod {
  method: string;
  detail: string;
  boss?: string | null;
  materials?: string[];
  verified?: boolean;
  source?: string;
}

export interface FarmStep {
  slot: string;
  slotLabel: string;
  item: string;
  kind: GearSlot["kind"];
  state: SlotProgress["state"];
  priority: number;
  why: string;
  obtain: ObtainMethod[];
  gaTargets: string[];
  masterworkInto?: string;
  temper: string[];
  sockets: string[];
}

function knowledgeFor(name: string): ObtainMethod[] {
  if (!knowledge?.items) return [];
  const n = normName(name).replace(/\baspect\b/g, "").trim();
  const norm = (x: string) => normName(x).replace(/\baspect\b/g, "").replace(/\(.*\)/, "").trim();
  const hit =
    knowledge.items.find((i: any) => norm(i.name ?? "") === n || (i.slug && norm(i.slug.replace(/-/g, " ")) === n)) ??
    knowledge.items.find((i: any) => similarity(i.name ?? "", name) > 0.85);
  return (hit?.obtain ?? [])
    // drop notes that explicitly say they no longer apply this season
    .filter((o: any) => !/not in (their|its|the) s1[5-9]|no longer (drops|obtainable)/i.test(o.detail ?? ""))
    .map((o: any) => ({
    method: o.method,
    detail: o.detail,
    boss: o.bossName,
    materials: o.materials,
    verified: o.verified,
    source: o.source,
  }));
}

export interface CubeHint {
  recipe: string;
  /** base item type the cube needs, e.g. "2h Scythe" */
  baseType: string;
  /** every unique that recipe can roll for your class (the target is one of them) */
  pool: string[];
}

/**
 * Horadric Cube "white item → random unique of that type". Only worth suggesting
 * when the pool is small (e.g. 2H scythes for Necromancer), so we check the
 * real unique tables instead of trusting "guaranteed" claims in guides.
 */
export function cubeHint(g: GearSlot): CubeHint | undefined {
  const recipe = knowledgeFor(g.itemName).find((o) => o.method === "cube" && /white|common/i.test(o.detail) && /unique/i.test(o.detail))?.detail;
  if (!recipe) return undefined;
  const me = lookup(g.itemSlug, "uniques");
  if (!me?.t) return undefined;
  const pool = Object.values(table("uniques"))
    .filter((u) => u.t === me.t && !u.x && (!u.c || u.c === me.c))
    .map((u) => u.n);
  if (pool.length > 6) return undefined; // too random to be worth it
  return { recipe, baseType: me.t, pool };
}

export function bossInfo(name: string) {
  if (!knowledge?.bosses || !name) return undefined;
  const n = normName(name);
  return knowledge.bosses.find((b: any) => {
    const bn = normName(b.name ?? "");
    return bn && (bn.includes(n) || n.includes(bn.split(" ")[0]));
  });
}

function obtainFor(g: GearSlot): ObtainMethod[] {
  const out = knowledgeFor(g.itemName);
  if (g.kind === "unique" || g.kind === "mythic") {
    const src = lookup(g.itemSlug, "uniques")?.src;
    if (src && !out.some((o) => o.boss && normName(o.boss) === normName(src)))
      out.push({ method: "boss", detail: `Target-farm drop from ${src}`, boss: src, source: "Mobalytics static data" });
  }
  if (g.kind === "aspect") {
    const a = lookup(g.itemSlug, "aspects");
    if (a?.loc) out.push({ method: "codex", detail: `Codex of Power: ${a.loc}`, source: "Mobalytics static data" });
    if (!out.length)
      out.push({
        method: "drop",
        detail: "Random legendary drop: salvage it at the Blacksmith to save the power to your Codex, then imprint at the Occultist.",
      });
  }
  return out;
}

export function planFarm(variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress): FarmStep[] {
  if (!variant) return [];
  const prioIndex = (g: GearSlot) => {
    const i = variant.priority.indexOf(g.itemSlug);
    return i < 0 ? 50 : i;
  };
  const steps: FarmStep[] = [];
  for (const g of variant.gear) {
    if (g.group === "chaos") continue;
    const p = prog(g.slot);
    if (p.state === "perfect") continue;
    const ga = g.affixes.filter((a) => a.greater).map((a) => a.name);
    const gaMissing = ga.filter((n) => !p.greater.some((x) => normName(x) === normName(n)));
    let why: string;
    let priority = prioIndex(g);
    if (p.state === "missing") {
      why = g.kind === "unique" || g.kind === "mythic" ? "Core unique for the build: big power spike." : g.kind === "aspect" ? "Aspect needed in your Codex." : "Needed for the full setup.";
    } else {
      why = gaMissing.length ? `Upgrade: still want Greater ${gaMissing.join(", ")}.` : "Polish: temper & masterwork.";
      priority += 100; // owned items come after missing ones
    }
    if (g.kind === "mythic") priority -= 5;
    steps.push({
      slot: g.slot,
      slotLabel: g.slotLabel,
      item: g.itemName,
      kind: g.kind,
      state: p.state,
      priority,
      why,
      obtain: obtainFor(g),
      gaTargets: ga,
      masterworkInto: g.affixes.find((a) => a.masterwork)?.name,
      temper: g.tempers.map((t) => t.name),
      sockets: g.sockets.map((s) => s.name),
    });
  }
  return steps.sort((a, b) => a.priority - b.priority);
}

/** Group missing boss drops so you can farm several items from one boss. */
export function bossRoute(steps: FarmStep[]) {
  // canonical key: "Grigoire, The Galvanic Saint" and "Grigoire" are the same boss
  const canon = (b: string) => normName(b.split(",")[0]).split(" ")[0];
  const byBoss = new Map<string, { boss: string; items: FarmStep[] }>();
  for (const s of steps) {
    if (s.state !== "missing") continue;
    for (const o of s.obtain) {
      if (!o.boss) continue;
      const k = canon(o.boss);
      const e = byBoss.get(k) ?? { boss: o.boss, items: [] };
      if (o.boss.length > e.boss.length) e.boss = o.boss; // keep the fuller name
      if (!e.items.includes(s)) e.items.push(s);
      byBoss.set(k, e);
    }
  }
  return [...byBoss.values()]
    .map(({ boss, items }) => ({ boss, items, info: bossInfo(boss) }))
    .sort((a, b) => b.items.length - a.items.length);
}

/** Context block for the LLM coach / session planner. */
export function farmContext(variant: BuildVariant | undefined, prog: (slot: string) => SlotProgress, events: GameEvent[]) {
  const steps = planFarm(variant, prog);
  const lines = steps.slice(0, 14).map(
    (s) =>
      `- ${s.slotLabel}: ${s.item} [${s.state}]: ${s.why} Sources: ${s.obtain.map((o) => o.detail).join("; ") || "unknown"}${s.gaTargets.length ? ` | GA targets: ${s.gaTargets.join(", ")}` : ""}`,
  );
  const now = Date.now();
  const ev = events
    .filter((e) => (e.end ?? e.start) > now)
    .slice(0, 8)
    .map((e) => `- ${e.name}${e.zone ? " @ " + e.zone : ""}: ${e.start <= now ? "ACTIVE now" : "in " + Math.round((e.start - now) / 60000) + " min"}`);
  const prog2 = knowledge?.progression?.map((p: any, i: number) => `${i + 1}. ${p.step}: ${p.goal} (${p.activity})`).join("\n");
  return `FARM TARGETS (highest priority first):\n${lines.join("\n")}\n\nUPCOMING EVENTS:\n${ev.join("\n")}${prog2 ? `\n\nSEASON PROGRESSION GUIDE:\n${prog2}` : ""}`;
}
