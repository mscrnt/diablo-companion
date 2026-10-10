import { useEffect, useRef, useState } from "react";
import { Brain, Camera, X } from "lucide-react";
import { Card, Check, PageHead } from "../components/ui";
import { runAction, useRuntime } from "../lib/engine";
import { farmContext } from "../lib/farm";
import { characterContext } from "../lib/charmap";
import { chatStream, imagePart, type ChatMessage } from "../lib/llm";
import { captureMonitor, jpegUrl } from "../lib/native";
import { emptyProgress, useActiveVariant, useBuilds, useCoach, useLoot, useRuns, useSettings } from "../lib/store";

function buildSummary() {
  const { builds, activeBuildId, activeVariantId, progress } = useBuilds.getState();
  const build = activeBuildId ? builds[activeBuildId] : undefined;
  const v = build?.variants.find((x) => x.id === activeVariantId) ?? build?.variants[0];
  if (!build || !v) return "No build imported.";
  const prog = (slot: string) => progress[`${build.id}:${v.id}:${slot}`] ?? emptyProgress;
  const gear = v.gear
    .map((g) => {
      const p = prog(g.slot);
      return `- ${g.slotLabel}: ${g.itemName} (${g.kind}) [player: ${p.state}${p.greater.length ? ", GA: " + p.greater.join("/") : ""}${p.masterwork ? ", MW+" + p.masterwork : ""}] affixes: ${g.affixes.map((a) => a.name + (a.greater ? "*" : "") + (a.masterwork ? "(MW)" : "")).join(", ")}${g.tempers.length ? " | temper: " + g.tempers.map((t) => t.name).join(", ") : ""}${g.sockets.length ? " | sockets: " + g.sockets.map((s) => s.name).join(", ") : ""}`;
    })
    .join("\n");
  const notes = v.sections.map((s) => `## ${s.title}\n${s.text}`).join("\n\n").slice(0, 6000);
  const general = build.sections
    .filter((s) => /Overview|Frequently|Strength/i.test(s.title))
    .map((s) => `## ${s.title}\n${s.text}`)
    .join("\n\n")
    .slice(0, 3000);
  return `BUILD: ${build.name} by ${build.author} (${build.className}, ${build.season}), variant "${v.name}".
Skill bar: ${v.skillBar.map((s) => s.name).join(", ")}
Book of the Dead: ${v.summons.map((s) => s.name).join(", ")}
Paragon: ${v.paragon.map((p) => `${p.name} (glyph ${p.glyphName} ${p.glyphLevel})`).join(" → ")}
Mercenaries: ${v.mercenary.primary} + ${v.mercenary.reinforcement}
GEAR (* = greater affix target, MW = masterwork target):
${gear}

AUTHOR NOTES:
${notes}

${general}`;
}

