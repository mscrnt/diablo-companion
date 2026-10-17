import { useState } from "react";
import { Play, ScrollText, Skull, Square, Timer } from "lucide-react";
import { Card, Empty, PageHead, Sparkline, fmtDur, timeAgo, useNow } from "../components/ui";
import { ExportStatsButton } from "../components/ExportStats";
import { runAction } from "../lib/engine";
import { useRuns, useSettings, useWatchers } from "../lib/store";

export default function Runs() {
  const r = useRuns();
  const { settings } = useSettings();
  const deaths = useWatchers((s) => s.deaths);
  const now = useNow(250);
  const [filter, setFilter] = useState<string>("");

  const act = r.active?.activity ?? r.activity;
  const same = r.runs.filter((x) => x.activity === act && x.end && x.success !== false);
  const durs = same.map((x) => x.end! - x.start);
  const pb = durs.length ? Math.min(...durs) : null;
  const avg = durs.length ? durs.reduce((a, b) => a + b, 0) / durs.length : null;
  const list = r.runs.filter((x) => !filter || x.activity === filter);
  const elapsed = r.active ? now - r.active.start : 0;

  return (
    <>
      <PageHead title="Runs & Splits" sub="Pit runs are tracked automatically from the quest tracker (start, Guardian split, finish, deaths, tier). Hotkeys/chords work for everything else.">
        <label className="row small" style={{ gap: 6 }}>
          <input type="checkbox" checked={settings.autoRuns} onChange={(e) => useSettings.getState().update((s) => void (s.autoRuns = e.target.checked))} /> Auto-track Pit runs
        </label>
        <div className="row">
          <ExportStatsButton />
        </div>
      </PageHead>
      <div className="grid g2">
        <Card title="Current run">
          <div className="row" style={{ marginBottom: 10 }}>
            <select value={r.activity} disabled={!!r.active} onChange={(e) => r.setActivity(e.target.value)}>
              {settings.activities.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
            <input type="text" placeholder="Tier / level (e.g. T85)" value={r.tier} disabled={!!r.active} onChange={(e) => r.setActivity(r.activity, e.target.value)} style={{ width: 160 }} />
          </div>
          <div style={{ fontSize: 46, fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: "var(--display)" }}>{fmtDur(elapsed)}</div>
          <div className="row small muted">
            {pb != null && <span>PB {fmtDur(pb)}</span>}
            {avg != null && <span>· avg {fmtDur(avg)}</span>}
            {r.active && pb != null && (
              <span style={{ color: elapsed < pb ? "var(--green)" : "var(--blood2)" }}>
                · {elapsed < pb ? "-" : "+"}
                {fmtDur(Math.abs(elapsed - pb))} vs PB
              </span>
            )}
            {r.active?.deaths ? <span style={{ color: "var(--blood2)" }}>
                · <Skull className="i" size={13} strokeWidth={1.75} aria-label="deaths" /> {r.active.deaths}
              </span> : null}
          </div>
          <div className="row" style={{ marginTop: 12 }}>
            <button className="btn primary" onClick={() => runAction("runToggle")}>
              {r.active ? <><Square size={12} strokeWidth={2} fill="currentColor" aria-hidden /> Finish</> : <><Play size={12} strokeWidth={2} fill="currentColor" aria-hidden /> Start</>} <span className="kbd">{settings.hotkeys.runToggle}</span>
            </button>
            <button className="btn" disabled={!r.active} onClick={() => runAction("runSplit")}>
              Split <span className="kbd">{settings.hotkeys.runSplit}</span>
            </button>
            <button className="btn" disabled={!r.active} onClick={() => r.addDeath()} title="Add a death">
              +<Skull size={15} strokeWidth={1.75} aria-label="death" />
            </button>
            <button className="btn ghost" disabled={!r.active} onClick={() => r.stop(false)}>
              Abandon
            </button>
          </div>
          {r.active && r.active.splits.length > 0 && (
            <div className="table-wrap">
              <table className="table" style={{ marginTop: 10 }}>
                <tbody>
                  {r.active.splits.map((s, i) => (
                    <tr key={i}>
                      <td>{s.label}</td>
                      <td className="mono">{fmtDur(s.at - r.active!.start)}</td>
                      <td className="mono dim">+{fmtDur(s.at - (i ? r.active!.splits[i - 1].at : r.active!.start))}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card title={`${act} trend`}>
          {durs.length ? (
            <div className="col">
              <Sparkline values={durs.slice(0, 40).reverse().map((d) => d / 1000)} width={420} height={70} />
              <div className="small muted">Last {Math.min(40, durs.length)} clear times (seconds), oldest → newest. Lower is better.</div>
              <div className="grid g3">
                <div>
                  <div className="muted small">Runs</div>
                  <b>{same.length}</b>
                </div>
                <div>
                  <div className="muted small">Best</div>
                  <b>{fmtDur(pb!)}</b>
                </div>
                <div>
                  <div className="muted small">Runs / hour (avg pace)</div>
                  <b>{avg ? (3600_000 / avg).toFixed(1) : "—"}</b>
                </div>
              </div>
            </div>
          ) : (
            <Empty icon={Timer}>Finish a few runs to see trends.</Empty>
          )}
          <h3 style={{ marginTop: 16 }}>Recent deaths</h3>
          {deaths.length ? (
            deaths.slice(0, 6).map((d, i) => (
              <div key={i} className="small">
                <span className="dim">{timeAgo(d.at)}</span> {d.activity && <span className="tag">{d.activity}</span>} {d.text.slice(0, 90)}
              </div>
            ))
          ) : (
            <div className="small muted">Set up a "death" Screen Watcher to log deaths automatically.</div>
          )}
        </Card>
      </div>
      <Card
        title="History"
        style={{ marginTop: 14 }}
        right={
          <select value={filter} onChange={(e) => setFilter(e.target.value)}>
            <option value="">All activities</option>
            {settings.activities.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
        }
      >
        {list.length === 0 ? (
          <Empty icon={ScrollText}>No runs yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>Activity</th>
                  <th>Tier</th>
                  <th>Time</th>
                  <th>Splits</th>
                  <th>Deaths</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {list.slice(0, 200).map((x) => (
                  <tr key={x.id}>
                    <td className="small dim nowrap">{timeAgo(x.start)}</td>
                    <td>{x.activity}</td>
                    <td>{x.tier}</td>
                    <td className="mono" style={{ color: x.success === false ? "var(--dim)" : x.end! - x.start === pb ? "var(--gold2)" : undefined }}>
                      {fmtDur((x.end ?? now) - x.start)}
                      {x.success === false ? " (abandoned)" : ""}
                    </td>
                    <td className="small">{x.splits.length}</td>
                    <td className="small">{x.deaths ?? 0}</td>
                    <td>
                      <button className="btn ghost sm" onClick={() => r.remove(x.id)}>
                        ✕
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}
