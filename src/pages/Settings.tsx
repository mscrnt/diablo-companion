import { useState } from "react";
import { Card, Check, KeyCapture, PadCapture, PageHead } from "../components/ui";
import { checkLlm, useRuntime } from "../lib/engine";
import { obsReplayStatus } from "../lib/obs";
import { discord } from "../lib/alerts";
import { useSettings, type ActionId } from "../lib/store";
import { staticMeta } from "../lib/names";
import { APP_VERSION, REPO_URL, RELEASES_URL, checkForUpdate, installUpdate } from "../lib/version";
import { DebugReportButton } from "../components/DebugReport";
import { ExportStatsButton } from "../components/ExportStats";
import { HelpImproveCard } from "../components/HelpImprove";

const ACTIONS: { id: ActionId; label: string }[] = [
  { id: "judge", label: "Judge item under cursor" },
  { id: "runToggle", label: "Start / finish run" },
  { id: "runSplit", label: "Split" },
  { id: "clip", label: "Clip (OBS replay buffer)" },
  { id: "coachSnap", label: "Screenshot → Coach" },
  { id: "overlayEdit", label: "Edit overlay layout" },
  { id: "overlayToggle", label: "Hide / show overlay" },
  { id: "mapCharacter", label: "Map my character (start / pause / resume)" },
  { id: "snoozeJudge", label: "Snooze the loot judge (30 s)" },
  { id: "mapPinsPreset", label: "Map pins: next preset" },
  { id: "markMoment", label: "Mark this moment (saves a debug snapshot)" },
  { id: "flagVerdict", label: "Flag the last verdict as wrong" },
];

