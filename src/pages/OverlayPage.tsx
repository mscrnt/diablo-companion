import { useState } from "react";
import { Card, Check, PageHead } from "../components/ui";
import { runAction, setOverlayEdit, useRuntime } from "../lib/engine";
import { captureMonitor, gameStatus, setOverlayCapturable } from "../lib/native";
import { useMapPins } from "../lib/mapPinsRunner";
import { defaultSettings, useSettings, type MapPinGroup } from "../lib/store";
import { detectPillarbox } from "../lib/vision";

const WIDGETS: { id: keyof typeof defaultSettings.overlay.widgets; label: string; desc: string }[] = [
  { id: "timers", label: "Event timers", desc: "Next world boss / helltide / legion with countdowns." },
  { id: "verdict", label: "Loot verdict", desc: "Pops up after you judge an item." },
  { id: "run", label: "Run timer", desc: "Current run, splits and PB delta." },
  { id: "watchers", label: "Watchers", desc: "Values from 'show on overlay' screen watchers (cinders, gold…)." },
  { id: "farm", label: "Farm targets", desc: "Top 3 items to chase for your build." },
  { id: "build", label: "Build card", desc: "Skill bar & key reminders." },
  { id: "toasts", label: "Toasts", desc: "Event alerts, clips, errors." },
];

const PIN_GROUPS: { id: MapPinGroup; label: string; desc: string }[] = [
  { id: "journal", label: "Deckard's journals", desc: "The season's journal pages, labelled with their part number." },
  { id: "collectible", label: "Altars of Lilith & regional collectibles", desc: "Altars, Tenets of Akarat (Nahantu) and Chronicles of Creation (Skovos), found or not." },
  { id: "dungeon", label: "Dungeons", desc: "Dungeon entrances." },
  { id: "cellar", label: "Cellars", desc: "Cellar entrances (the map hides these until you find them)." },
  { id: "stronghold", label: "Strongholds", desc: "Where each stronghold starts." },
  { id: "side_quest", label: "Side quests", desc: "Approximate start points, drawn dimmer." },
  { id: "helltide_chest", label: "Helltide chests", desc: "Possible Tortured Gift spots, only during a Helltide and only in its zone." },
  { id: "boss_dungeon", label: "Boss lairs", desc: "Lair boss dungeons." },
  { id: "undercity", label: "Undercity", desc: "Undercity entrances." },
];