export default function Coach() {
  const { messages, push, patchLast, clear, pendingImage, setPendingImage } = useCoach();
  const { settings, update } = useSettings();
  const events = useRuntime((s) => s.events);
  const { variant, build } = useActiveVariant();
  const progress = useBuilds((s) => s.progress);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [thinking, setThinking] = useState("");
  const abort = useRef<AbortController | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  // braces matter: newer WebView2 returns a Promise from scrollIntoView, and React would
  // treat a returned value as the effect's cleanup function ("destroy is not a function")
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, thinking]);

  const send = async (text: string) => {
    if (!text.trim() && !pendingImage) return;
    const img = pendingImage;
    setPendingImage(null);
    setInput("");
    push({ role: "user", text, image: img ?? undefined, at: Date.now() });
    push({ role: "assistant", text: "", at: Date.now() });
    setBusy(true);
    setThinking("");
    const prog = (slot: string) => (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
    const loot = useLoot
      .getState()
      .history.slice(0, 6)
      .map((l) => `- ${l.verdict}: ${l.item.name} (${l.item.itemType})`)
      .join("\n");
    const runs = useRuns
      .getState()
      .runs.slice(0, 8)
      .map((r) => `- ${r.activity} ${r.tier ?? ""}: ${r.end ? Math.round((r.end - r.start) / 1000) + "s" : "?"}`)
      .join("\n");
    const system = `You are an expert Diablo IV (Season 15) coach embedded in a companion app. Be practical and specific to the player's build. Prefer short bullet answers. If you are not sure about a game fact (drop locations, numbers, patch changes), say so instead of guessing. When given a screenshot, read it carefully (tooltips, character sheet, paragon) before answering.

${buildSummary()}

${farmContext(variant, prog, events)}

${characterContext() || "(character not mapped yet — suggest the Character page's 'Map my character' if stats matter)"}

RECENT LOOT:
${loot || "(none)"}

RECENT RUNS:
${runs || "(none)"}`;
    const history: ChatMessage[] = useCoach
      .getState()
      .messages.slice(-14, -1)
      .map((m) =>
        m.role === "user" && m.image
          ? { role: "user", content: [imagePart(m.image), { type: "text", text: m.text || "What do you see? Advise me." }] }
          : { role: m.role, content: m.text },
      );
    abort.current = new AbortController();
    let out = "";
    try {
      await chatStream(
        settings.llm,
        [{ role: "system", content: system }, ...history],
        (t, kind) => {
          if (kind === "reasoning") setThinking((x) => x + t);
          else {
            out += t;
            patchLast(out);
          }
        },
        { thinking: settings.llm.thinkingForCoach, signal: abort.current.signal, maxTokens: settings.llm.thinkingForCoach ? 6000 : 2000 },
      );
    } catch (e) {
      if ((e as Error).name !== "AbortError") patchLast(out + `\n\n⚠ ${String((e as Error).message ?? e)}`);
    } finally {
      setBusy(false);
      setThinking("");
    }
  };

  const snap = async () => {
    const cap = await captureMonitor(undefined, { maxEdge: 1920, quality: 85 });
    setPendingImage(cap.image);
  };

  const quick = [
    "What should I farm next and why?",
    "Explain the rotation and what to watch for in high Pit/Tower tiers.",
    "My damage feels low — what's the most likely cause given my gear?",
    "Is anything in this guide contradictory or outdated for this season?",
  ];

  return (
    <>
      <PageHead title="AI Coach" sub={`Chat with ${settings.llm.model ? settings.llm.model.split("/").pop() : "your local AI model"}. It knows your build, gear progress, loot, runs and the event schedule.`}>
        <Check checked={settings.llm.thinkingForCoach} onChange={(v) => update((s) => void (s.llm.thinkingForCoach = v))} label="Deep thinking" />
        <button className="btn ghost sm" onClick={() => confirm("Clear conversation?") && clear()}>
          Clear
        </button>
      </PageHead>
      <Card>
        <div className="chat" style={{ minHeight: 300 }}>
          {messages.length === 0 && (
            <div className="col">
              <div className="muted">Try one of these, or attach a screenshot (character sheet, paragon, a tooltip):</div>
              <div className="row">
                {quick.map((q) => (
                  <button key={q} className="btn sm" onClick={() => send(q)}>
                    {q}
                  </button>
                ))}
              </div>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={"msg " + m.role}>
              {m.image && <img src={jpegUrl(m.image)} />}
              {m.text || (busy && i === messages.length - 1 ? <span className="loader" /> : "")}
            </div>
          ))}
          {thinking && (
            <div className="msg assistant small dim" style={{ maxHeight: 120, overflow: "auto" }}>
              <Brain className="i" size={13} strokeWidth={1.75} aria-label="thinking" /> {thinking.slice(-600)}
            </div>
          )}
          <div ref={endRef} />
        </div>
        {pendingImage && (
          <div className="row" style={{ marginTop: 10 }}>
            <img src={jpegUrl(pendingImage)} style={{ height: 60, borderRadius: 6, border: "1px solid var(--line)" }} />
            <span className="small muted">Screenshot attached</span>
            <button className="btn ghost sm" onClick={() => setPendingImage(null)} title="Remove screenshot">
              <X size={14} strokeWidth={2} aria-label="Remove" />
            </button>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn" onClick={snap} title={`Attach a screenshot (or press ${settings.hotkeys.coachSnap} in game)`}>
            <Camera size={16} strokeWidth={1.75} aria-label="Attach screenshot" />
          </button>
          <input
            type="text"
            className="grow"
            placeholder="Ask about your build, gear, farming…"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && !busy && send(input)}
          />
          {busy ? (
            <button className="btn" onClick={() => abort.current?.abort()}>
              Stop
            </button>
          ) : (
            <button className="btn primary" onClick={() => send(input)}>
              Send
            </button>
          )}
        </div>
        <div className="small dim" style={{ marginTop: 6 }}>
          In game: press <span className="kbd">{settings.hotkeys.coachSnap.replace("CommandOrControl", "Ctrl")}</span> to grab a screenshot for the coach, or{" "}
          <button className="btn ghost sm" onClick={() => runAction("coachSnap")}>
            grab now
          </button>
        </div>
      </Card>
    </>
  );
}
