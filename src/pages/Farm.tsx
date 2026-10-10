import { useState } from "react";
import { Badge, Card, Empty, PageHead } from "../components/ui";
import { useRuntime } from "../lib/engine";
import { bossRoute, farmContext, knowledge, planFarm } from "../lib/farm";
import { chatStream } from "../lib/llm";
import { emptyProgress, useActiveVariant, useBuilds, useSettings } from "../lib/store";

export default function Farm() {
  const { build, variant } = useActiveVariant();
  const progress = useBuilds((s) => s.progress);
  const llm = useSettings((s) => s.settings.llm);
  const events = useRuntime((s) => s.events);
  const [minutes, setMinutes] = useState(60);
  const [plan, setPlan] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const prog = (slot: string) => (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
  const steps = planFarm(variant, prog);
  const route = bossRoute(steps);

  const makePlan = async () => {
    setBusy(true);
    setPlan("");
    setErr("");
    try {
      const ctx = farmContext(variant, prog, events);
      await chatStream(
        llm,
        [
          {
            role: "system",
            content:
              "You are a concise Diablo IV (Season 15) farming planner. Use ONLY the facts provided; if a source is unknown say so rather than inventing drop locations. Output a numbered, time-boxed session plan with short bullet reasons. Mention upcoming world events if they fit the window.",
          },
          {
            role: "user",
            content: `Build: ${build?.name} — ${variant?.name} (${build?.className}).\nI have ${minutes} minutes to play right now.\n\n${ctx}\n\nPlan my session.`,
          },
        ],
        (t, kind) => kind === "content" && setPlan((p) => p + t),
        { maxTokens: 1400, temperature: 0.4 },
      );
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  if (!variant) return <Empty icon="🗺">Import a build first.</Empty>;

  return (
    <>
      <PageHead title="Farm Planner" sub="What to chase next for your build, where it drops, and a session plan from your local LLM." />
      <div className="grid g2">
        <Card title="Session plan (AI)">
          <div className="row">
            <label className="field">
              Minutes available
              <input type="number" min={10} max={600} value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} style={{ width: 110 }} />
            </label>
            <button className="btn primary" style={{ alignSelf: "flex-end" }} disabled={busy} onClick={makePlan}>
              {busy ? <span className="loader" /> : "🕯"} Plan my session
            </button>
          </div>
          {err && <div className="err" style={{ marginTop: 10 }}>{err}</div>}
          {plan && <div className="pre" style={{ marginTop: 12 }}>{plan}</div>}
          {!plan && !busy && <div className="muted small" style={{ marginTop: 10 }}>Uses your missing gear, drop sources and the live event schedule.</div>}
        </Card>
        <Card title="Boss route">
          {route.length ? (
            <div className="col">
              {route.map((r) => (
                <div key={r.boss} className="event" style={{ color: "var(--blood2)", alignItems: "flex-start" }}>
                  <span className="ico">☠</span>
                  <div style={{ color: "var(--text)" }} className="grow">
                    <div style={{ fontWeight: 700 }}>{r.boss}</div>
                    <div className="small">
                      {r.items.map((i) => (
                        <span key={i.slot} className={"tag rar-" + i.kind}>
                          {i.item}
                        </span>
                      ))}
                    </div>
                    {r.info?.summonMaterials?.length > 0 && (
                      <div className="small muted">Summon: {r.info.summonMaterials.join(", ")}</div>
                    )}
                    {r.info?.materialSources?.length > 0 && <div className="small dim">Mats from: {r.info.materialSources.join("; ")}</div>}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon="☠">No missing boss drops. Nice.</Empty>
          )}
        </Card>
      </div>

      <Card title="Targets" style={{ marginTop: 14 }}>
        <table className="table">
          <thead>
            <tr>
              <th>Slot</th>
              <th>Item</th>
              <th>Status</th>
              <th>Where / how</th>
              <th>Roll targets</th>
            </tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.slot}>
                <td className="nowrap">{s.slotLabel}</td>
                <td>
                  <div className={"rar-" + s.kind} style={{ fontWeight: 700 }}>
                    {s.item}
                  </div>
                  <div className="small muted">{s.why}</div>
                </td>
                <td>
                  <span className={"state-" + s.state}>{s.state}</span>
                </td>
                <td className="small">
                  {s.obtain.length ? (
                    s.obtain.map((o, i) => (
                      <div key={i}>
                        <Badge color="var(--gold)">{o.method}</Badge> {o.detail}
                        {o.verified === false && <span className="dim"> (unverified)</span>}
                      </div>
                    ))
                  ) : (
                    <span className="dim">unknown — ask the Coach</span>
                  )}
                </td>
                <td className="small">
                  {s.gaTargets.length > 0 && <div>★ {s.gaTargets.join(", ")}</div>}
                  {s.masterworkInto && <div style={{ color: "var(--blue)" }}>MW → {s.masterworkInto}</div>}
                  {s.temper.length > 0 && <div style={{ color: "var(--orange)" }}>⚒ {s.temper.join(", ")}</div>}
                  {s.sockets.length > 0 && <div style={{ color: "var(--purple)" }}>⬢ {s.sockets.join(", ")}</div>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </Card>

      {knowledge?.progression?.length > 0 && (
        <Card title="Season progression" style={{ marginTop: 14 }}>
          <ol style={{ margin: 0, paddingLeft: 20 }}>
            {knowledge.progression.map((p: any, i: number) => (
              <li key={i} style={{ marginBottom: 6 }}>
                <b>{p.step}</b> — {p.goal} <span className="muted">({p.activity})</span>
                {p.notes && <div className="small muted">{p.notes}</div>}
              </li>
            ))}
          </ol>
        </Card>
      )}
      {knowledge?.activities?.length > 0 && (
        <Card title="Activities" style={{ marginTop: 14 }}>
          <div className="grid g2">
            {knowledge.activities.map((a: any) => (
              <div key={a.name}>
                <h3>{a.name}</h3>
                <div className="small">{a.whatItRewards}</div>
                {a.tips && <div className="small muted">{a.tips}</div>}
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
