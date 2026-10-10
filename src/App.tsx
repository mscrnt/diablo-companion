import { useEffect, useState } from "react";
import { AppWindow, Camera, Castle, Eye, Flame, Hourglass, Map as MapIcon, Package, Scale, ScrollText, Settings, Sparkles, Swords, Timer, UserRound, type LucideIcon } from "lucide-react";
import { startEngine, useRuntime } from "./lib/engine";
import { ErrorBoundary } from "./components/ErrorBoundary";
import Welcome from "./pages/Welcome";
import { loadStaticData } from "./lib/names";
import { tidyCharacter } from "./lib/charmap";
import { APP_VERSION, RELEASES_URL } from "./lib/version";
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

const NAV: { id: PageId; label: string; ico: LucideIcon }[] = [
  { id: "dashboard", label: "Sanctuary", ico: Castle },
  { id: "guide", label: "Setup & Guide", ico: Sparkles },
  { id: "character", label: "Character", ico: UserRound },
  { id: "warplans", label: "War Plans", ico: Swords },
  { id: "timers", label: "World Events", ico: Hourglass },
  { id: "build", label: "Build", ico: ScrollText },
  { id: "farm", label: "Farm Planner", ico: MapIcon },
  { id: "loot", label: "Loot Judge", ico: Scale },
  { id: "runs", label: "Runs & Splits", ico: Timer },
  { id: "coach", label: "AI Coach", ico: Flame },
  { id: "watchers", label: "Screen Watchers", ico: Eye },
  { id: "overlay", label: "Overlay", ico: AppWindow },
  { id: "collection", label: "Collection", ico: Package },
  { id: "settings", label: "Settings", ico: Settings },
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
      tidyCharacter();
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
          <img className="brand-logo" src="/logo.png" alt="" />
          <span className="lbl">Sanctuary Toolkit</span>
          <small>Diablo IV companion</small>
          <a
            className="ver"
            href={rt.update?.url ?? RELEASES_URL}
            target="_blank"
            rel="noreferrer"
            title={rt.update ? (rt.update.installable ? `Update to v${rt.update.version}` : `v${rt.update.version} is available`) : "Release notes"}
            onClick={(e) => {
              // installable updates are applied from Settings → About
              if (rt.update?.installable) {
                e.preventDefault();
                go("settings");
              }
            }}
          >
            v{APP_VERSION}
            {rt.update && <span className="ver-new"> → v{rt.update.version}</span>}
          </a>
        </div>
        <div style={{ height: 10 }} />
        {NAV.map((n) => (
          <button key={n.id} className={"nav " + (page === n.id ? "on" : "")} onClick={() => go(n.id)} title={n.label}>
            <n.ico className="ico" size={17} strokeWidth={1.75} aria-hidden />
            <span className="lbl">{n.label}</span>
            {n.id === "coach" && pending && <span className="pill" title="Screenshot waiting">
                <Camera size={11} strokeWidth={2} aria-label="Screenshot waiting" />
              </span>}
            {n.id === "loot" && lootCount > 0 && <span className="pill">{lootCount}</span>}
          </button>
        ))}
        <div className="side-foot">
          <div title={`Diablo IV ${rt.game?.focused ? "focused" : rt.game?.running ? "running" : "not detected"}`}>
            <span className={"dot " + (rt.game?.focused ? "ok" : rt.game?.running ? "warn" : "")} />
            <span className="lbl">Diablo IV {rt.game?.focused ? "focused" : rt.game?.running ? "running" : "not detected"}</span>
          </div>
          <div title={rt.llm?.error || `LLM ${rt.llm?.ok ? "online" : "…"}`}>
            <span className={"dot " + (rt.llm?.ok ? "ok" : rt.llm ? "bad" : "")} />
            <span className="lbl">LLM {rt.llm?.ok ? "online" : rt.llm ? "offline" : "…"}</span>
          </div>
          <div title={rt.live?.error || `Live timers ${rt.live ? "synced" : "…"}`}>
            <span className={"dot " + (rt.live && !rt.live.error ? "ok" : rt.live ? "warn" : "")} />
            <span className="lbl">Live timers {rt.live && !rt.live.error ? "synced" : rt.live ? "partial" : "…"}</span>
          </div>
          {rt.hotkeyErrors.length > 0 && (
            <div title={rt.hotkeyErrors.join("\n")}>
              <span className="dot bad" />
              <span className="lbl">{rt.hotkeyErrors.length} hotkey conflict(s)</span>
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
