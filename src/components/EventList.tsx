import { EVENT_META, fmtCountdown, isActive } from "../lib/timers";
import type { GameEvent } from "../lib/types";
import { useNow } from "./ui";

export function EventRow({ e, now }: { e: GameEvent; now: number }) {
  const meta = EVENT_META[e.kind];
  const active = isActive(e, now);
  return (
    <div className={"event " + (active ? "active" : "")} style={{ color: meta.color }}>
      <span className="ico">{meta.icon}</span>
      <div style={{ color: "var(--text)", minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {e.name}
          {e.extra?.predicted ? <span className="dim small"> (predicted)</span> : null}
          {e.extra?.whisper ? <span className="small" style={{ color: "var(--purple)" }}> · counts as a Whisper</span> : null}
        </div>
        <div className="muted small">
          {e.zone ?? meta.label} · {new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
      </div>
      <div className="t" style={{ color: active ? meta.color : "var(--text)" }}>
        {active ? (
          <>
            <div className="small" style={{ fontWeight: 600 }}>
              ACTIVE
            </div>
            {e.end && <div className="small muted">ends {fmtCountdown(e.end - now)}</div>}
          </>
        ) : (
          fmtCountdown(e.start - now)
        )}
      </div>
    </div>
  );
}

export function NextEvents({ events, kinds = ["worldBoss", "helltide", "legion"] }: { events: GameEvent[]; kinds?: GameEvent["kind"][] }) {
  const now = useNow(1000);
  const list = kinds
    .map((k) => events.find((e) => e.kind === k && (e.end ?? e.start) > now))
    .filter(Boolean) as GameEvent[];
  return (
    <div className="col">
      {list.map((e) => (
        <EventRow key={e.kind + e.start} e={e} now={now} />
      ))}
    </div>
  );
}
