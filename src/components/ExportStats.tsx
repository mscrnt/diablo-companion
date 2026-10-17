// "Export my stats": runs with splits, loot history, bests and character stats as JSON and CSV, in a zip in Downloads.
import { useState } from "react";
import { Download } from "lucide-react";
import { saveStatsExport } from "../lib/export";

export function ExportStatsButton({ className = "btn sm" }: { className?: string }) {
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const run = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const { path } = await saveStatsExport();
      setMsg({ ok: true, text: `Saved to ${path}` });
    } catch (e) {
      setMsg({ ok: false, text: `Couldn't save: ${String((e as Error).message ?? e)}` });
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <button className={className} disabled={busy} onClick={run} title="Runs with splits, loot history, bests and character stats, as JSON and CSV files in Downloads">
        {busy ? <span className="loader" /> : <Download size={14} strokeWidth={1.75} aria-hidden />} Export my stats
      </button>
      {msg && (
        <span className="small muted" style={msg.ok ? undefined : { color: "var(--blood2)" }}>
          {msg.text}
        </span>
      )}
    </>
  );
}
