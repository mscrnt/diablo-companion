import { useState } from "react";
import { Diamond, FlaskConical, FolderOpen, Package, Scale, Star } from "lucide-react";
import { Badge, Card, Check, Empty, PageHead, timeAgo } from "../components/ui";
import { runAction, useRuntime } from "../lib/engine";
import { VERDICT_STYLE } from "../lib/judge";
import { judgeImage, openJudgeLog } from "../lib/judgeRunner";
import { openTestLog } from "../lib/testmode";
import { useLoot, useSettings } from "../lib/store";
import type { JudgeResult } from "../lib/types";
import { shareFeedback, sharingOn } from "../lib/share";

export default function Loot() {
  const { history, clear } = useLoot();
  const { settings, update } = useSettings();
  const judging = useRuntime((s) => s.judging);
  const [sel, setSel] = useState<JudgeResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");

  const onPaste = async (e: React.ClipboardEvent) => {
    const file = [...e.clipboardData.items].find((i) => i.type.startsWith("image/"))?.getAsFile();
    if (file) await judgeFile(file);
  };
  const judgeFile = async (file: File) => {
    setBusy(true);
    setErr("");
    try {
      const b64 = await new Promise<string>((res) => {
        const r = new FileReader();
        r.onload = () => res(String(r.result));
        r.readAsDataURL(file);
      });
      const r = await judgeImage(b64);
      if (!r) setErr("No item tooltip found in that image.");
      else setSel(r);
    } catch (e) {
      setErr(String((e as Error).message ?? e));
    } finally {
      setBusy(false);
    }
  };

  const shown = sel ?? history[0] ?? null;

  return (
    <div onPaste={onPaste}>
      <PageHead title="Loot Judge" sub="Hover an item in game and press the hotkey (or controller chord). Your vision LLM reads the tooltip, then it's scored against your build.">
        <button className="btn" onClick={() => openJudgeLog().catch((e) => setErr(String(e)))} title="Every judgment: tooltip images, OCR text, AI labels and the decision">
          <FolderOpen size={15} strokeWidth={1.75} aria-hidden /> Open log folder
        </button>
        {settings.testMode.enabled && (
          <button className="btn" onClick={() => openTestLog().catch((e) => setErr(String(e)))} title="Test mode recordings: every scan with its screen capture and display details (Setup & Guide → Test mode)">
            <FlaskConical size={15} strokeWidth={1.75} aria-hidden /> Test-mode folder
          </button>
        )}
        <button className="btn primary" disabled={judging} onClick={() => runAction("judge")}>
          {judging ? <span className="loader" /> : <Scale size={15} strokeWidth={1.75} aria-hidden />} Judge now <span className="kbd">{settings.hotkeys.judge}</span>
        </button>
      </PageHead>

      <div className="grid g2">
        <Card title="Latest verdict">
          {shown ? (
            <>
              <VerdictDetail r={shown} />
              <WrongVerdict key={shown.id} r={shown} />
            </>
          ) : (
            <Empty icon={Scale}>Nothing judged yet.</Empty>
          )}
        </Card>
        <Card title="Test & tune">
          <div className="col">
            <div className="note">
              Paste a screenshot here (Ctrl+V) or pick a file to test the judge without the game.{" "}
              <label className="btn sm" style={{ marginLeft: 6 }}>
                {busy ? <span className="loader" /> : "Choose image…"}
                <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && judgeFile(e.target.files[0])} />
              </label>
            </div>
            {err && <div className="err">{err}</div>}
            <div className="grid g2">
              <label className="field">
                Capture width (px around cursor)
                <input type="number" value={settings.capture.width} onChange={(e) => update((s) => void (s.capture.width = Number(e.target.value)))} />
              </label>
              <label className="field">
                Capture height
                <input type="number" value={settings.capture.height} onChange={(e) => update((s) => void (s.capture.height = Number(e.target.value)))} />
              </label>
              <label className="field">
                Max image edge sent to LLM
                <input type="number" value={settings.capture.maxEdge} onChange={(e) => update((s) => void (s.capture.maxEdge = Number(e.target.value)))} />
              </label>
              <label className="field">
                JPEG quality
                <input type="number" min={40} max={100} value={settings.capture.quality} onChange={(e) => update((s) => void (s.capture.quality = Number(e.target.value)))} />
              </label>
            </div>
            <Check checked={settings.capture.ocrAssist} onChange={(v) => update((s) => void (s.capture.ocrAssist = v))} label="Send Windows OCR text alongside the image (better numbers)" />
            <Check
              checked={settings.capture.equippedCompare}
              onChange={(v) => update((s) => void (s.capture.equippedCompare = v))}
              label="Compare against the EQUIPPED tooltip when the game shows it"
            />
          </div>
        </Card>
      </div>

      <Card title="History" right={history.length > 0 && <button className="btn ghost sm" onClick={() => confirm("Clear loot history?") && clear()}>Clear</button>} style={{ marginTop: 14 }}>
        {history.length === 0 ? (
          <Empty icon={Package}>Judged items show up here.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Verdict</th>
                  <th>Item</th>
                  <th>Slot</th>
                  <th>Build stats</th>
                  <th>When</th>
                </tr>
              </thead>
              <tbody>
                {history.map((h) => (
                  <tr key={h.id} onClick={() => setSel(h)} style={{ cursor: "pointer" }}>
                    <td>
                      <Badge color={(VERDICT_STYLE[h.verdict] ?? VERDICT_STYLE.UNKNOWN).color} icon={(VERDICT_STYLE[h.verdict] ?? VERDICT_STYLE.UNKNOWN).icon}>
                        {(VERDICT_STYLE[h.verdict] ?? VERDICT_STYLE.UNKNOWN).label}
                      </Badge>
                    </td>
                    <td>
                      <div style={{ fontWeight: 700 }} className={"rar-" + h.item.rarity}>
                        {h.item.name}
                      </div>
                      <div className="small muted">
                        {h.item.itemType}
                        {h.flagged && <span style={{ color: "var(--orange)" }}> · flagged wrong</span>}
                      </div>
                    </td>
                    <td className="small">{h.slot ?? "—"}</td>
                    <td className="small">
                      {h.matched.length}/{h.matched.length + h.missing.length}
                      {h.greaterOnTargets > 0 && <span style={{ color: "var(--gold2)" }}> · {h.greaterOnTargets}<Star className="i" size={11} strokeWidth={2} fill="currentColor" aria-label="greater" /></span>}
                    </td>
                    <td className="small dim nowrap">{timeAgo(h.at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

/** "Wrong verdict?": flag it (with an optional note); sent with the judgement when sharing is on. */
function WrongVerdict({ r }: { r: JudgeResult }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const patch = useLoot((s) => s.patch);
  if (r.flagged)
    return <div className="small" style={{ color: "var(--orange)", marginTop: 8 }}>You flagged this verdict as wrong{sharingOn() ? ": thanks, it's been sent." : "."}</div>;
  if (!open)
    return (
      <button className="btn ghost sm" style={{ marginTop: 8 }} onClick={() => setOpen(true)}>
        Wrong verdict?
      </button>
    );
  const send = () => {
    patch(r.id, { flagged: true });
    shareFeedback(r.id, "wrong", note);
  };
  return (
    <div className="col" style={{ marginTop: 8, gap: 6 }}>
      <input type="text" maxLength={300} placeholder="What should it have said? (optional)" value={note} onChange={(e) => setNote(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} />
      <div className="row">
        <button className="btn sm" onClick={send}>
          Flag as wrong
        </button>
        <button className="btn ghost sm" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {!sharingOn() && <span className="small dim">Turn on shared judgements in Settings to send flags to the developer.</span>}
      </div>
    </div>
  );
}

export function VerdictDetail({ r }: { r: JudgeResult }) {
  const v = VERDICT_STYLE[r.verdict] ?? VERDICT_STYLE.UNKNOWN;
  return (
    <div className="grid g2">
      <div className="col">
        <div className="verdict-card" style={{ borderColor: v.color, color: v.color }}>
          <div className="v">
            <v.icon size={22} strokeWidth={1.75} aria-hidden /> {v.label}
          </div>
          <div style={{ color: "var(--text)", fontWeight: 700 }}>{r.item.name}</div>
          {r.action && <div style={{ color: "var(--text)", marginTop: 4 }}>{r.action}</div>}
          <div className="small muted">
            {r.item.itemType}
            {r.item.itemPower ? ` · ${r.item.itemPower} IP` : ""}
            {r.item.ancestral ? " · Ancestral" : ""}
          </div>
        </div>
        {r.reasons.map((x, i) => (
          <div key={i} className="small">
            • {x}
          </div>
        ))}
        {r.steps && r.steps.length > 0 && (
          <ol className="small" style={{ margin: "4px 0 0", paddingLeft: 18 }}>
            {r.steps.map((x, i) => (
              <li key={i}>{x}</li>
            ))}
          </ol>
        )}
        <div className="small dim">
          parsed in {(r.ms / 1000).toFixed(1)}s · {timeAgo(r.at)}
        </div>
      </div>
      <div className="col">
        {r.thumb && <img className="thumb" src={r.thumb} />}
        <div className="col" style={{ gap: 2 }}>
          {r.item.affixes.map((a, i) => (
            <div key={i} className="affix">
              {a.greater ? <Star className="ga mark" size={11} strokeWidth={2} fill="currentColor" aria-label="greater" /> : <Diamond className="dim mark" size={9} strokeWidth={2} fill="currentColor" aria-hidden />}
              <span style={{ color: a.match ? "var(--green)" : undefined }}>{a.text}</span>
            </div>
          ))}
          {r.item.aspect?.text && <div className="small" style={{ color: "var(--orange)", marginTop: 4 }}>{r.item.aspect.text}</div>}
        </div>
      </div>
    </div>
  );
}
