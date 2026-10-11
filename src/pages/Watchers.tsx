import { useState } from "react";
import { Backpack, Coins, Eye, Flame, Hourglass, Skull, SquarePen, type LucideIcon } from "lucide-react";
import { Card, Check, Empty, Modal, PageHead, RegionPicker, timeAgo } from "../components/ui";
import { captureRegion, jpegUrl } from "../lib/native";
import { useWatchers, type Watcher } from "../lib/store";
import { sceneSignature } from "../lib/vision";

const base = (): Watcher => ({
  id: crypto.randomUUID(),
  name: "New watcher",
  enabled: true,
  rect: { x: 0, y: 0, w: 200, h: 60 },
  intervalMs: 1000,
  ocrScale: 2,
  mode: "text",
  pattern: "",
  op: ">=",
  threshold: 0,
  action: "show",
  cooldownMs: 10000,
  onlyWhenGameFocused: true,
});

const PRESETS: { label: string; icon: LucideIcon; hint: string; make: () => Watcher }[] = [
  {
    label: "Death detector",
    icon: Skull,
    hint: "Select the area where the death message appears. Logs deaths and adds them to the active run.",
    make: () => ({ ...base(), name: "Death", mode: "text", pattern: "died|killed by|you have died", action: "death", cooldownMs: 20000, intervalMs: 800 }),
  },
  {
    label: "Cinder / currency counter",
    icon: Flame,
    hint: "Select the cinder (or any number) on your HUD. Shown on the overlay; alerts at your threshold.",
    make: () => ({ ...base(), name: "Cinders", mode: "number", op: ">=", threshold: 75, action: "alert", cooldownMs: 120000, intervalMs: 1500 }),
  },
  {
    label: "Loading screen → split",
    icon: Hourglass,
    hint: "Go to a loading screen, select a stable part of it, then click 'Learn'. Each loading screen adds a split to the active run.",
    make: () => ({ ...base(), name: "Loading screen", mode: "scene", action: "runSplit", cooldownMs: 8000, intervalMs: 500, scene: { hash: "", luma: 0, maxDistance: 18 } }),
  },
  {
    label: "Inventory open → judge hint",
    icon: Backpack,
    hint: "Open your inventory, select the inventory panel header, click 'Learn'.",
    make: () => ({ ...base(), name: "Inventory open", mode: "scene", action: "judgeHint", cooldownMs: 30000, intervalMs: 700, scene: { hash: "", luma: 0, maxDistance: 16 } }),
  },
  {
    label: "Gold tracker",
    icon: Coins,
    hint: "Select your gold amount (inventory). Shown on the overlay.",
    make: () => ({ ...base(), name: "Gold", mode: "number", op: "change", threshold: 0, action: "show", intervalMs: 3000 }),
  },
  { label: "Custom", icon: SquarePen, hint: "Anything you can see on screen.", make: base },
];

