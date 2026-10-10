import { EventRow, NextEvents } from "../components/EventList";
import { Card, Check, PageHead, timeAgo, useNow } from "../components/ui";
import { useRuntime } from "../lib/engine";
import { useSettings } from "../lib/store";
import { EVENT_META } from "../lib/timers";
import type { EventKind } from "../lib/types";

export default function Timers() {
  const events = useRuntime((s) => s.events);
  const live = useRuntime((s) => s.live);
  const { settings, update } = useSettings();
  const now = useNow(1000);
  const upcoming = events.filter((e) => (e.end ?? e.start) > now);

  return (
    <>
      <PageHead
        title="World Events"
        sub={
          <>
            Times are computed locally (they're deterministic); boss names & zones are live from{" "}
            <a href="https://helltides.com" target="_blank" rel="noreferrer">
              helltides.com
            </a>
            . {live && <span className="dim">Synced {timeAgo(live.fetchedAt)}.</span>}
          </>
        }
      />
      {live?.error && <div className="note" style={{ marginBottom: 12 }}>Live data partially unavailable: {live.error}</div>}
      <div className="grid g2">
        <Card title="Up next">
          <NextEvents events={events} />
        </Card>
        <Card title="Alerts">
          <div className="col">
            {(Object.keys(EVENT_META) as EventKind[])
              .filter((k) => k !== "other")
              .map((k) => (
                <div className="row" key={k}>
                  <Check
                    checked={settings.alerts.enabled[k]}
                    onChange={(v) => update((s) => void (s.alerts.enabled[k] = v))}
                    label={`${EVENT_META[k].icon} ${EVENT_META[k].label}`}
                  />
                  <span className="right">
                    <Check
                      checked={settings.alerts.discordKinds[k]}
                      onChange={(v) => update((s) => void (s.alerts.discordKinds[k] = v))}
                      label={<span className="small muted">Discord</span>}
                    />
                  </span>
                </div>
              ))}
            <label className="field">
              Alert lead times (minutes, comma separated)
              <input
                type="text"
                defaultValue={settings.alerts.leadMinutes.join(", ")}
                onBlur={(e) =>
                  update((s) => {
                    s.alerts.leadMinutes = e.target.value
                      .split(",")
                      .map((x) => Number(x.trim()))
                      .filter((x) => x > 0 && x < 240);
                  })
                }
              />
            </label>
            <div className="row">
              <Check checked={settings.alerts.sound} onChange={(v) => update((s) => void (s.alerts.sound = v))} label="Sound" />
              <Check checked={settings.alerts.toast} onChange={(v) => update((s) => void (s.alerts.toast = v))} label="Windows toast" />
              <span className="small muted">+ overlay toast always</span>
            </div>
          </div>
        </Card>
      </div>
      <Card title="Schedule (next 12h)" style={{ marginTop: 14 }}>
        <div className="grid g3">
          {(["worldBoss", "helltide", "legion"] as EventKind[]).map((k) => (
            <div key={k} className="col">
              <h3 style={{ color: EVENT_META[k].color }}>
                {EVENT_META[k].icon} {EVENT_META[k].label}
              </h3>
              {upcoming
                .filter((e) => e.kind === k)
                .slice(0, k === "legion" ? 14 : 8)
                .map((e) => (
                  <EventRow key={e.start} e={e} now={now} />
                ))}
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}
