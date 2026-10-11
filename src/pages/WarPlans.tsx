import { useMemo, useState } from "react";
import { WandSparkles } from "lucide-react";
import { Card, PageHead } from "../components/ui";
import { useCharacter } from "../lib/charmap";
import { useActiveVariant, useBuilds, useSettings, emptyProgress } from "../lib/store";
import { bestTrees, llmPlan, needs, nodes, planTree, scoreNode, trees, useWarPlans } from "../lib/warplans";

export default function WarPlans() {
  const { build, variant } = useActiveVariant();
  const progress = useBuilds((s) => s.progress);
  const glyphs = useCharacter((s) => s.glyphs);
  const { owned, toggle, progress: wp } = useWarPlans();
  const llm = useSettings((s) => s.settings.llm);
  const [tab, setTab] = useState(trees()[0]?.slug ?? "lair-bosses");
  const [ai, setAi] = useState<{ picks: { tree: string; node: string; why: string }[]; summary: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const prog = (slot: string) => (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
  const glyphGap = Math.max(0, ...(variant?.paragon ?? []).map((p) => p.glyphLevel - (glyphs[p.glyphSlug]?.level ?? 0)));
  const need = needs(variant, prog, glyphGap);
  const ownedSet = useMemo(() => new Set(Object.entries(owned).filter(([, v]) => v).map(([k]) => k)), [owned]);
  const ranking = bestTrees(need, ownedSet);
  const tree = trees().find((t) => t.slug === tab);
  const treeNodes = nodes(tab);
  const ownedHere = treeNodes.filter((n) => ownedSet.has(n.slug)).length;
  const plan = planTree(tab, need, ownedSet, Math.max(0, (tree?.max ?? 7) - ownedHere));
  const planned = new Set(plan.map((p) => p.node.slug));

  // lay the tree out from the node coordinates
  const xs = treeNodes.map((n) => n.x),
    ys = treeNodes.map((n) => n.y);
  const minX = Math.min(...xs),
    maxX = Math.max(...xs),
    minY = Math.min(...ys),
    maxY = Math.max(...ys);
  const W = 900,
    H = 520;
  const px = (x: number) => 70 + ((x - minX) / Math.max(1, maxX - minX)) * (W - 140);
  const py = (y: number) => 30 + ((y - minY) / Math.max(1, maxY - minY)) * (H - 60);

  const askAi = async () => {
    setBusy(true);
    setErr("");
    try {
      const summary = `Build: ${build?.name} (${build?.className}), ${variant?.name}. Missing: ${(variant?.gear ?? []).filter((g) => prog(g.slot).state === "missing").map((g) => g.itemName).join(", ")}.`;
      setAi(await llmPlan(llm, summary, need, ownedSet));
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="War Plans" sub="7 activity trees × 7 points. Recommendations follow what you're farming right now; tick the nodes you've already unlocked.">
        <button className="btn primary" disabled={busy} onClick={askAi}>
          {busy ? <span className="loader" /> : <WandSparkles size={15} strokeWidth={1.75} aria-hidden />} Plan my points (AI)
        </button>
      </PageHead>

      <div className="grid g3">
        <Card title="Current War Plan">
          {wp ? (
            <>
              <div style={{ fontSize: 26, fontWeight: 800, fontFamily: "var(--display)" }}>
                {wp.step}/{wp.of}
              </div>
              <div className="muted">{wp.quest || "—"}</div>
              <div className="small dim">read from your quest tracker</div>
            </>
          ) : (
            <div className="muted small">Not seen yet: it's read from "War Plan: x/5" in your quest tracker.</div>
          )}
        </Card>
        <Card title="Next point goes into…">
          {ranking.slice(0, 3).map((r, i) => (
            <div key={r.tree.slug} style={{ marginBottom: 6 }}>
              <b style={{ color: i === 0 ? "var(--green)" : undefined }}>
                {i + 1}. {r.tree.name}
              </b>
              {r.next && (
                <div className="small muted">
                  {r.next.node.name}
                  {r.next.why.length ? `: ${r.next.why.join(", ")}` : ""}
                </div>
              )}
            </div>
          ))}
        </Card>
        <Card title="What it's planning for">
          <div className="small col" style={{ gap: 2 }}>
            <div>Missing build uniques: <b>{need.missingUniques}</b></div>
            <div>Missing talisman pieces: <b>{need.charms}</b></div>
            <div>Slots not maxed (masterwork): <b>{need.mw}</b></div>
            <div>Glyph levels to go (biggest gap): <b>{glyphGap || "map your glyphs first"}</b></div>
            <div className="dim" style={{ marginTop: 4 }}>
              Splinters: carry Terror for Helltide/Hordes, Destruction for Undercity/Lairs, Hatred for Nightmare Dungeons/Pit.
            </div>
          </div>
        </Card>
      </div>

      {err && <div className="err" style={{ marginTop: 12 }}>{err}</div>}
      {ai && (
        <Card title="AI plan" style={{ marginTop: 14 }}>
          <div className="muted" style={{ marginBottom: 6 }}>{ai.summary}</div>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {ai.picks.map((p, i) => {
              const n = nodes().find((x) => x.slug === p.node);
              return (
                <li key={i}>
                  <b>{n?.name ?? p.node}</b> <span className="dim small">({trees().find((t) => t.slug === p.tree)?.name ?? p.tree})</span>: {p.why}
                </li>
              );
            })}
          </ol>
        </Card>
      )}

      <div className="tabs" style={{ marginTop: 16 }}>
        {trees().map((t) => (
          <button key={t.slug} className={"tab " + (tab === t.slug ? "on" : "")} onClick={() => setTab(t.slug)}>
            {t.name} <span className="dim small">{nodes(t.slug).filter((n) => ownedSet.has(n.slug)).length}/{t.max}</span>
          </button>
        ))}
      </div>
      <Card title={`${tree?.name}: ${ownedHere}/${tree?.max} points`} right={<span className="small muted">click a node to mark it unlocked · green = recommended path</span>}>
        <svg width="100%" viewBox={`0 0 ${W} ${H}`} style={{ background: "#0d0a08", borderRadius: 8 }}>
          {treeNodes.flatMap((n) =>
            n.depends.map((d) => {
              const p = treeNodes.find((m) => m.slug === d);
              return p ? <line key={n.slug + d} x1={px(p.x)} y1={py(p.y)} x2={px(n.x)} y2={py(n.y)} stroke="#3a2c22" strokeWidth={2} /> : null;
            }),
          )}
          {treeNodes.map((n) => {
            const own = ownedSet.has(n.slug);
            const rec = planned.has(n.slug);
            const sc = scoreNode(n, need);
            return (
              <g key={n.slug} onClick={() => toggle(n.slug)} style={{ cursor: "pointer" }}>
                <title>{`${n.name}\n${n.desc.replace(/\*\*/g, "")}${sc.why.length ? `\n\nGood for: ${sc.why.join(", ")}` : ""}`}</title>
                <circle cx={px(n.x)} cy={py(n.y)} r={own ? 15 : 12} fill={own ? "#d4ad62" : rec ? "#1f3d2a" : "#1e1813"} stroke={rec ? "#5fd18a" : own ? "#f3c35b" : "#54402f"} strokeWidth={rec ? 3 : 2} />
                <text x={px(n.x)} y={py(n.y) + 28} textAnchor="middle" fontSize={11} fill={own ? "#f3c35b" : rec ? "#5fd18a" : "#9d8f7c"}>
                  {n.name}
                </text>
              </g>
            );
          })}
        </svg>
        <div className="grid g2" style={{ marginTop: 10 }}>
          {plan.map((p, i) => (
            <div key={p.node.slug} className="small">
              <b style={{ color: "var(--green)" }}>
                {i + 1}. {p.node.name}
              </b>{" "}
              <span className="muted">{p.node.desc.replace(/\*\*/g, "").slice(0, 140)}</span>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
