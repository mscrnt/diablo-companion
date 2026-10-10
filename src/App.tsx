import { useEffect, useState } from "react";
import { startEngine, useRuntime } from "./lib/engine";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Welcome from "./pages/Welcome";
import { loadStaticData } from "./lib/names";
import { useBuilds, useCoach, useLoot } from "./lib/store";
import Dashboard from "./pages/Dashboard";
import Timers from "./pages/Timers";
import BuildPage from "./pages/Build";
import Farm from "./pages/Farm";
import Loot from "./pages/Loot";
import Runs from "./pages/Runs";
import Coach from "./pages/Coach";
import Watchers from "./pages/Watchers";
import Collection from "./pages/Collection";
import SettingsPage from "./pages/Settings";
import OverlayPage from "./pages/OverlayPage";
import GuidePage from "./pages/Guide";
import Character from "./pages/Character";
import WarPlans from "./pages/WarPlans";

export type PageId =
  | "dashboard"
  | "guide"
  | "character"
  | "warplans"
  | "timers"
  | "build"
  | "farm"
  | "loot"
  | "runs"
  | "coach"
  | "watchers"
  | "overlay"
  | "collection"
  | "settings";

const NAV: { id: PageId; label: string; ico: string }[] = [
  { id: "dashboard", label: "Sanctuary", ico: "🜏" },
  { id: "guide", label: "Setup & Guide", ico: "✦" },
  { id: "character", label: "Character", ico: "🧙" },
  { id: "warplans", label: "War Plans", ico: "🗡" },
  { id: "timers", label: "World Events", ico: "⏳" },
  { id: "build", label: "Build", ico: "📜" },
  { id: "farm", label: "Farm Planner", ico: "🗺" },
  { id: "loot", label: "Loot Judge", ico: "⚖" },
  { id: "runs", label: "Runs & Splits", ico: "⏱" },
  { id: "coach", label: "AI Coach", ico: "🕯" },
  { id: "watchers", label: "Screen Watchers", ico: "👁" },
  { id: "overlay", label: "Overlay", ico: "🪟" },
  { id: "collection", label: "Collection", ico: "📦" },
  { id: "settings", label: "Settings", ico: "⚙" },
];

export default function App() {
  const [page, setPage] = useState<PageId>("dashboard");
  const [ready, setReady] = useState(false);
  const [welcome, setWelcome] = useState(false);
  const rt = useRuntime();
  const pending = useCoach((s) => s.pendingImage);
  const lootCount = useLoot((s) => s.history.filter((h) => Date.now() - h.at < 3600_000).length);

  useEffect(() => {
    (async () => {
      await loadStaticData();
      // wait for persisted builds, then seed the user's build on first run
      if (!useBuilds.persist.hasHydrated()) await new Promise<void>((r) => useBuilds.persist.onFinishHydration(() => r()));
      if (!Object.keys(useBuilds.getState().builds).length) setWelcome(true);
      setReady(true);
      startEngine();
    })();
  }, []);

  const go = (p: PageId) => setPage(p);
  if (!ready)
    return (
      <div style={{ display: "grid", placeItems: "center", height: "100%" }}>
        <div className="row">
          <span className="loader" /> Summoning…
        </div>
      </div>
    );

  if (welcome)
    return (
      <div className="main" style={{ height: "100%" }}>
        <Welcome onDone={() => setWelcome(false)} />
      </div>
    );

  return (
    <div className="shell">
      <nav className="side">
        <div className="brand">
          D4 Companion
          <small>Sanctuary toolkit</small>
        </div>
        <div style={{ height: 10 }} />
        {NAV.map((n) => (
          <button key={n.id} className={"nav " + (page === n.id ? "on" : "")} onClick={() => go(n.id)}>
            <span className="ico">{n.ico}</span>
            {n.label}
            {n.id === "coach" && pending && <span className="pill">📷</span>}
            {n.id === "loot" && lootCount > 0 && <span className="pill">{lootCount}</span>}
          </button>
        ))}
        <div className="side-foot">
          <div>
            <span className={"dot " + (rt.game?.focused ? "ok" : rt.game?.running ? "warn" : "")} />
            Diablo IV {rt.game?.focused ? "focused" : rt.game?.running ? "running" : "not detected"}
          </div>
          <div title={rt.llm?.error}>
            <span className={"dot " + (rt.llm?.ok ? "ok" : rt.llm ? "bad" : "")} />
            LLM {rt.llm?.ok ? "online" : rt.llm ? "offline" : "…"}
          </div>
          <div title={rt.live?.error}>
            <span className={"dot " + (rt.live && !rt.live.error ? "ok" : rt.live ? "warn" : "")} />
            Live timers {rt.live && !rt.live.error ? "synced" : rt.live ? "partial" : "…"}
          </div>
          {rt.hotkeyErrors.length > 0 && (
            <div title={rt.hotkeyErrors.join("\n")}>
              <span className="dot bad" />
              {rt.hotkeyErrors.length} hotkey conflict(s)
            </div>
          )}
        </div>
      </nav>
      <main className="main">
        <ErrorBoundary name={page} onBack={() => setPage("dashboard")}>
        {page === "dashboard" && <Dashboard go={go} />}
        {page === "guide" && <GuidePage />}
        {page === "character" && <Character />}
        {page === "warplans" && <WarPlans />}
        {page === "timers" && <Timers />}
        {page === "build" && <BuildPage />}
        {page === "farm" && <Farm />}
        {page === "loot" && <Loot />}
        {page === "runs" && <Runs />}
        {page === "coach" && <Coach />}
        {page === "watchers" && <Watchers />}
        {page === "overlay" && <OverlayPage />}
        {page === "collection" && <Collection />}
        {page === "settings" && <SettingsPage />}
        </ErrorBoundary>
      </main>
    </div>
  );
}