function MapPinsCard() {
  const { settings, update } = useSettings();
  const status = useMapPins((s) => s.status);
  const mp = settings.mapPins;
  const ms = (v?: number) => (v == null ? "–" : `${Math.round(v)} ms`);
  const state = !mp.enabled
    ? "Off"
    : {
        off: "Waiting for the game",
        idle: "Waiting for the map",
        menu: "A menu is open, but the map isn't recognised (yet)",
        paused: "Paused: the overlay is set to show in screenshots, so the pins would read themselves. Turn that off above.",
        tracking: `Map found: ${status.pins ?? 0} pins (${status.waypoints ?? 0} waypoints and ${status.icons ?? 0} dungeon icons matched${status.how === "pan" ? ", following the pan" : ""})`,
      }[status.state];
  return (
    <Card title="Map pins" style={{ marginTop: 14 }}>
      <div className="col">
        <Check checked={mp.enabled} onChange={(v) => update((s) => void (s.mapPins.enabled = v))} label="Draw pins on the in-game map when you open it" />
        <div className="small muted">
          Finds the map from its waypoint icons (screen capture only) and pins what you pick below at its real place. Pins disappear while you zoom and come back when the map
          settles. Zoomed all the way in, it needs a couple of waypoints or dungeons in view. Nothing is drawn unless the map is recognised for sure.
        </div>
        <div className="table-wrap" style={{ opacity: mp.enabled ? 1 : 0.5 }}>
          <table className="table">
            <tbody>
              {PIN_GROUPS.map((g) => (
                <tr key={g.id}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" disabled={!mp.enabled} checked={mp.groups[g.id]} onChange={(e) => update((s) => void (s.mapPins.groups[g.id] = e.target.checked))} />
                  </td>
                  <td>
                    <b>{g.label}</b>
                    <div className="small muted">{g.desc}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="small dim">
          {state}
          {status.captureMs != null && <> · capture {ms(status.captureMs)} · decode {ms(status.decodeMs)} · fit {ms(status.fitMs)}</>}
        </div>
      </div>
    </Card>
  );
}

export default function OverlayPage() {
  const { settings, update } = useSettings();
  const edit = useRuntime((s) => s.overlayEdit);
  const game = useRuntime((s) => s.game);
  const [msg, setMsg] = useState("");
  const [busy, setBusy] = useState(false);
  const o = settings.overlay;

  /** Find the black pillarbox bars and park widgets in them so nothing covers gameplay. */
  const dockToBars = async () => {
    setBusy(true);
    setMsg("");
    try {
      const g = await gameStatus();
      const point: [number, number] | undefined = g.rect ? [g.rect[0] + g.rect[2] / 2, g.rect[1] + g.rect[3] / 2] : undefined;
      const cap = await captureMonitor(point, { maxEdge: 1280, quality: 85 });
      const b = await detectPillarbox(cap.image);
      if (!b) {
        setMsg("The screen is mostly black right now (loading screen?) — try again in game.");
        return;
      }
      const barL = b.left,
        barR = 1 - b.right;
      if (barL < 0.04 && barR < 0.04) {
        setMsg("No black bars found — is the game in the foreground with pillarboxing? Widgets were left where they are.");
        update((s) => void (s.overlay.gameBounds = b));
        return;
      }
      const pad = 0.006;
      update((s) => {
        s.overlay.gameBounds = b;
        const W = s.overlay.widgets;
        // left bar: timers, run, farm · right bar: verdict, watchers, build, toasts
        W.timers = { ...W.timers, on: true, x: pad, y: 0.06 };
        W.run = { ...W.run, on: true, x: pad, y: 0.34 };
        W.farm = { ...W.farm, x: pad, y: 0.56 };
        W.verdict = { ...W.verdict, on: true, x: b.right + pad, y: 0.06 };
        W.watchers = { ...W.watchers, x: b.right + pad, y: 0.5 };
        W.build = { ...W.build, x: b.right + pad, y: 0.66 };
        W.toasts = { ...W.toasts, x: b.right + pad, y: 0.8 };
        // shrink widgets that wouldn't fit inside a narrow bar
        const barPx = Math.min(barL, barR) * cap.region.w;
        const scale = Math.max(0.7, Math.min(1.2, (barPx - 16) / 330));
        for (const w of Object.values(W)) w.scale = Number(scale.toFixed(2));
      });
      setMsg(
        `Game image spans ${(b.left * 100).toFixed(1)}%–${(b.right * 100).toFixed(1)}% of the screen. Widgets docked into the black bars (left ≈ ${Math.round(barL * cap.region.w)}px, right ≈ ${Math.round(barR * cap.region.w)}px).`,
      );
    } catch (e) {
      setMsg(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead
        title="Overlay"
        sub="A transparent, click-through window glued to the game. Requires Display Mode: Windowed Fullscreen (borderless) — exclusive fullscreen hides it."
      >
        <button className={"btn " + (edit ? "primary" : "gold")} onClick={() => setOverlayEdit(!edit)}>
          {edit ? "✓ Done editing" : "✥ Edit layout"} <span className="kbd">{settings.hotkeys.overlayEdit.replace("CommandOrControl", "Ctrl")}</span>
        </button>
      </PageHead>
      <div className="grid g2">
        <Card title="General">
          <div className="col">
            <Check checked={o.enabled} onChange={(v) => update((s) => void (s.overlay.enabled = v))} label="Overlay enabled" />
            <Check
              checked={o.capturable}
              onChange={(v) => {
                update((s) => void (s.overlay.capturable = v));
                setOverlayCapturable(v).catch(() => {});
              }}
              label="Show overlay in screenshots & OBS (off keeps it out of our own OCR — recommended)"
            />
            <Check checked={o.onlyWhenGameFocused} onChange={(v) => update((s) => void (s.overlay.onlyWhenGameFocused = v))} label="Only show while Diablo IV is focused" />
            <label className="field">
              Opacity {Math.round(o.opacity * 100)}%
              <input type="range" min={0.3} max={1} step={0.02} value={o.opacity} onChange={(e) => update((s) => void (s.overlay.opacity = Number(e.target.value)))} />
            </label>
            <label className="field">
              Verdict stays for {o.verdictSeconds}s
              <input type="range" min={2} max={20} value={o.verdictSeconds} onChange={(e) => update((s) => void (s.overlay.verdictSeconds = Number(e.target.value)))} />
            </label>
            <div className="small muted">
              Game window: {game?.rect ? `${game.rect[2]}×${game.rect[3]} at ${game.rect[0]},${game.rect[1]}` : "not detected"} · toggle overlay{" "}
              <span className="kbd">{settings.hotkeys.overlayToggle.replace("CommandOrControl", "Ctrl")}</span>
            </div>
          </div>
        </Card>
        <Card title="Dock into the black bars">
          <div className="col">
            <div className="small muted">
              On ultrawide monitors Diablo IV draws black bars beside the game image. Put the game in front, then click — the companion finds the bars and moves the widgets into them so they never cover gameplay.
            </div>
            <div className="row">
              <button className="btn primary" disabled={busy} onClick={dockToBars}>
                {busy ? <span className="loader" /> : "◧"} Detect bars & dock widgets
              </button>
              <button
                className="btn ghost"
                onClick={() =>
                  update((s) => {
                    s.overlay.widgets = structuredClone(defaultSettings.overlay.widgets);
                    s.overlay.gameBounds = null;
                  })
                }
              >
                Reset layout
              </button>
            </div>
            {msg && <div className="note">{msg}</div>}
            {o.gameBounds && (
              <div className="small dim mono">
                bounds L{(o.gameBounds.left * 100).toFixed(1)}% R{(o.gameBounds.right * 100).toFixed(1)}% T{(o.gameBounds.top * 100).toFixed(1)}% B{(o.gameBounds.bottom * 100).toFixed(1)}%
              </div>
            )}
          </div>
        </Card>
      </div>
      <Card title="Widgets" style={{ marginTop: 14 }}>
        <div className="table-wrap">
          <table className="table">
            <tbody>
              {WIDGETS.map((w) => (
                <tr key={w.id}>
                  <td style={{ width: 30 }}>
                    <input type="checkbox" checked={o.widgets[w.id].on} onChange={(e) => update((s) => void (s.overlay.widgets[w.id].on = e.target.checked))} />
                  </td>
                  <td>
                    <b>{w.label}</b>
                    <div className="small muted">{w.desc}</div>
                  </td>
                  <td style={{ width: 220 }}>
                    <label className="field">
                      Scale {o.widgets[w.id].scale.toFixed(2)}×
                      <input
                        type="range"
                        min={0.6}
                        max={1.8}
                        step={0.05}
                        value={o.widgets[w.id].scale}
                        onChange={(e) => update((s) => void (s.overlay.widgets[w.id].scale = Number(e.target.value)))}
                      />
                    </label>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="row" style={{ marginTop: 10 }}>
          <button className="btn sm" onClick={() => runAction("overlayToggle")}>
            Hide / show overlay now
          </button>
        </div>
      </Card>
      <MapPinsCard />
    </>
  );
}
