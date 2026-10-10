import { useMemo, useState } from "react";
import { Card, PageHead, Progress } from "../components/ui";
import { table, type Category } from "../lib/names";
import { useActiveVariant, useBuilds } from "../lib/store";

const TABS: { id: Category; label: string }[] = [
  { id: "aspects", label: "Codex of Power" },
  { id: "uniques", label: "Uniques & Mythics" },
  { id: "charms", label: "Charms" },
  { id: "gems", label: "Gems" },
  { id: "runes", label: "Runes" },
];

export default function Collection() {
  const { build, variant } = useActiveVariant();
  const { owned, toggleOwned } = useBuilds();
  const [tab, setTab] = useState<Category>("aspects");
  const [q, setQ] = useState("");
  const [onlyBuild, setOnlyBuild] = useState(false);
  const cls = (build?.className ?? "").toLowerCase();

  const inBuild = useMemo(() => {
    const s = new Set<string>();
    for (const g of variant?.gear ?? []) {
      s.add(g.itemSlug);
      g.sockets.forEach((x) => s.add(x.slug));
      g.extras.forEach((e) => e.stats.forEach((x) => s.add(x.slug)));
    }
    return s;
  }, [variant]);

  const rows = useMemo(() => {
    const t = table(tab);
    return Object.entries(t)
      .filter(([, e]) => !e.x && (!e.c || e.c === cls))
      .filter(([slug, e]) => (!onlyBuild || inBuild.has(slug)) && (!q || (e.n + " " + (e.d ?? "")).toLowerCase().includes(q.toLowerCase())))
      .sort((a, b) => Number(inBuild.has(b[0])) - Number(inBuild.has(a[0])) || a[1].n.localeCompare(b[1].n));
  }, [tab, q, onlyBuild, cls, inBuild]);

  const total = rows.length;
  const have = rows.filter(([s]) => owned[s]).length;

  return (
    <>
      <PageHead title="Collection" sub={`Track your Codex, uniques and charms (${build?.className ?? "all classes"} + generic). Data: Mobalytics static data.`} />
      <div className="tabs">
        {TABS.map((t) => (
          <button key={t.id} className={"tab " + (tab === t.id ? "on" : "")} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <Card>
        <div className="row" style={{ marginBottom: 10 }}>
          <input type="text" placeholder="Search…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 260 }} />
          <label className="row small" style={{ gap: 6 }}>
            <input type="checkbox" checked={onlyBuild} onChange={(e) => setOnlyBuild(e.target.checked)} /> only items in my build
          </label>
          <div className="right row" style={{ width: 260 }}>
            <span className="small muted nowrap">
              {have}/{total}
            </span>
            <div className="grow">
              <Progress value={total ? have / total : 0} />
            </div>
          </div>
        </div>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {rows.slice(0, 400).map(([slug, e]) => (
                <tr key={slug}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" checked={!!owned[slug]} onChange={() => toggleOwned(slug)} />
                  </td>
                  <td style={{ width: 260 }}>
                    <div className={tab === "uniques" ? (e.m ? "rar-mythic" : "rar-unique") : tab === "aspects" ? "rar-aspect" : ""} style={{ fontWeight: 700 }}>
                      {e.n}
                    </div>
                    {inBuild.has(slug) && <span className="tag" style={{ color: "var(--gold)" }}>in build</span>}
                    {e.t && <span className="tag">{e.t}</span>}
                  </td>
                  <td className="small muted">
                    {e.d}
                    {e.src && <div style={{ color: "var(--blood2)" }}>Drops from: {e.src}</div>}
                    {e.loc && <div style={{ color: "var(--orange)" }}>Codex: {e.loc}</div>}
                    {e.set && <div style={{ color: "#8fd3c7" }}>Set: {e.set}</div>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {rows.length > 400 && <div className="small dim">Showing 400 of {rows.length} — refine your search.</div>}
      </Card>
    </>
  );
}
