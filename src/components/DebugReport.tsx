// "Send a debug report": shows what goes into the zip, lets the user leave out screenshots, and sends
// it to the report service (a Cloudflare Worker; the app holds no storage keys). If sending fails, or
// the user prefers, the zip is saved to Downloads to attach to a GitHub issue instead.
import { useEffect, useState } from "react";
import { Check, Modal } from "./ui";
import { planReport, saveReport, sendReport, type SendResult } from "../lib/debug";
import { REPO_URL } from "../lib/version";

export function DebugReportButton({ label = "Send debug report", className = "btn sm" }: { label?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      <DebugReportModal open={open} onClose={() => setOpen(false)} />
    </>
  );
}

type Done = SendResult | { saved: true; path: string; url: string };

function DebugReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [images, setImages] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [busy, setBusy] = useState<"" | "send" | "save">("");
  const [done, setDone] = useState<Done | null>(null);
  const [err, setErr] = useState("");
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setErr("");
    planReport(images)
      .then((p) => setSummary(p.summary))
      .catch((e) => setErr(String(e)));
  }, [open, images]);

  const run = async (what: "send" | "save") => {
    setBusy(what);
    setErr("");
    try {
      if (what === "send") setDone(await sendReport(images, note));
      else {
        const r = await saveReport(images, note);
        setDone({ saved: true, path: r.path, url: r.url });
      }
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy("");
    }
  };

  const copy = (id: string) => {
    void navigator.clipboard?.writeText(id).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setDone(null);
        setNote("");
        onClose();
      }}
      title="Send a debug report"
    >
      <div className="col" style={{ maxWidth: 560 }}>
        <div className="small muted">
          This sends a report to the developer so they can see what went wrong. It's stored privately and deleted after 30 days.
        </div>
        <div>
          <b className="small">What goes in</b>
          {summary ? (
            <ul className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
              {summary.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
          ) : (
            <div className="small dim">Looking at the logs…</div>
          )}
        </div>
        <label className="field">
          What went wrong? (optional)
          <textarea rows={3} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} placeholder="For example: the card said scrap on a 4-star ring in my bag" disabled={!!done} />
        </label>
        <Check checked={images} onChange={setImages} label="Include screenshots (they can show your character name or BattleTag)" />
        <div className="small dim">Your LLM address and API key, Discord webhook and OBS password are never included.</div>
        {err && <div className="err">{err}</div>}
        {done && "sent" in done && done.sent && (
          <div className="small">
            Sent. Your report ID is <b className="mono">{done.id}</b>{" "}
            <button className="btn ghost sm" onClick={() => copy(done.id)}>
              {copied ? "Copied" : "Copy"}
            </button>
            <div style={{ marginTop: 6 }}>
              If you open a GitHub issue, include this ID.{" "}
              <a href={done.url} target="_blank" rel="noreferrer">
                Open an issue
              </a>
            </div>
          </div>
        )}
        {done && "sent" in done && !done.sent && (
          <div className="small">
            <div className="err">{/HTTP 429/.test(done.error) ? "Too many reports right now. Try again in a minute." : `Couldn't send the report: ${done.error}`}</div>
            <div style={{ marginTop: 6 }}>
              It's saved to <span className="mono">{done.path}</span> instead. You can attach it to a GitHub issue.{" "}
              <a href={done.url} target="_blank" rel="noreferrer">
                Open an issue
              </a>
            </div>
          </div>
        )}
        {done && "saved" in done && (
          <div className="small">
            Saved to <span className="mono">{done.path}</span>. Drag it into a GitHub issue to attach it.{" "}
            <a href={done.url} target="_blank" rel="noreferrer">
              Open an issue
            </a>
          </div>
        )}
        {!done && (
          <div className="row">
            <button className="btn primary sm" disabled={!!busy || !summary} onClick={() => run("send")}>
              {busy === "send" ? "Sending…" : "Send report"}
            </button>
            <button className="btn ghost sm" disabled={!!busy || !summary} onClick={() => run("save")}>
              {busy === "save" ? "Saving…" : "Save it instead"}
            </button>
            <a className="btn ghost sm" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              GitHub issues
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}
