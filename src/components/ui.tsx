import { useEffect, useRef, useState, type ReactNode } from "react";
import { onGlobal } from "../lib/bus";
import { captureMonitor, gameStatus, jpegUrl, type CaptureResult, type Rect } from "../lib/native";

export function useNow(ms = 1000) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}

export function Card(props: { title?: ReactNode; right?: ReactNode; children: ReactNode; className?: string; style?: React.CSSProperties }) {
  return (
    <section className={"card " + (props.className ?? "")} style={props.style}>
      {(props.title || props.right) && (
        <div className="card-head">
          {props.title && <h2>{props.title}</h2>}
          {props.right && <div className="right row">{props.right}</div>}
        </div>
      )}
      {props.children}
    </section>
  );
}

export function PageHead(props: { title: string; sub?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page-head">
      <div>
        <h1>{props.title}</h1>
        {props.sub && <p>{props.sub}</p>}
      </div>
      <div className="spacer" />
      {props.children}
    </div>
  );
}

export function Badge({ color, children }: { color: string; children: ReactNode }) {
  return (
    <span className="badge" style={{ color }}>
      {children}
    </span>
  );
}

export function Progress({ value }: { value: number }) {
  return (
    <div className="progress">
      <div style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
    </div>
  );
}

export function Empty({ icon, children }: { icon: string; children: ReactNode }) {
  return (
    <div className="empty">
      <div className="big">{icon}</div>
      {children}
    </div>
  );
}

export function Check(props: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <label className="row" style={{ gap: 8, cursor: "pointer", flexWrap: "nowrap" }}>
      <input type="checkbox" checked={props.checked} onChange={(e) => props.onChange(e.target.checked)} style={{ flex: "none" }} />
      <span style={{ minWidth: 0 }}>{props.label}</span>
    </label>
  );
}

export function Modal({ open, onClose, children, title }: { open: boolean; onClose: () => void; children: ReactNode; title?: string }) {
  if (!open) return null;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="row" style={{ marginBottom: 10 }}>
          <h3 style={{ margin: 0, fontFamily: "var(--display)" }}>{title}</h3>
          <button className="btn ghost sm right" onClick={onClose}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

// Tauri accelerator strings, e.g. "CommandOrControl+Shift+K", "F8"
const KEYMAP: Record<string, string> = {
  " ": "Space",
  ArrowUp: "Up",
  ArrowDown: "Down",
  ArrowLeft: "Left",
  ArrowRight: "Right",
  Escape: "Escape",
  "`": "Backquote",
};

export function KeyCapture({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [listening, setListening] = useState(false);
  return (
    <button
      className="btn sm"
      style={{ minWidth: 150, justifyContent: "center" }}
      onClick={() => setListening(true)}
      onBlur={() => setListening(false)}
      onKeyDown={(e) => {
        if (!listening) return;
        e.preventDefault();
        if (["Control", "Shift", "Alt", "Meta"].includes(e.key)) return;
        if (e.key === "Backspace" || e.key === "Delete") {
          onChange("");
          setListening(false);
          return;
        }
        const parts: string[] = [];
        if (e.ctrlKey) parts.push("CommandOrControl");
        if (e.altKey) parts.push("Alt");
        if (e.shiftKey) parts.push("Shift");
        let k = KEYMAP[e.key] ?? e.key;
        if (/^Key[A-Z]$/.test(e.code)) k = e.code.slice(3);
        else if (/^Digit\d$/.test(e.code)) k = e.code.slice(5);
        else if (k.length === 1) k = k.toUpperCase();
        parts.push(k);
        onChange(parts.join("+"));
        setListening(false);
      }}
    >
      {listening ? "press keys… (⌫ clears)" : value ? <span className="kbd">{value.replace("CommandOrControl", "Ctrl")}</span> : <span className="dim">unset</span>}
    </button>
  );
}

export function PadCapture({ value, onChange }: { value: string[]; onChange: (v: string[]) => void }) {
  const [listening, setListening] = useState(false);
  const best = useRef<string[]>([]);
  useEffect(() => {
    if (!listening) return;
    best.current = [];
    let un: (() => void) | undefined;
    let timer: ReturnType<typeof setTimeout>;
    onGlobal<{ held: string[] }>("gamepad", (ev) => {
      if (ev.held.length >= best.current.length) best.current = ev.held;
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (best.current.length) {
          onChange(best.current);
          setListening(false);
        }
      }, 700);
    }).then((u) => (un = u));
    return () => {
      un?.();
      clearTimeout(timer);
    };
  }, [listening]); // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
      <button className="btn sm" style={{ minWidth: 130, justifyContent: "center" }} onClick={() => setListening(true)}>
        {listening ? "hold the chord on your pad…" : value.length ? value.map((b) => <span key={b} className="kbd">{b}</span>) : <span className="dim">unset</span>}
      </button>
      {value.length > 0 && (
        <button className="btn ghost sm" onClick={() => onChange([])} title="Clear">
          ✕
        </button>
      )}
    </div>
  );
}

