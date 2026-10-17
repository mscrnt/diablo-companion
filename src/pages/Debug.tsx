// Debug page: what the app is doing and what it believes, live. The same sections as
// <app log dir>/debug/state.json, the event log (filterable), marked moments with notes, the
// overlay's render state, and the debug report.
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Bookmark, FolderOpen } from "lucide-react";
import { Card, Check, PageHead, timeAgo } from "../components/ui";
import { DebugReportButton } from "../components/DebugReport";
import { collectState, listMarks, markMoment, onDebugEvent, onMarksChanged, openDebugFolder, recentEvents, saveMarkNote, watchDebug, type MarkInfo } from "../lib/debug";
import type { DebugEvent, RenderedElement } from "../lib/debugcore";
import { useSettings } from "../lib/store";

const SECTIONS: { key: string; title: string }[] = [
  { key: "game", title: "Game window" },
  { key: "activity", title: "Activity" },
  { key: "autojudge", title: "Loot judge (auto)" },
  { key: "hordes", title: "Infernal Hordes" },
  { key: "mapPins", title: "Map pins" },
  { key: "skillBar", title: "Skill bar" },
  { key: "guide", title: "Guided flow" },
  { key: "llm", title: "LLM" },
  { key: "liveTimers", title: "Live timers" },
  { key: "runtime", title: "Runtime" },
  { key: "settings", title: "Settings summary" },
  { key: "errors", title: "Recent errors" },
];