export default function Watchers() {
  const { watchers, values, upsert, remove } = useWatchers();
  const [edit, setEdit] = useState<{ w: Watcher; hint: string } | null>(null);

  return (
    <>
      <PageHead
        title="Screen Watchers"
        sub="Read parts of the screen with Windows OCR or match a learned scene fingerprint, locally, a few times per second. Pure screen reading, nothing touches the game."
      />
      <Card title="Add a watcher">
        <div className="row">
          {PRESETS.map((p) => (
            <button key={p.label} className="btn" onClick={() => setEdit({ w: p.make(), hint: p.hint })}>
              <p.icon size={15} strokeWidth={1.75} style={{ color: "var(--gold)" }} aria-hidden /> {p.label}
            </button>
          ))}
        </div>
      </Card>
      <Card title="Your watchers" style={{ marginTop: 14 }}>
        {watchers.length === 0 ? (
          <Empty icon={Eye}>No watchers yet.</Empty>
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>On</th>
                  <th>Name</th>
                  <th>Mode</th>
                  <th>Action</th>
                  <th>Last read</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {watchers.map((w) => {
                  const v = values[w.id];
                  return (
                    <tr key={w.id}>
                      <td>
                        <input type="checkbox" checked={w.enabled} onChange={(e) => upsert({ ...w, enabled: e.target.checked })} />
                      </td>
                      <td>
                        <b>{w.name}</b>
                        <div className="small dim mono">
                          {w.rect.w}×{w.rect.h} @ {w.rect.x},{w.rect.y}
                        </div>
                      </td>
                      <td className="small">{w.mode}</td>
                      <td className="small">{w.action}</td>
                      <td className="small">
                        {v?.error ? (
                          <span style={{ color: "var(--blood2)" }}>{v.error.slice(0, 60)}</span>
                        ) : v ? (
                          <>
                            {w.mode === "scene" ? `distance ${v.distance ?? "?"} / ${w.scene?.maxDistance}` : w.mode === "number" ? (v.value ?? "—") : v.text.slice(0, 50) || "—"}
                            <div className="dim">
                              {timeAgo(v.at)}
                              {v.fired ? ` · fired ${timeAgo(v.fired)}` : ""}
                            </div>
                          </>
                        ) : (
                          <span className="dim">{w.onlyWhenGameFocused ? "waiting for game focus" : "—"}</span>
                        )}
                      </td>
                      <td className="nowrap">
                        <button className="btn sm" onClick={() => setEdit({ w, hint: "" })}>
                          Edit
                        </button>
                        <button className="btn ghost sm" onClick={() => remove(w.id)}>
                          ✕
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {edit && <WatcherEditor initial={edit.w} hint={edit.hint} onClose={() => setEdit(null)} onSave={(w) => (upsert(w), setEdit(null))} />}
    </>
  );
}

function WatcherEditor({ initial, hint, onClose, onSave }: { initial: Watcher; hint: string; onClose: () => void; onSave: (w: Watcher) => void }) {
  const [w, setW] = useState<Watcher>(initial);
  const [pick, setPick] = useState(false);
  const [preview, setPreview] = useState<{ img: string; text: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (p: Partial<Watcher>) => setW((x) => ({ ...x, ...p }));

  const test = async () => {
    setBusy(true);
    try {
      const cap = await captureRegion(w.rect, { ocr: w.mode !== "scene", ocrScale: w.ocrScale, maxEdge: 600, quality: 85 });
      let text = cap.ocr?.text ?? "";
      if (w.mode === "scene") {
        const sig = await sceneSignature(cap.image);
        text = `fingerprint ${sig.hash.slice(0, 12)}…  brightness ${sig.luma.toFixed(0)}`;
      }
      setPreview({ img: cap.image, text });
    } catch (e) {
      setPreview({ img: "", text: String(e) });
    } finally {
      setBusy(false);
    }
  };

  const learn = async () => {
    setBusy(true);
    try {
      const cap = await captureRegion(w.rect, { maxEdge: 96, quality: 70 });
      const sig = await sceneSignature(cap.image);
      set({ scene: { hash: sig.hash, luma: sig.luma, maxDistance: w.scene?.maxDistance ?? 18 } });
      setPreview({ img: cap.image, text: "Learned this scene ✓" });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Screen watcher">
      <div className="col" style={{ width: 620 }}>
        {hint && <div className="note">{hint}</div>}
        <div className="grid g2">
          <label className="field">
            Name
            <input type="text" value={w.name} onChange={(e) => set({ name: e.target.value })} />
          </label>
          <label className="field">
            Mode
            <select value={w.mode} onChange={(e) => set({ mode: e.target.value as Watcher["mode"] })}>
              <option value="text">Text (OCR + regex)</option>
              <option value="number">Number (OCR)</option>
              <option value="scene">Scene fingerprint</option>
            </select>
          </label>
        </div>
        <div className="row">
          <button className="btn gold" onClick={() => setPick(true)}>
            ⌖ Select screen region
          </button>
          <span className="mono small muted">
            {w.rect.w}×{w.rect.h} @ {w.rect.x},{w.rect.y}
          </span>
          <button className="btn sm right" onClick={test} disabled={busy}>
            {busy ? <span className="loader" /> : "Test read"}
          </button>
          {w.mode === "scene" && (
            <button className="btn sm primary" onClick={learn} disabled={busy}>
              Learn from current screen
            </button>
          )}
        </div>
        {preview && (
          <div className="row" style={{ alignItems: "flex-start" }}>
            {preview.img && <img src={jpegUrl(preview.img)} style={{ maxWidth: 260, maxHeight: 120, border: "1px solid var(--line)", borderRadius: 6 }} />}
            <div className="mono small pre">{preview.text || "(no text read)"}</div>
          </div>
        )}
        {w.mode === "text" && (
          <label className="field">
            Fire when OCR text matches (regex, case-insensitive)
            <input type="text" value={w.pattern} onChange={(e) => set({ pattern: e.target.value })} />
          </label>
        )}
        {w.mode === "number" && (
          <div className="row">
            <label className="field">
              Fire when value
              <select value={w.op} onChange={(e) => set({ op: e.target.value as Watcher["op"] })}>
                <option value=">=">≥</option>
                <option value="<=">≤</option>
                <option value="==">=</option>
                <option value="change">changes</option>
              </select>
            </label>
            {w.op !== "change" && (
              <label className="field">
                Threshold
                <input type="number" value={w.threshold} onChange={(e) => set({ threshold: Number(e.target.value) })} />
              </label>
            )}
          </div>
        )}
        {w.mode === "scene" && (
          <label className="field">
            Match sensitivity: max fingerprint distance ({w.scene?.maxDistance ?? 18} of 128; lower = stricter)
            <input
              type="range"
              min={4}
              max={40}
              value={w.scene?.maxDistance ?? 18}
              onChange={(e) => set({ scene: { hash: w.scene?.hash ?? "", luma: w.scene?.luma ?? 0, maxDistance: Number(e.target.value) } })}
            />
            {!w.scene?.hash && <span style={{ color: "var(--blood2)" }}>Not learned yet: show the scene in game and click "Learn".</span>}
          </label>
        )}
        <div className="grid g3">
          <label className="field">
            Action
            <select value={w.action} onChange={(e) => set({ action: e.target.value as Watcher["action"] })}>
              <option value="show">Show on overlay</option>
              <option value="alert">Alert (sound + toast)</option>
              <option value="death">Log death</option>
              <option value="runSplit">Split active run</option>
              <option value="runStart">Start a run</option>
              <option value="runStop">Finish active run</option>
              <option value="judgeHint">Judge hint</option>
            </select>
          </label>
          <label className="field">
            Check every (ms)
            <input type="number" min={250} value={w.intervalMs} onChange={(e) => set({ intervalMs: Number(e.target.value) })} />
          </label>
          <label className="field">
            Cooldown after firing (ms)
            <input type="number" min={0} value={w.cooldownMs} onChange={(e) => set({ cooldownMs: Number(e.target.value) })} />
          </label>
        </div>
        {w.mode !== "scene" && (
          <label className="field">
            OCR upscale ({w.ocrScale}×): small HUD text reads better at 2–3×
            <input type="range" min={1} max={4} step={0.5} value={w.ocrScale} onChange={(e) => set({ ocrScale: Number(e.target.value) })} />
          </label>
        )}
        <Check checked={w.onlyWhenGameFocused} onChange={(v) => set({ onlyWhenGameFocused: v })} label="Only run while Diablo IV is focused" />
        <div className="row">
          <button className="btn primary right" onClick={() => onSave(w)}>
            Save
          </button>
        </div>
      </div>
      <RegionPicker open={pick} onClose={() => setPick(false)} onPick={(r) => set({ rect: r })} />
    </Modal>
  );
}
