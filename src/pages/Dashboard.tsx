import { Play, Scale, ScrollText, Square, Trophy } from "lucide-react";
import type { PageId } from "../App";
import { NextEvents } from "../components/EventList";
import { Badge, Card, Empty, PageHead, Progress, fmtDur, timeAgo, useNow } from "../components/ui";
import { runAction, useRuntime } from "../lib/engine";
import { planFarm } from "../lib/farm";
import { VERDICT_STYLE } from "../lib/judge";
import { emptyProgress, useActiveVariant, useBuilds, useLoot, useRuns, useSettings } from "../lib/store";

export default function Dashboard({ go }: { go: (p: PageId) => void }) {
  const events = useRuntime((s) => s.events);
  const judging = useRuntime((s) => s.judging);
  const { build, variant } = useActiveVariant();
  const progress = useBuilds((s) => s.progress);
  const loot = useLoot((s) => s.history);
  const runs = useRuns();
  const hotkeys = useSettings((s) => s.settings.hotkeys);
  const now = useNow(1000);

  const prog = (slot: string) => (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
  const gear = variant?.gear.filter((g) => g.group !== "chaos") ?? [];
  const done = gear.filter((g) => prog(g.slot).state !== "missing").length;
  const perfect = gear.filter((g) => prog(g.slot).state === "perfect").length;
  const steps = planFarm(variant, prog).slice(0, 4);
  const today = runs.runs.filter((r) => r.start > now - 86400_000);
  const timeToday = today.reduce((a, r) => a + ((r.end ?? now) - r.start), 0);

  return (
    <>
      <PageHead title="Sanctuary" sub={build ? `${build.name}, ${variant?.name} · ${build.season}` : "Import a build to begin"}>
        <button className="btn primary" disabled={judging} onClick={() => runAction("judge")}>
          {judging ? <span className="loader" /> : <Scale size={15} strokeWidth={1.75} aria-hidden />} Judge item under cursor <span className="kbd">{hotkeys.judge}</span>
        </button>
      </PageHead>

      <div className="grid g3">
        <Card title="Next world events" right={<button className="btn ghost sm" onClick={() => go("timers")}>All →</button>}>
          <NextEvents events={events} />
        </Card>

        <Card title="Build progress" right={<button className="btn ghost sm" onClick={() => go("build")}>Gear →</button>}>
          {variant ? (
            <div className="col">
              <div className="row">
                <div style={{ fontSize: 30, fontWeight: 800, fontFamily: "var(--display)" }}>
                  {done}/{gear.length}
                </div>
                <div className="muted">
                  pieces owned
                  <br />
                  <span className="state-perfect">{perfect} perfected</span>
                </div>
              </div>
              <Progress value={gear.length ? done / gear.length : 0} />
              <div className="row small muted" style={{ gap: 6 }}>
                {gear
                  .filter((g) => g.group === "gear")
                  .map((g) => (
                    <span key={g.slot} className={"tag state-" + prog(g.slot).state} title={`${g.itemName}: ${prog(g.slot).state}`}>
                      {g.slotLabel}
                    </span>
                  ))}
              </div>
            </div>
          ) : (
            <Empty icon={ScrollText}>No build yet.</Empty>
          )}
        </Card>

        <Card title="Today" right={<button className="btn ghost sm" onClick={() => go("runs")}>Runs →</button>}>
          <div className="grid g2">
            <div>
              <div className="muted small">Runs</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{today.length}</div>
            </div>
            <div>
              <div className="muted small">Time in runs</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{fmtDur(timeToday)}</div>
            </div>
            <div>
              <div className="muted small">Items judged (1h)</div>
              <div style={{ fontSize: 24, fontWeight: 800 }}>{loot.filter((l) => now - l.at < 3600_000).length}</div>
            </div>
            <div>
              <div className="muted small">Active run</div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{runs.active ? `${runs.active.activity} · ${fmtDur(now - runs.active.start)}` : "—"}</div>
            </div>
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <button className="btn sm" onClick={() => runAction("runToggle")}>
              {runs.active ? <><Square size={12} strokeWidth={2} fill="currentColor" aria-hidden /> Stop run</> : <><Play size={12} strokeWidth={2} fill="currentColor" aria-hidden /> Start run</>} <span className="kbd">{hotkeys.runToggle}</span>
            </button>
            {runs.active && (
              <button className="btn sm" onClick={() => runAction("runSplit")}>
                Split <span className="kbd">{hotkeys.runSplit}</span>
              </button>
            )}
          </div>
        </Card>
      </div>

      <div className="grid g2" style={{ marginTop: 14 }}>
        <Card title="Farm next" right={<button className="btn ghost sm" onClick={() => go("farm")}>Planner →</button>}>
          {steps.length ? (
            <div className="col">
              {steps.map((s) => (
                <div key={s.slot} className="row" style={{ alignItems: "flex-start" }}>
                  <span className={"tag state-" + s.state}>{s.slotLabel}</span>
                  <div className="grow">
                    <div className={"rar-" + s.kind} style={{ fontWeight: 700 }}>
                      {s.item}
                    </div>
                    <div className="small muted">{s.obtain[0]?.detail ?? s.why}</div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={Trophy}>Everything perfected. Go push the Tower!</Empty>
          )}
        </Card>

        <Card title="Recent loot verdicts" right={<button className="btn ghost sm" onClick={() => go("loot")}>History →</button>}>
          {loot.length ? (
            <div className="col">
              {loot.slice(0, 5).map((l) => (
                <div key={l.id} className="row">
                  <Badge color={(VERDICT_STYLE[l.verdict] ?? VERDICT_STYLE.UNKNOWN).color} icon={(VERDICT_STYLE[l.verdict] ?? VERDICT_STYLE.UNKNOWN).icon}>
                    {(VERDICT_STYLE[l.verdict] ?? VERDICT_STYLE.UNKNOWN).label}
                  </Badge>
                  <span className="grow" style={{ fontWeight: 600 }}>
                    {l.item.name}
                  </span>
                  <span className="dim small">{timeAgo(l.at)}</span>
                </div>
              ))}
            </div>
          ) : (
            <Empty icon={Scale}>
              Hover an item in game and press <span className="kbd">{hotkeys.judge}</span>
            </Empty>
          )}
        </Card>
      </div>
    </>
  );
}
