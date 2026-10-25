import type { CSSProperties } from "react";
import { EVENT_META, eventLabel, fmtCountdown, isActive } from "../lib/timers";
import { useProfiles } from "../lib/store";
import { claimedIn, useWeeklyBonus } from "../lib/weeklybonus";
import type { GameEvent } from "../lib/types";
import { useNow } from "./ui";

/** The event kind's Lucide icon, inline with text; colour comes from the parent (or `style`). */
export function EventIcon({ kind, size = 16, style }: { kind: GameEvent["kind"]; size?: number; style?: CSSProperties }) {
  const Icon = EVENT_META[kind].icon;
  return <Icon className="i" size={size} strokeWidth={1.75} style={style} aria-hidden />;
}

/**
 * The world boss's weekly bonus for the character you play: one bonus cache per boss per week. Only
 * what the app has read off your screen counts as claimed, so it never says a bonus is gone when it
 * isn't. Nothing is shown when the slot could be either of two bosses and their state differs.
 */
function WeeklyBonus({ e, now }: { e: GameEvent; now: number }) {
  const claimed = useWeeklyBonus((s) => s.claimed);
  const profile = useProfiles((s) => s.activeId);
  const bosses = [e.name, typeof e.extra?.maybe === "string" ? e.extra.maybe : null].filter(Boolean) as string[];
  const states = bosses.map((b) => claimedIn(claimed, profile, b, now));
  if (!states.length || states.some((x) => x !== states[0])) return null;
  return (
    <div className="small" style={{ color: states[0] ? "var(--dim)" : "var(--gold)" }} title="The app counts a bonus as claimed once it has seen it on your screen.">
      Weekly bonus: {states[0] ? "claimed" : "not claimed yet"}
    </div>
  );
}

export function EventRow({ e, now }: { e: GameEvent; now: number }) {
  const meta = EVENT_META[e.kind];
  const active = isActive(e, now);
  return (
    <div className={"event " + (active ? "active" : "")} style={{ color: meta.color }}>
      <span className="ico">
        <EventIcon kind={e.kind} size={22} />
      </span>
      <div style={{ color: "var(--text)", minWidth: 0 }}>
        <div style={{ fontWeight: 700 }}>
          {eventLabel(e)}
          {e.extra?.predicted ? <span className="dim small"> (predicted)</span> : null}
          {e.extra?.whisper ? <span className="small" style={{ color: "var(--purple)" }}> · counts as a Whisper</span> : null}
        </div>
        <div className="muted small">
          {e.zone ?? meta.label} · {new Date(e.start).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}
        </div>
        {e.kind === "worldBoss" && <WeeklyBonus e={e} now={now} />}
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
