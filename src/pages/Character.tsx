import { useState } from "react";
import { ChartColumn, Diamond, ScrollText, Sparkles } from "lucide-react";
import { Card, Empty, PageHead, timeAgo } from "../components/ui";
import { mapCharacter, mapGlyphs, mapSkills, mapStats, useCharacter } from "../lib/charmap";
import { cancelGuide, useGuide } from "../lib/guide";
import { profileLabel } from "../lib/profiles";
import { useActiveVariant, useProfiles, useSettings } from "../lib/store";

export default function Character() {
  const c = useCharacter();
  const g = useGuide();
  const { variant } = useActiveVariant();
  const who = useProfiles((s) => s.profiles[s.activeId]);
  const key = useSettings((s) => s.settings.hotkeys.judge);
  const [q, setQ] = useState("");

  // build plan vs what we read in game
  const planned = variant ? Object.entries(variant.skillRanks).filter(([slug]) => variant.skillBar.some((b) => b.slug === slug)) : [];
  const stats = Object.entries(c.stats).filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase()));
  const watch = [/summon attack speed/i, /critical strike chance/i, /critical strike damage/i, /maximum life/i, /armor/i, /resist/i, /movement speed/i];

  return (
    <>
      <PageHead title="Character" sub={`${profileLabel(who)}: real stats, skill ranks and glyph levels, read from the game with guided overlays, then compared to the build.`}>
        {g.active && g.flow === "character" ? (
          <button className="btn" onClick={cancelGuide}>
            Stop guide
          </button>
        ) : (
          <button className="btn primary" disabled={g.active} onClick={() => mapCharacter()}>
            <Sparkles size={15} strokeWidth={1.75} aria-hidden /> Map my character
          </button>
        )}
      </PageHead>
      {g.active && g.flow === "character" && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>{g.instruction}</b>: {g.detail} <span className="dim">(the same instructions are on the overlay; <span className="kbd">{key}</span> = next)</span>
        </div>
      )}
      <div className="grid g3">
        <Card title="Skills" right={<button className="btn sm" disabled={g.active} onClick={() => mapSkills()}>Read</button>}>
          {planned.length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Skill</th>
                    <th>Build</th>
                    <th>Yours</th>
                  </tr>
                </thead>
                <tbody>
                  {planned.map(([slug, n]) => {
                    const mine = c.skills[slug];
                    const name = variant!.skillBar.find((b) => b.slug === slug)?.name ?? slug;
                    return (
                      <tr key={slug}>
                        <td>{name}</td>
                        <td className="mono">{n}</td>
                        {/* points you spent vs the build's points; gear ranks shown apart */}
                        <td
                          className="mono"
                          style={{ color: mine?.rank != null ? (mine.rank >= n ? "var(--green)" : "var(--gold)") : "var(--dim)" }}
                          title={mine ? `Tooltip rank ${mine.total}${mine.max ? "/" + mine.max : ""}${mine.bonus ? ` = ${mine.rank} points + ${mine.bonus} from gear` : ""}` : undefined}
                        >
                          {!mine ? "—" : mine.rank != null ? `${mine.rank}${mine.bonus ? ` +${mine.bonus}` : ""}` : `${mine.total}?`}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={ScrollText}>Import a build first.</Empty>
          )}
          <div className="small dim">
            Build = points the guide puts into that skill. Yours = points you spent, then ranks from gear (+N).
            {planned.some(([slug]) => c.skills[slug] && c.skills[slug].rank == null) && " A ? means the gear ranks weren't read: hover that skill again."}
          </div>
        </Card>

        <Card title="Paragon glyphs" right={<button className="btn sm" disabled={g.active} onClick={() => mapGlyphs()}>Read</button>}>
          {variant?.paragon.length || Object.keys(c.glyphs).length ? (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Glyph</th>
                    <th>Build</th>
                    <th>Yours</th>
                    <th>On your boards</th>
                  </tr>
                </thead>
                <tbody>
                  {/* the build's glyphs, then the ones you use that it doesn't list */}
                  {[
                    ...(variant?.paragon ?? []).map((p) => ({ slug: p.glyphSlug, name: p.glyphName, board: p.name, want: p.glyphLevel as number | null })),
                    ...Object.entries(c.glyphs)
                      .filter(([slug]) => !(variant?.paragon ?? []).some((p) => p.glyphSlug === slug))
                      .map(([slug, g]) => ({ slug, name: g.name, board: "", want: null as number | null })),
                  ].map((row) => {
                    const mine = c.glyphs[row.slug];
                    const notUsed = mine?.active === false;
                    return (
                      <tr key={row.slug}>
                        <td>
                          {row.name}
                          <div className="small dim">{row.board || "not in the build"}</div>
                        </td>
                        <td className="mono">{row.want ?? "—"}</td>
                        <td className="mono" style={{ color: !mine ? "var(--dim)" : row.want == null || mine.level >= row.want ? "var(--green)" : "var(--gold)" }}>
                          {mine ? mine.level : "—"}
                        </td>
                        <td className="small" style={{ color: notUsed ? "var(--gold)" : mine?.active ? "var(--green)" : "var(--dim)" }}>
                          {!mine ? "not read yet" : mine.active == null ? "not checked" : mine.active ? "active" : row.want != null ? "not active: the build uses it" : "not active"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : (
            <Empty icon={Diamond}>No paragon plan in this build.</Empty>
          )}
          <div className="small dim">Level glyphs up in the Pit.</div>
        </Card>

        <Card title="Key stats" right={<button className="btn sm" disabled={g.active} onClick={() => mapStats()}>Read</button>}>
          {Object.keys(c.stats).length ? (
            <>
              {Object.entries(c.stats)
                .filter(([k]) => watch.some((w) => w.test(k)))
                .slice(0, 12)
                .map(([k, v]) => (
                  <div key={k} className="row" style={{ justifyContent: "space-between" }}>
                    <span className="small">{k}</span>
                    <span className="mono">{v}</span>
                  </div>
                ))}
              <div className="small dim" style={{ marginTop: 6 }}>
                Read {timeAgo(c.statsAt)} · {Object.keys(c.stats).length} stats
              </div>
            </>
          ) : (
            <Empty icon={ChartColumn}>Not read yet.</Empty>
          )}
        </Card>
      </div>

      {Object.keys(c.stats).length > 0 && (
        <Card title="All stats" style={{ marginTop: 14 }} right={<input type="text" placeholder="Filter…" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 200 }} />}>
          <div className="grid g3" style={{ gap: "2px 20px" }}>
            {stats.map(([k, v]) => (
              <div key={k} className="row" style={{ justifyContent: "space-between", borderBottom: "1px solid #2a2019", padding: "3px 0" }}>
                <span className="small">{k}</span>
                <span className="mono">{v}</span>
              </div>
            ))}
          </div>
        </Card>
      )}
    </>
  );
}
