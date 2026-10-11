import { ChartColumn, FolderOpen, ShieldCheck, Sparkles } from "lucide-react";
import { Card, Check, PageHead, timeAgo } from "../components/ui";
import { useRuntime } from "../lib/engine";
import { autoStatus, forgetRecent } from "../lib/autojudge";
import { cancelGuide, gearScan, startSetup, statsCheck, useGuide } from "../lib/guide";
import { useSettings } from "../lib/store";
import { forceHordes } from "../lib/hordesRunner";
import { logContext, openTestLog } from "../lib/testmode";

export default function GuidePage() {
  const g = useGuide();
  const { settings, update } = useSettings();
  const game = useRuntime((s) => s.game);
  const cal = settings.calibration;

  return (
    <>
      <PageHead
        title="Setup & Guide"
        sub="Guided overlays walk you through everything in game — what to open, what to hover, when to scroll. You never need to look back at this window."
      />
      <div className="grid g2">
        <Card title="Guided flows">
          <div className="col">
            <div className="row">
              <button className="btn primary" disabled={g.active} onClick={() => startSetup()}>
                <Sparkles size={15} strokeWidth={1.75} aria-hidden /> Full setup (recommended)
              </button>
              <span className="small muted">screen → inventory layout → gear scan → stats</span>
            </div>
            <div className="row">
              <button className="btn" disabled={g.active} onClick={() => gearScan()}>
                <ShieldCheck size={15} strokeWidth={1.75} aria-hidden /> Gear scan only
              </button>
              <span className="small muted">hover each equipped item → fills your build progress</span>
            </div>
            <div className="row">
              <button className="btn" disabled={g.active} onClick={() => statsCheck()}>
                <ChartColumn size={15} strokeWidth={1.75} aria-hidden /> Stats check
              </button>
              <span className="small muted">reads the character sheet (e.g. Minion Attack Speed ≥ 100%)</span>
            </div>
            {g.active && (
              <div className="note">
                <b>{g.title}</b> — {g.instruction}
                <div className="small">{g.detail}</div>
                <div className="row" style={{ marginTop: 8 }}>
                  <span className="small muted">
                    In game, <span className="kbd">{settings.hotkeys.judge}</span> / your judge chord = next / skip.
                  </span>
                  <button className="btn sm right" onClick={cancelGuide}>
                    Cancel guide
                  </button>
                </div>
              </div>
            )}
            {!game?.running && <div className="small" style={{ color: "var(--blood2)" }}>Diablo IV isn't running.</div>}
          </div>
        </Card>

        <Card title="Auto-judge (no hotkey)">
          <div className="col">
            <Check
              checked={settings.autoJudge.enabled}
              onChange={(v) => update((s) => void (s.autoJudge.enabled = v))}
              label="Judge items automatically when a tooltip appears"
            />
            <label className="field">
              Scan interval {settings.autoJudge.intervalMs} ms (local OCR; the LLM is only called for new tooltips)
              <input type="range" min={250} max={1500} step={50} value={settings.autoJudge.intervalMs} onChange={(e) => update((s) => void (s.autoJudge.intervalMs = Number(e.target.value)))} />
            </label>
            <label className="field">
              Ground loot (inventory closed): hover {settings.autoJudge.worldDwellMs / 1000}s before judging, badge only for {settings.autoJudge.worldBadgeSeconds}s
              <div className="row">
                <input type="range" min={300} max={3000} step={100} value={settings.autoJudge.worldDwellMs} onChange={(e) => update((s) => void (s.autoJudge.worldDwellMs = Number(e.target.value)))} />
                <input type="range" min={1} max={10} value={settings.autoJudge.worldBadgeSeconds} onChange={(e) => update((s) => void (s.autoJudge.worldBadgeSeconds = Number(e.target.value)))} />
              </div>
            </label>
            <label className="field">
              Snooze length ({settings.hotkeys.snoozeJudge} / {settings.padChords.snoozeJudge.join("+") || "no chord"}): {settings.autoJudge.snoozeSeconds}s
              <input type="range" min={10} max={120} step={5} value={settings.autoJudge.snoozeSeconds} onChange={(e) => update((s) => void (s.autoJudge.snoozeSeconds = Number(e.target.value)))} />
            </label>
            <Check checked={settings.autoJudge.sounds} onChange={(v) => update((s) => void (s.autoJudge.sounds = v))} label={'Sound for every verdict ("Wear this" and "Cube it" always chime)'} />
            <div className="small muted">
              Last scan {autoStatus.lastTickMs} ms · tooltip {autoStatus.tooltip ? "visible" : "—"} · {autoStatus.judged} judged this session{" "}
              <button className="btn ghost sm" onClick={forgetRecent}>
                forget seen items
              </button>
            </div>
          </div>
        </Card>

        <Card title="Test mode" right={settings.testMode.enabled && <span className="small" style={{ color: "var(--gold)" }}>● recording</span>}>
          <div className="col">
            <Check
              checked={settings.testMode.enabled}
              onChange={(v) => {
                update((s) => void (s.testMode.enabled = v));
                if (v) logContext("test mode turned on");
              }}
              label="Record every item scan for testing"
            />
            <div className="small muted">
              While on, each auto-judge scan is saved with its screen capture, the tooltip boxes, the text read, the parse and the verdict, plus your game window size and
              mode, monitor DPI scale, overlay layout and black-bar detection. A new snapshot is saved whenever the window, mode or DPI changes. Play normally, then send
              the folder along with a bug report.
            </div>
            <label className="field">
              Keep at most
              <select value={settings.testMode.maxMB} onChange={(e) => update((s) => void (s.testMode.maxMB = Number(e.target.value)))}>
                <option value={200}>200 MB</option>
                <option value={500}>500 MB</option>
                <option value={1000}>1 GB</option>
              </select>
            </label>
            <div className="row">
              <button className="btn sm" onClick={() => openTestLog().catch(() => {})}>
                <FolderOpen size={14} strokeWidth={1.75} aria-hidden /> Open test-mode folder
              </button>
              <span className="small muted">oldest recordings are removed first</span>
            </div>
          </div>
        </Card>

        <Card title="Learned screen layout">
          {cal ? (
            <div className="col small">
              <div>
                Calibrated {timeAgo(cal.at)} · game {cal.gameRect.w}×{cal.gameRect.h}
              </div>
              <div>Inventory panel: {cal.inventoryPanel ? `${cal.inventoryPanel.w}×${cal.inventoryPanel.h} @ ${cal.inventoryPanel.x},${cal.inventoryPanel.y}` : "—"}</div>
              <div>Gear slots: {cal.equipment ? Object.keys(cal.equipment).join(", ") : "—"}</div>
              <div>Gold: {cal.gold ? "found" : "—"} · Stats panel: {cal.statsPanel ? "found" : "—"}</div>
              {settings.overlay.gameBounds && (
                <div>
                  Black bars: {Math.round(settings.overlay.gameBounds.left * cal.gameRect.w)}px left · {Math.round((1 - settings.overlay.gameBounds.right) * cal.gameRect.w)}px right
                </div>
              )}
              <div>
                <button className="btn ghost sm" onClick={() => update((s) => void (s.calibration = null))}>
                  Forget calibration
                </button>
              </div>
            </div>
          ) : (
            <div className="muted">Not calibrated yet — run the full setup.</div>
          )}
        </Card>

        <Card title="Infernal Hordes helper">
          <div className="col">
            <Check checked={settings.hordes.enabled} onChange={(v) => update((s) => void (s.hordes.enabled = v))} label="Rank Infernal Offers and advise on Spoils automatically" />
            <label className="field">
              Playstyle (how much danger an offer may add)
              <select value={settings.hordes.style} onChange={(e) => update((s) => void (s.hordes.style = e.target.value as typeof s.hordes.style))}>
                <option value="safe">Safe — avoid risky banes</option>
                <option value="balanced">Balanced</option>
                <option value="greedy">Greedy — max Aether, I can take it</option>
              </select>
            </label>
            <div className="row">
              <button className="btn sm" onClick={() => forceHordes(true)}>
                I'm in Hordes now
              </button>
              <button className="btn ghost sm" onClick={() => forceHordes(false)}>
                Stop
              </button>
            </div>
            <div className="small muted">It switches on by itself when the quest tracker shows Infernal Hordes; use the button if it doesn't.</div>
          </div>
        </Card>

        <Card title="Overlay layout">
          <div className="col">
            <label className="row" style={{ gap: 8 }}>
              <input type="radio" checked={settings.overlay.layout === "bars"} onChange={() => update((s) => void (s.overlay.layout = "bars"))} />
              <span>
                <b>Black bars</b> — full-height panels beside the game image (uses all the dead space)
              </span>
            </label>
            <label className="row" style={{ gap: 8 }}>
              <input type="radio" checked={settings.overlay.layout === "free"} onChange={() => update((s) => void (s.overlay.layout = "free"))} />
              <span>
                <b>Free</b> — drag widgets anywhere
              </span>
            </label>
          </div>
        </Card>
      </div>
    </>
  );
}