/** Full-screen capture with drag-to-select; returns an absolute screen rect. */
export function RegionPicker({ open, onClose, onPick }: { open: boolean; onClose: () => void; onPick: (r: Rect, cap: CaptureResult) => void }) {
  const [cap, setCap] = useState<CaptureResult | null>(null);
  const [err, setErr] = useState("");
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const imgRef = useRef<HTMLImageElement>(null);
  useEffect(() => {
    if (!open) return;
    setCap(null);
    setDrag(null);
    setErr("");
    // capture the monitor the game is on (falls back to the one under the cursor)
    gameStatus()
      .catch(() => null)
      .then((g) => captureMonitor(g?.rect ? [g.rect[0] + Math.floor(g.rect[2] / 2), g.rect[1] + Math.floor(g.rect[3] / 2)] : undefined, { maxEdge: 2560, quality: 80 }))
      .then(setCap)
      .catch((e) => setErr(String(e)));
  }, [open]);
  const rel = (e: React.MouseEvent) => {
    const r = imgRef.current!.getBoundingClientRect();
    return { x: Math.max(0, Math.min(r.width, e.clientX - r.left)), y: Math.max(0, Math.min(r.height, e.clientY - r.top)) };
  };
  const confirm = () => {
    if (!cap || !drag || !imgRef.current) return;
    const r = imgRef.current.getBoundingClientRect();
    const sx = cap.region.w / r.width;
    const sy = cap.region.h / r.height;
    const x = Math.min(drag.x0, drag.x1),
      y = Math.min(drag.y0, drag.y1);
    const w = Math.abs(drag.x1 - drag.x0),
      h = Math.abs(drag.y1 - drag.y0);
    if (w < 4 || h < 4) return;
    onPick({ x: Math.round(cap.region.x + x * sx), y: Math.round(cap.region.y + y * sy), w: Math.round(w * sx), h: Math.round(h * sy) }, cap);
    onClose();
  };
  return (
    <Modal open={open} onClose={onClose} title="Drag a box around the screen region">
      {err && <div className="err">{err}</div>}
      {!cap && !err && (
        <div className="row">
          <span className="loader" /> capturing screen…
        </div>
      )}
      {cap && (
        <>
          <div
            className="picker"
            onMouseDown={(e) => {
              const p = rel(e);
              setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y });
            }}
            onMouseMove={(e) => {
              if (e.buttons !== 1 || !drag) return;
              const p = rel(e);
              setDrag({ ...drag, x1: p.x, y1: p.y });
            }}
          >
            <img ref={imgRef} src={jpegUrl(cap.image)} draggable={false} />
            {drag && (
              <div
                className="sel"
                style={{
                  left: Math.min(drag.x0, drag.x1),
                  top: Math.min(drag.y0, drag.y1),
                  width: Math.abs(drag.x1 - drag.x0),
                  height: Math.abs(drag.y1 - drag.y0),
                }}
              />
            )}
          </div>
          <div className="row" style={{ marginTop: 10 }}>
            <span className="muted small">Tip: set up the in-game screen first (e.g. open inventory), then open this picker.</span>
            <button className="btn primary right" disabled={!drag} onClick={confirm}>
              Use this region
            </button>
          </div>
        </>
      )}
    </Modal>
  );
}

export function Sparkline({ values, width = 160, height = 34, color = "var(--gold)" }: { values: number[]; width?: number; height?: number; color?: string }) {
  if (values.length < 2) return <span className="dim small">not enough data</span>;
  const min = Math.min(...values),
    max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * (width - 4) + 2},${height - 2 - ((v - min) / span) * (height - 4)}`).join(" ");
  return (
    <svg className="spark" width={width} height={height} role="img" aria-label="trend">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

export function fmtDur(ms: number) {
  const s = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(s / 3600),
    m = Math.floor((s % 3600) / 60),
    sec = s % 60;
  return h ? `${h}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}` : `${m}:${String(sec).padStart(2, "0")}`;
}

export function timeAgo(t: number) {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(t).toLocaleDateString();
}