export default function SettingsPage() {
  const { settings, update, reset } = useSettings();
  const llm = useRuntime((s) => s.llm);
  const pad = useRuntime((s) => s.lastPad);
  const errs = useRuntime((s) => s.hotkeyErrors);
  const [obsMsg, setObsMsg] = useState("");
  const meta = staticMeta() as any;

  return (
    <>
      <PageHead title="Settings">
        <button className="btn ghost sm" onClick={() => confirm("Reset all settings to defaults?") && reset()}>
          Reset to defaults
        </button>
      </PageHead>
      <div className="grid g2">
        <Card title="Local LLM (vLLM / OpenAI-compatible)">
          <div className="col">
            <label className="field">
              Base URL
              <input type="url" value={settings.llm.baseUrl} onChange={(e) => update((s) => void (s.llm.baseUrl = e.target.value))} />
            </label>
            <label className="field">
              Model
              <input type="text" value={settings.llm.model} list="models" onChange={(e) => update((s) => void (s.llm.model = e.target.value))} />
              <datalist id="models">{llm?.models.map((m) => <option key={m} value={m} />)}</datalist>
            </label>
            <label className="field">
              API key (optional)
              <input type="password" value={settings.llm.apiKey} onChange={(e) => update((s) => void (s.llm.apiKey = e.target.value))} />
            </label>
            <div className="row">
              <button className="btn sm" onClick={checkLlm}>
                Test connection
              </button>
              <span className="small">
                <span className={"dot " + (llm?.ok ? "ok" : llm ? "bad" : "")} />
                {llm?.ok ? `online · ${llm.models.join(", ")}` : llm?.error ?? "…"}
              </span>
            </div>
          </div>
        </Card>

        <Card title="Build import">
          <div className="col">
            <label className="field">
              FlareSolverr URL (for full guide text behind Cloudflare)
              <input type="url" value={settings.flaresolverr} onChange={(e) => update((s) => void (s.flaresolverr = e.target.value))} />
            </label>
            <div className="small muted">
              Only Mobalytics needs it: without it, those imports fall back to its API (all gear/skills/paragon, but no author notes). Maxroll, Icy Veins and d4builds builds come
              straight from the link you paste.
            </div>
            {meta && (
              <div className="small dim">
                Static data {String(meta.staticDataVersion ?? "")} · fetched {String(meta.fetchedAt ?? "").slice(0, 10)}: refresh with <span className="mono">node scripts/fetch-mobalytics-static.mjs && node scripts/slim-static.mjs</span>
              </div>
            )}
          </div>
        </Card>

        <Card title="Hotkeys & controller chords">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Action</th>
                  <th>Keyboard</th>
                  <th>Controller chord</th>
                </tr>
              </thead>
              <tbody>
                {ACTIONS.map((a) => (
                  <tr key={a.id}>
                    <td>{a.label}</td>
                    <td>
                      <KeyCapture value={settings.hotkeys[a.id]} onChange={(v) => update((s) => void (s.hotkeys[a.id] = v))} />
                    </td>
                    <td>
                      <PadCapture value={settings.padChords[a.id]} onChange={(v) => update((s) => void (s.padChords[a.id] = v))} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="col" style={{ marginTop: 10 }}>
            <Check checked={settings.padEnabled} onChange={(v) => update((s) => void (s.padEnabled = v))} label="Enable controller chords (XInput, read-only)" />
            <div className="small muted">
              Pad live: {pad.length ? pad.map((b) => <span key={b} className="kbd" style={{ marginRight: 4 }}>{b}</span>) : <span className="dim">press buttons to test</span>}
            </div>
            <div className="small dim">
              Global hotkeys are swallowed system-wide while the app runs: pick keys you don't use in game. The companion only reads your controller; it never sends input to the game.
            </div>
            {errs.length > 0 && <div className="err">{errs.join("\n")}</div>}
          </div>
        </Card>

        <Card title="Alerts & integrations">
          <div className="col">
            <label className="field">
              Volume {Math.round(settings.alerts.volume * 100)}%
              <input type="range" min={0} max={1} step={0.05} value={settings.alerts.volume} onChange={(e) => update((s) => void (s.alerts.volume = Number(e.target.value)))} />
            </label>
            <Check
              checked={settings.alerts.onlyWhileGameRuns}
              onChange={(v) => update((s) => void (s.alerts.onlyWhileGameRuns = v))}
              label="Only alert while Diablo IV is running (world events: sound, toasts and Discord)"
            />
            <label className="field">
              Discord webhook URL (event alerts)
              <input type="url" value={settings.alerts.discordWebhook} onChange={(e) => update((s) => void (s.alerts.discordWebhook = e.target.value))} />
            </label>
            <div>
              <button className="btn sm" disabled={!settings.alerts.discordWebhook} onClick={() => discord(settings.alerts.discordWebhook, "👋 D4 Companion test message")}>
                Send test
              </button>
            </div>
            <h3 style={{ marginTop: 8 }}>OBS (clip great drops)</h3>
            <Check checked={settings.obs.enabled} onChange={(v) => update((s) => void (s.obs.enabled = v))} label="Enable OBS websocket (v5)" />
            <div className="grid g2">
              <label className="field">
                URL
                <input type="text" value={settings.obs.url} onChange={(e) => update((s) => void (s.obs.url = e.target.value))} />
              </label>
              <label className="field">
                Password
                <input type="password" value={settings.obs.password} onChange={(e) => update((s) => void (s.obs.password = e.target.value))} />
              </label>
            </div>
            <Check checked={settings.obs.clipOnBis} onChange={(v) => update((s) => void (s.obs.clipOnBis = v))} label="Auto-save a replay when you find a missing build piece" />
            <div className="row">
              <button
                className="btn sm"
                onClick={() =>
                  obsReplayStatus(settings.obs.url, settings.obs.password)
                    .then((r) => setObsMsg(`Connected · replay buffer ${r.outputActive ? "running ✓" : "NOT running: start it in OBS"}`))
                    .catch((e) => setObsMsg(String(e.message ?? e)))
                }
              >
                Test OBS
              </button>
              <span className="small muted">{obsMsg}</span>
            </div>
          </div>
        </Card>

        <Card title="Activities (run tracker)">
          <textarea
            rows={6}
            defaultValue={settings.activities.join("\n")}
            onBlur={(e) =>
              update((s) => {
                s.activities = e.target.value
                  .split("\n")
                  .map((x) => x.trim())
                  .filter(Boolean);
              })
            }
          />
          <div className="small dim">One per line.</div>
        </Card>

        <HelpImproveCard />

        <About />
      </div>
    </>
  );
}

function About() {
  const update = useRuntime((s) => s.update);
  const [status, setStatus] = useState("");
  const [progress, setProgress] = useState<number | null | undefined>(undefined);
  const check = async () => {
    setStatus("Checking…");
    try {
      const u = await checkForUpdate();
      useRuntime.setState({ update: u });
      setStatus(u ? "" : "You're on the latest version.");
    } catch (e) {
      setStatus(`Couldn't reach GitHub: ${(e as Error).message}`);
    }
  };
  const install = async () => {
    setStatus("Downloading the update…");
    setProgress(null);
    try {
      await installUpdate((f) => {
        setProgress(f);
        if (f === 1) setStatus("Installing: the app will restart.");
      });
    } catch (e) {
      setProgress(undefined);
      setStatus(`Update failed: ${(e as Error).message}`);
    }
  };
  return (
    <Card title="About">
      <div className="row" style={{ alignItems: "baseline" }}>
        <img src="/logo.png" alt="" width={36} height={36} style={{ alignSelf: "center" }} />
        <b style={{ fontSize: 18 }}>Sanctuary Toolkit</b>
        <span className="mono">v{APP_VERSION}</span>
        {update && (
          <a className="badge" style={{ color: "var(--green)" }} href={update.url} target="_blank" rel="noreferrer">
            v{update.version} available
          </a>
        )}
      </div>
      <div className="row" style={{ marginTop: 10 }}>
        {update?.installable ? (
          <button className="btn primary sm" onClick={install} disabled={progress !== undefined}>
            Update to v{update.version}
          </button>
        ) : (
          <button className="btn sm" onClick={check}>
            Check for updates
          </button>
        )}
        <a className="btn ghost sm" href={RELEASES_URL} target="_blank" rel="noreferrer">
          Release notes
        </a>
        <a className="btn ghost sm" href={REPO_URL} target="_blank" rel="noreferrer">
          GitHub
        </a>
        <DebugReportButton label="Report a problem" className="btn ghost sm" />
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <ExportStatsButton className="btn ghost sm" />
      </div>
      {progress !== undefined && (
        <div className="progress" style={{ marginTop: 8 }}>
          <div style={{ width: `${Math.round((progress ?? 0.05) * 100)}%` }} />
        </div>
      )}
      {status && <div className="small muted" style={{ marginTop: 6 }}>{status}</div>}
      {update && !update.installable && (
        <div className="small dim" style={{ marginTop: 4 }}>
          This version can't update itself. Download the new installer from the release page; installing over this version keeps your settings.
        </div>
      )}
      <div className="small dim" style={{ marginTop: 10 }}>
        Free for noncommercial use (PolyForm Noncommercial 1.0.0). Not affiliated with Blizzard Entertainment, Mobalytics, Maxroll, Icy Veins or d4builds. Builds stay credited to
        the site and author you imported them from.
      </div>
    </Card>
  );
}
