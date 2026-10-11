// "Create debug report": shows what goes into the zip, lets the user leave out screenshots, saves
// it to Downloads and opens a pre-filled GitHub issue to attach it to. Nothing is uploaded.
import { useEffect, useState } from "react";
import { Check, Modal } from "./ui";
import { createReport, planReport } from "../lib/debug";
import { REPO_URL } from "../lib/version";

export function DebugReportButton({ label = "Create debug report", className = "btn sm" }: { label?: string; className?: string }) {
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

function DebugReportModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [images, setImages] = useState(false);
  const [summary, setSummary] = useState<string[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ path: string; url: string } | null>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    if (!open) return;
    setSummary(null);
    setErr("");
    planReport(images)
      .then((p) => setSummary(p.summary))
      .catch((e) => setErr(String(e)));
  }, [open, images]);

  const create = async () => {
    setBusy(true);
    setErr("");
    try {
      const r = await createReport(images);
      setDone({ path: r.path, url: r.url });
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={() => {
        setDone(null);
        onClose();
      }}
      title="Create a debug report"
    >
      <div className="col" style={{ maxWidth: 560 }}>
        <div className="small muted">
          A zip file is saved to your Downloads folder, and a new GitHub issue opens in your browser with a form to fill in. Drag the zip into the issue to attach it.
          Nothing is uploaded unless you do that.
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
        <Check checked={images} onChange={setImages} label="Include screenshots (they can show your character name or BattleTag)" />
        <div className="small dim">Your LLM address and API key, Discord webhook and OBS password are never included.</div>
        {err && <div className="err">{err}</div>}
        {done ? (
          <div className="small">
            Saved <span className="mono">{done.path}</span>.{" "}
            <a href={done.url} target="_blank" rel="noreferrer">
              Open the issue form again
            </a>
          </div>
        ) : (
          <div className="row">
            <button className="btn primary sm" disabled={busy || !summary} onClick={create}>
              {busy ? "Building the zip…" : "Create report"}
            </button>
            <a className="btn ghost sm" href={`${REPO_URL}/issues`} target="_blank" rel="noreferrer">
              Just open GitHub issues
            </a>
          </div>
        )}
      </div>
    </Modal>
  );
}
