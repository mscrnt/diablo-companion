import { useState } from "react";
import { importMobalytics, normaliseMobalytics } from "../lib/mobalytics";
import { listModels } from "../lib/llm";
import { useBuilds, useSettings } from "../lib/store";

/** First run: pick a build (any Mobalytics URL) and, optionally, connect an AI model. */
export default function Welcome({ onDone }: { onDone: () => void }) {
  const { settings, update } = useSettings();
  const addBuild = useBuilds((s) => s.addBuild);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [llmMsg, setLlmMsg] = useState("");

  const doImport = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { build, defaultVariant } = await importMobalytics(url, { flaresolverr: settings.flaresolverr || undefined, prefer: settings.flaresolverr ? "full" : "fast" });
      addBuild(build, defaultVariant);
      setMsg({ ok: true, text: `Imported "${build.name}" (${build.className}, ${build.season}).` });
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  const example = async () => {
    const raw = (await import("../seed/necromancer-mages-necro-guide.json")).default;
    addBuild(normaliseMobalytics(raw, "https://mobalytics.gg/diablo-4/builds/necromancer-mages-necro-guide"), "1");
    setMsg({ ok: true, text: "Loaded the example Necromancer build." });
  };

  const testLlm = async () => {
    setLlmMsg("…");
    try {
      const models = await listModels(settings.llm);
      setLlmMsg(`Connected ✓ ${models.join(", ")}`);
      if (models[0] && !settings.llm.model) update((s) => void (s.llm.model = models[0]));
    } catch (e) {
      setLlmMsg(String((e as Error).message ?? e));
    }
  };

  const hasBuild = Object.keys(useBuilds.getState().builds).length > 0;

  return (
    <div style={{ maxWidth: 860, margin: "30px auto" }}>
      <h1 style={{ fontFamily: "var(--display)", color: "var(--gold)" }}>Welcome to Sanctuary Toolkit</h1>
      <p className="muted">It reads your screen (no game memory, no input) and helps with loot, events, the Pit, Hordes, Helltides and more: tuned to the build you play.</p>

      <div className="card" style={{ marginTop: 16 }}>
        <h2>1. Your build</h2>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Paste any Mobalytics Diablo 4 build link (mobalytics.gg/diablo-4/builds/… or a profile build). You can add more builds later and switch between them.
        </div>
        <div className="row">
          <input type="url" className="grow" placeholder="https://mobalytics.gg/diablo-4/builds/…" value={url} onChange={(e) => setUrl(e.target.value)} onKeyDown={(e) => e.key === "Enter" && url && doImport()} />
          <button className="btn primary" disabled={!url || busy} onClick={doImport}>
            {busy ? <span className="loader" /> : "Import"}
          </button>
          <button className="btn ghost" onClick={example}>
            Use the example build
          </button>
        </div>
        {msg && <div className={msg.ok ? "note" : "err"} style={{ marginTop: 8 }}>{msg.text}</div>}
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>2. AI model (optional)</h2>
        <div className="muted small" style={{ marginBottom: 8 }}>
          The loot judge, timers, trackers and overlays work without AI. A local OpenAI-compatible server (vLLM, LM Studio, Ollama, llama.cpp) adds the AI Coach, session plans and a fallback for odd tooltips. A vision model (e.g. Qwen-VL) is best.
        </div>
        <div className="grid g2">
          <label className="field">
            Server URL (…/v1)
            <input type="url" placeholder="http://localhost:1234/v1" value={settings.llm.baseUrl} onChange={(e) => update((s) => void (s.llm.baseUrl = e.target.value))} />
          </label>
          <label className="field">
            Model name
            <input type="text" placeholder="(auto-detected)" value={settings.llm.model} onChange={(e) => update((s) => void (s.llm.model = e.target.value))} />
          </label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <button className="btn sm" disabled={!settings.llm.baseUrl} onClick={testLlm}>
            Test connection
          </button>
          <span className="small muted">{llmMsg}</span>
        </div>
      </div>

      <div className="card" style={{ marginTop: 14 }}>
        <h2>3. In game</h2>
        <ul className="small" style={{ margin: 0, paddingLeft: 18 }}>
          <li>Set Display Mode to <b>Windowed Fullscreen</b> so the overlay can draw.</li>
          <li>Open your inventory and hover your equipped gear once: the app learns what you're wearing.</li>
          <li>Hover any item: the badge tells you what to do with it. F8 judges on demand, F6 snoozes, F7 maps your character.</li>
        </ul>
      </div>

      <div className="row" style={{ marginTop: 16 }}>
        <button className="btn primary right" disabled={!hasBuild && !msg?.ok} onClick={onDone}>
          Start →
        </button>
      </div>
    </div>
  );
}
