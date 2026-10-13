// "Help improve Sanctuary Toolkit": shared judgements (opt-in) and test mode, and how to send a debug
// report. Shown as a step in the first-run setup, once to people who upgrade, and as a Settings card.
import { useState } from "react";
import { Card, Check, Modal } from "./ui";
import { DebugReportButton } from "./DebugReport";
import { deleteSharedData, setSharing, useShare } from "../lib/share";
import { useSettings } from "../lib/store";

const key = (k: string) => (k ? k.replace("CommandOrControl", "Ctrl") : "unset");

export interface Choices {
  share: boolean;
  testMode: boolean;
}

/** Apply the choices from the setup step or the upgrade prompt. */
export function applyChoices(c: Choices) {
  setSharing(c.share);
  useSettings.getState().update((s) => {
    s.share.asked = true;
    s.testMode.enabled = c.testMode;
  });
}

function WhatsSent() {
  return (
    <ul className="small" style={{ margin: "6px 0 0", paddingLeft: 18 }}>
      <li>Sent: each item's tooltip text and a picture of the tooltip, the verdict and why, the build guide you follow, and your screen size and app version.</li>
      <li>Never sent: your BattleTag, character name, chat, a full screenshot or your AI server's address. Text in the picture that isn't the tooltip (names, chat) is blacked out.</li>
      <li>Kept for 30 days, then deleted. You can stop at any time, and ask for everything to be deleted.</li>
    </ul>
  );
}

/** The two choices, with what each does and how to undo it. */
export function HelpImproveChoices({ value, onChange }: { value: Choices; onChange: (c: Choices) => void }) {
  const hotkeys = useSettings((s) => s.settings.hotkeys);
  return (
    <div className="col" style={{ gap: 12 }}>
      <div className="small muted">
        Diablo IV has a lot of classes, builds, items and screen setups, more than one developer can test. These help find what goes wrong for you.
      </div>
      <div>
        <Check checked={value.share} onChange={(v) => onChange({ ...value, share: v })} label={<b>Share my judgements to help improve the loot judge</b>} />
        <WhatsSent />
      </div>
      <div>
        <Check checked={value.testMode} onChange={(v) => onChange({ ...value, testMode: v })} label={<b>Turn on test mode</b>} />
        <div className="small" style={{ marginTop: 6 }}>
          Saves what the app sees and decides to a folder on your PC (up to {useSettings.getState().settings.testMode.maxMB} MB, the oldest is removed first). Nothing leaves your PC unless you send a debug
          report, and then it makes the report much more useful.
        </div>
      </div>
      <div className="small">
        <b>Something looks wrong?</b> Press <span className="kbd">{key(hotkeys.markMoment)}</span> in game to mark the moment, and{" "}
        <span className="kbd">{key(hotkeys.flagVerdict)}</span> to flag the last verdict as wrong. Then send a debug report from Settings, About, Report a problem.
      </div>
      <div className="small dim">You can turn either off at any time in Settings, Help improve.</div>
    </div>
  );
}

/** Once, for people who installed before this existed (new installs see it in the setup). */
export function HelpImproveModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [c, setC] = useState<Choices>({ share: false, testMode: useSettings.getState().settings.testMode.enabled });
  const done = (x: Choices) => {
    applyChoices(x);
    onClose();
  };
  return (
    <Modal open={open} onClose={() => done({ share: false, testMode: useSettings.getState().settings.testMode.enabled })} title="Help improve Sanctuary Toolkit">
      <div className="col" style={{ maxWidth: 600 }}>
        <HelpImproveChoices value={c} onChange={setC} />
        <div className="row" style={{ marginTop: 6 }}>
          <button className="btn primary" onClick={() => done({ share: true, testMode: true })}>
            Turn both on
          </button>
          <button className="btn" onClick={() => done(c)}>
            Save my choice
          </button>
          <button className="btn ghost right" onClick={() => done({ share: false, testMode: useSettings.getState().settings.testMode.enabled })}>
            Not now
          </button>
        </div>
      </div>
    </Modal>
  );
}

/** Settings: the same switches, what was sent, and "delete my data". */
export function HelpImproveCard() {
  const { settings, update } = useSettings();
  const share = useShare();
  const [view, setView] = useState(false);
  const [msg, setMsg] = useState("");
  const del = async () => {
    if (!confirm("Delete everything you've shared? This also turns sharing off.")) return;
    setMsg("Sending the request…");
    try {
      await deleteSharedData();
      setMsg("Done: the developer has been asked to delete it, and sharing is off. It's all deleted after 30 days anyway.");
    } catch (e) {
      setMsg(`Couldn't send the request: ${String((e as Error).message ?? e)}`);
    }
  };
  return (
    <Card title="Help improve" right={settings.share.enabled && <span className="small" style={{ color: "var(--green)" }}>● sharing</span>}>
      <div className="col" style={{ gap: 10 }}>
        <div>
          <Check checked={settings.share.enabled} onChange={setSharing} label={<b>Share my judgements</b>} />
          <WhatsSent />
          {settings.share.enabled && (
            <div className="small muted" style={{ marginTop: 6 }}>
              {share.sent} sent this session{share.queue.length ? `, ${share.queue.length} waiting` : ""}
              {share.lastSentAt ? `, last at ${new Date(share.lastSentAt).toLocaleTimeString()}` : ""}.
              {share.error && <span style={{ color: "#ff8b78" }}> Last try failed: {share.error}</span>}
            </div>
          )}
          <div className="row" style={{ marginTop: 6 }}>
            <button className="btn ghost sm" onClick={() => setView(true)} disabled={!share.recent.length}>
              See what was sent
            </button>
            {(settings.share.installId || settings.share.since) && (
              <button className="btn ghost sm" onClick={del}>
                Delete my shared data
              </button>
            )}
          </div>
          {msg && <div className="small muted" style={{ marginTop: 4 }}>{msg}</div>}
        </div>
        <div>
          <Check checked={settings.testMode.enabled} onChange={(v) => update((s) => void (s.testMode.enabled = v))} label={<b>Test mode</b>} />
          <div className="small" style={{ marginTop: 4 }}>
            Saves what the app sees and decides to a folder on your PC, for debug reports. The Debug page has its size limit and folder.
          </div>
        </div>
        <div className="small">
          Mark a moment in game with <span className="kbd">{key(settings.hotkeys.markMoment)}</span>, flag the last verdict as wrong with{" "}
          <span className="kbd">{key(settings.hotkeys.flagVerdict)}</span>, then:
        </div>
        <div className="row">
          <DebugReportButton label="Send a debug report" className="btn sm" />
        </div>
      </div>
      <Modal open={view} onClose={() => setView(false)} title="What was sent">
        <div className="col" style={{ maxWidth: 720, maxHeight: "70vh", overflow: "auto" }}>
          <div className="small muted">The last {share.recent.length} items sent this session, newest first. Pictures aren't shown here; their count is.</div>
          {share.recent.map((r, i) => (
            <details key={i}>
              <summary className="small">
                {new Date(r.at).toLocaleTimeString()} · {r.summary}
                {r.images ? ` · ${r.images} picture${r.images > 1 ? "s" : ""}` : ""}
              </summary>
              <pre className="mono small" style={{ whiteSpace: "pre-wrap", maxHeight: 300, overflow: "auto" }}>{r.json}</pre>
            </details>
          ))}
        </div>
      </Modal>
    </Card>
  );
}