/** A value as readable rows: primitives inline, short arrays joined, the rest as compact JSON. */
function Value({ v, depth = 0 }: { v: unknown; depth?: number }): ReactNode {
  if (v == null) return <span className="dim">—</span>;
  if (typeof v !== "object") return <span className="mono">{String(v)}</span>;
  if (Array.isArray(v)) {
    if (!v.length) return <span className="dim">none</span>;
    if (v.every((x) => typeof x !== "object")) return <span className="mono">{v.join(" · ")}</span>;
    return <pre className="small mono" style={{ margin: 0, whiteSpace: "pre-wrap" }}>{JSON.stringify(v, null, 1)}</pre>;
  }
  if (depth >= 1) return <span className="mono small">{JSON.stringify(v)}</span>;
  return (
    <table className="table small" style={{ margin: 0 }}>
      <tbody>
        {Object.entries(v as Record<string, unknown>).map(([k, x]) => (
          <tr key={k}>
            <td className="muted" style={{ whiteSpace: "nowrap", verticalAlign: "top", width: 1 }}>
              {k}
            </td>
            <td style={{ wordBreak: "break-word" }}>
              <Value v={x} depth={depth + 1} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const box = (b?: { x: number; y: number; w: number; h: number }) => (b ? `${b.w}×${b.h} @ ${b.x},${b.y}` : "—");

export default function Debug() {
  const { settings, update } = useSettings();
  const [state, setState] = useState<Record<string, any> | null>(null);
  const [events, setEvents] = useState<DebugEvent[]>(() => recentEvents().slice(-500));
  const [src, setSrc] = useState("");
  const [type, setType] = useState("");
  const [paused, setPaused] = useState(false);
  const [marks, setMarks] = useState<MarkInfo[]>([]);
  const [msg, setMsg] = useState("");
  const pending = useRef<DebugEvent[]>([]);
  const pausedRef = useRef(paused);
  pausedRef.current = paused;

  // live: the overlay reports its render state while this page is open
  useEffect(() => watchDebug(), []);

  useEffect(() => {
    let alive = true;
    const load = () => collectState().then((s) => alive && setState(s)).catch((e) => alive && setMsg(String(e)));
    load();
    const t = setInterval(load, 2000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const off = onDebugEvent((e) => void pending.current.push(e));
    const t = setInterval(() => {
      if (!pending.current.length || pausedRef.current) return;
      const add = pending.current;
      pending.current = [];
      setEvents((es) => [...es, ...add].slice(-500));
    }, 500);
    return () => {
      off();
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    const load = () => listMarks().then(setMarks).catch(() => {});
    load();
    return onMarksChanged(load);
  }, []);

  const sources = useMemo(() => [...new Set(events.map((e) => e.src))].sort(), [events]);
  const shown = events.filter((e) => (!src || e.src === src) && (!type || e.type.includes(type))).slice(-200).reverse();
  const ov = state?.overlay;

  return (
    <>
      <PageHead
        title="Debug"
        sub={
          <>
            What the app is doing and what it thinks the game looks like. Press <span className="kbd">{settings.hotkeys.markMoment || "no key"}</span>
            {settings.padChords.markMoment.length > 0 && (
              <>
                {" "}
                or <span className="kbd">{settings.padChords.markMoment.join(" + ")}</span>
              </>
            )}{" "}
            in game to mark a moment.
          </>
        }
      >
        <button className="btn sm" onClick={() => markMoment().then((n) => setMsg(n ? `Saved mark ${n}` : "Couldn't save the mark"))}>
          <Bookmark size={14} strokeWidth={1.75} aria-hidden /> Mark this moment
        </button>
        <button className="btn sm" onClick={() => openDebugFolder().catch((e) => setMsg(String(e)))}>
          <FolderOpen size={14} strokeWidth={1.75} aria-hidden /> Open debug folder
        </button>
        <DebugReportButton />
      </PageHead>
      {msg && <div className="small muted" style={{ marginBottom: 8 }}>{msg}</div>}

      <div className="grid g2">
        <Card title="Test mode" right={settings.testMode.enabled && <span className="small" style={{ color: "var(--gold)" }}>● recording</span>}>
          <div className="col">
            <Check checked={settings.testMode.enabled} onChange={(v) => update((s) => void (s.testMode.enabled = v))} label="Write the live state and the event log to disk" />
            <div className="small muted">
              While on, <span className="mono">debug\state.json</span> is rewritten every 2 seconds and every decision goes to{" "}
              <span className="mono">debug\events-&lt;date&gt;.jsonl</span>, along with the test-mode scan records. Marks work either way. Off: nothing is written, the
              last 90 seconds of events are kept in memory only.
            </div>
            <div className="small dim">
              Updated {state?.time ? timeAgo(Date.parse(state.time)) : "…"} · {state?.events?.inMemory ?? 0} events in memory · v{state?.app?.version}
            </div>
          </div>
        </Card>

        <Card title="Marked moments" right={<span className="small dim">newest 100 kept</span>}>
          {marks.length === 0 ? (
            <div className="small dim">None yet. Press the mark key in game when something looks wrong.</div>
          ) : (
            <div className="col" style={{ maxHeight: 340, overflow: "auto" }}>
              {marks.map((m) => (
                <MarkRow key={m.name} m={m} />
              ))}
            </div>
          )}
        </Card>

        <Card title="Overlay: what it draws" style={{ gridColumn: "1 / -1" }}>
          {!ov ? (
            <div className="small dim">No report from the overlay yet.</div>
          ) : (
            <div className="col">
              <div className="small">
                {ov.visible ? "Visible" : "Hidden"} · layout {ov.layout} · opacity {ov.opacity} · dpr {ov.window?.dpr} · window {box(ov.window?.css)} css · origin{" "}
                {ov.window?.origin?.join(",")} · reported {Math.round((ov.ageMs ?? 0) / 100) / 10}s ago
              </div>
              <div className="small">
                Verdict card: {ov.verdictCard ? `${ov.verdictCard.state} ${ov.verdictCard.verdict ?? ""} ${ov.verdictCard.quiet ? "(ground loot)" : ""}` : "none"} · verdict panel:{" "}
                {ov.verdictPanel ? `${ov.verdictPanel.verdict} ${ov.verdictPanel.item}` : "none"} · toasts: {ov.toasts?.length ?? 0} · map pins:{" "}
                {ov.mapPins ? `${ov.mapPins.pins} in ${box(ov.mapPins.clip)}${ov.mapPins.drawn ? "" : " (not drawn)"}` : "none"}
              </div>
              <div className="table-wrap" style={{ maxHeight: 320, overflow: "auto" }}>
                <table className="table small">
                  <thead>
                    <tr>
                      <th>Element</th>
                      <th>CSS px</th>
                      <th>Screen px</th>
                      <th>Shows</th>
                    </tr>
                  </thead>
                  <tbody>
                    {(ov.elements as RenderedElement[] | undefined)?.map((e, i) => (
                      <tr key={i}>
                        <td className="mono">{e.id}</td>
                        <td className="mono">{box(e.css)}</td>
                        <td className="mono">{box(e.screen)}</td>
                        <td>{e.children ? <span className="dim">{e.children.join(", ")}</span> : e.text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </Card>

        <Card title="Events" style={{ gridColumn: "1 / -1" }} right={<Check checked={paused} onChange={setPaused} label="Pause" />}>
          <div className="row" style={{ marginBottom: 8 }}>
            <select value={src} onChange={(e) => setSrc(e.target.value)}>
              <option value="">All sources</option>
              {sources.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </select>
            <input type="text" placeholder="Filter by type (e.g. judged, found)" value={type} onChange={(e) => setType(e.target.value)} />
            <span className="small dim">{shown.length} shown</span>
          </div>
          <div style={{ maxHeight: 380, overflow: "auto" }}>
            <table className="table small">
              <tbody>
                {shown.map((e, i) => (
                  <tr key={`${e.ts}-${i}`}>
                    <td className="mono dim" style={{ whiteSpace: "nowrap" }}>
                      {new Date(e.ts).toLocaleTimeString()}
                    </td>
                    <td className="mono">{e.src}</td>
                    <td className="mono" style={{ color: e.src === "error" ? "var(--blood2)" : undefined }}>
                      {e.type}
                    </td>
                    <td className="mono small" style={{ wordBreak: "break-word" }}>
                      {e.data === undefined ? "" : JSON.stringify(e.data)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        {SECTIONS.map(({ key, title }) => (
          <Card key={key} title={title}>
            <div style={{ maxHeight: 360, overflow: "auto" }}>{state ? <Value v={state[key]} /> : <span className="small dim">…</span>}</div>
          </Card>
        ))}
      </div>
    </>
  );
}

function MarkRow({ m }: { m: MarkInfo }) {
  const [note, setNote] = useState(m.note);
  const [saved, setSaved] = useState(true);
  return (
    <div style={{ borderBottom: "1px solid var(--line, #3a2c22)", paddingBottom: 8 }}>
      <div className="row">
        <span className="mono small">{m.name.replace("T", " ")}</span>
        <span className="small dim">{m.files.length} files</span>
        <button className="btn ghost sm right" onClick={() => openDebugFolder(`marks/${m.name}`).catch(() => {})}>
          <FolderOpen size={13} strokeWidth={1.75} aria-hidden /> Open
        </button>
      </div>
      <div className="row" style={{ marginTop: 4 }}>
        <input
          type="text"
          placeholder="Add a note: what looked wrong?"
          value={note}
          onChange={(e) => {
            setNote(e.target.value);
            setSaved(false);
          }}
          style={{ flex: 1 }}
        />
        <button className="btn sm" disabled={saved} onClick={() => saveMarkNote(m.name, note).then(() => setSaved(true))}>
          Save note
        </button>
      </div>
    </div>
  );
}
