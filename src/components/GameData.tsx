// "Reading your Diablo IV install": the first-run step, the Settings panel and the small status
// chip the app shows while it re-reads after a game patch.
import { useEffect, useState } from "react";
import { FolderSearch, RefreshCw } from "lucide-react";
import { chooseInstall, readGameData, useGameData } from "../lib/gamedata";
import { timeAgo } from "./ui";

const SOURCE: Record<string, string> = {
  settings: "folder you picked",
  registry: "Windows install list",
  "battle.net": "Battle.net",
  common: "the usual place",
};

function ChooseFolderButton({ label = "Choose folder" }: { label?: string }) {
  const [busy, setBusy] = useState(false);
  return (
    <button
      className="btn sm"
      disabled={busy}
      onClick={async () => {
        setBusy(true);
        try {
          if (await chooseInstall()) await readGameData({ force: true });
        } catch {
          /* the error is in the store */
        } finally {
          setBusy(false);
        }
      }}
    >
      <FolderSearch size={14} /> {label}
    </button>
  );
}

/** First run, step 1: find the install and read it. */
export function GameDataStep() {
  const g = useGameData();

  useEffect(() => {
    if (g.state === "unknown" || (g.state === "missing" && g.dir)) void readGameData();
    // only on mount: the player can retry with the buttons
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="card" style={{ marginTop: 16 }}>
      <h2>1. Your Diablo IV install</h2>
      <div className="muted small" style={{ marginBottom: 8 }}>
        Item names, aspects, runes, paragon glyphs and the world map come from the game files on this PC. The app reads
        them once per patch and never changes anything in the game folder.
      </div>

      {g.state === "reading" && (
        <div className="row">
          <span className="loader" />
          <span className="small">{g.progress?.stage ?? "Reading your Diablo IV install"}</span>
          {g.progress?.total ? <span className="small muted">{Math.round(((g.progress.done ?? 0) / g.progress.total) * 100)}%</span> : null}
        </div>
      )}

      {g.state === "ready" && (
        <div className="note small">
          Read the game data from build {g.build}. {g.dir}
        </div>
      )}

      {g.state === "missing" && (
        <div className="col">
          <div className="err small">Diablo IV not found. Pick the folder that holds Diablo IV.exe.</div>
          <div className="row">
            <ChooseFolderButton />
            <button className="btn ghost sm" onClick={() => void readGameData({ force: true })}>
              Look again
            </button>
          </div>
        </div>
      )}

      {g.state === "error" && (
        <div className="col">
          <div className="err small">{g.error}</div>
          <div className="row">
            <ChooseFolderButton />
            <button className="btn ghost sm" onClick={() => void readGameData({ force: true })}>
              Try again
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/** Settings: which folder, which build, when it was last read, and a Re-read button. */
export function GameDataCard() {
  const g = useGameData();
  const [busy, setBusy] = useState(false);
  const reread = async () => {
    setBusy(true);
    try {
      await readGameData({ force: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="col">
      <label className="field">
        Diablo IV folder
        <input type="text" readOnly value={g.dir ?? ""} placeholder="not found yet" />
      </label>
      <div className="small muted">
        {g.dir && g.source ? `Found by: ${SOURCE[g.source] ?? g.source}.` : "Pick the folder that holds Diablo IV.exe."}
      </div>

      <div className="small">
        {g.state === "ready" && (
          <>
            Game data from build <b>{g.build}</b>
            {g.readAt ? `, read ${timeAgo(g.readAt)}` : ""}.
            {g.stale && g.gameBuild && g.gameBuild !== g.build ? ` The game is now on ${g.gameBuild}, reading that in the background.` : ""}
          </>
        )}
        {g.state === "reading" && (
          <span className="row">
            <span className="loader" /> {g.progress?.stage ?? "Reading"}
            {g.progress?.total ? ` ${g.progress.done ?? 0}/${g.progress.total}` : ""}
          </span>
        )}
        {g.state === "missing" && <span className="muted">No game data yet.</span>}
        {g.state === "error" && <span className="err">{g.error}</span>}
      </div>

      <div className="row">
        <button className="btn sm" disabled={busy || g.state === "reading" || !g.dir} onClick={reread}>
          <RefreshCw size={14} /> Re-read the game data
        </button>
        <ChooseFolderButton label={g.dir ? "Change folder" : "Choose folder"} />
      </div>
      <div className="small muted">
        Reading takes about a minute and uses one background thread. The copies it makes are deleted again, only the
        parsed tables stay in your AppData folder.
      </div>
    </div>
  );
}

/** The sidebar status line: quiet when the data is current, a word when it is being read. */
export function GameDataStatus() {
  const g = useGameData();
  const label =
    g.state === "reading"
      ? "Game data: reading"
      : g.state === "ready"
        ? `Game data: build ${g.build}${g.stale ? " (patch found)" : ""}`
        : g.state === "missing"
          ? "Game data: Diablo IV not found"
          : g.state === "error"
            ? "Game data: failed"
            : "Game data: …";
  const dot = g.state === "ready" ? (g.stale ? "warn" : "ok") : g.state === "reading" ? "warn" : g.state === "unknown" ? "" : "bad";
  return (
    <div title={g.state === "reading" ? (g.progress?.stage ?? label) : (g.error ?? g.dir ?? label)}>
      <span className={"dot " + dot} />
      <span className="lbl">{label}</span>
    </div>
  );
}
