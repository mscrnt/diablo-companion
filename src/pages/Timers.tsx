import { EventIcon, EventRow, NextEvents } from "../components/EventList";
import { Card, Check, PageHead, useNow } from "../components/ui";
import { useRuntime } from "../lib/engine";
import { useSettings } from "../lib/store";
import { EVENT_META } from "../lib/timers";
import type { EventKind } from "../lib/types";

export default function Timers() {
  const events = useRuntime((s) => s.events);
  const { settings, update } = useSettings();
  const now = useNow(1000);
  const upcoming = events.filter((e) => (e.end ?? e.start) > now);

  return (
    <>
      <PageHead
        title="World Events"
        sub="Times are computed by the app, so they work offline. Boss names and zones show once the game has shown them to you (the map or the quest tracker). Each world boss pays one bonus cache a week, per character: the row says whether the app has seen you claim it."
      />
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
                    label={
                      <span>
                        <EventIcon kind={k} size={15} style={{ color: EVENT_META[k].color }} /> {EVENT_META[k].label}
                      </span>
                    }
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
            <Check
              checked={settings.alerts.onlyWhileGameRuns}
              onChange={(v) => update((s) => void (s.alerts.onlyWhileGameRuns = v))}
              label="Only alert while Diablo IV is running"
            />
          </div>
        </Card>
      </div>
      <Card title="Schedule (next 12h)" style={{ marginTop: 14 }}>
        <div className="grid g3">
          {(["worldBoss", "helltide", "legion"] as EventKind[]).map((k) => (
            <div key={k} className="col">
              <h3 style={{ color: EVENT_META[k].color }}>
                <EventIcon kind={k} size={16} /> {EVENT_META[k].label}
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
