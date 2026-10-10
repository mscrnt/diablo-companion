import { useState } from "react";
import { Card, Empty, PageHead, timeAgo } from "../components/ui";
import { mapCharacter, mapGlyphs, mapSkills, mapStats, useCharacter } from "../lib/charmap";
import { cancelGuide, useGuide } from "../lib/guide";
import { useActiveVariant, useSettings } from "../lib/store";

export default function Character() {
  const c = useCharacter();
  const g = useGuide();
  const { variant } = useActiveVariant();
  const key = useSettings((s) => s.settings.hotkeys.judge);
  const [q, setQ] = useState("");

  // build plan vs what we read in game
  const planned = variant ? Object.entries(variant.skillRanks).filter(([slug]) => variant.skillBar.some((b) => b.slug === slug)) : [];
  const stats = Object.entries(c.stats).filter(([k]) => !q || k.toLowerCase().includes(q.toLowerCase()));
  const watch = [/minion attack speed/i, /critical strike chance/i, /critical strike damage/i, /maximum life/i, /armor/i, /resist/i, /movement speed/i];

  return (
    <>
      <PageHead title="Character" sub="Your real stats, skill ranks and glyph levels — read from the game with guided overlays, then compared to your build.">
        {g.active && g.flow === "character" ? (
          <button className="btn" onClick={cancelGuide}>
            Stop guide
          </button>
        ) : (
          <button className="btn primary" disabled={g.active} onClick={() => mapCharacter()}>
            ✦ Map my character
          </button>
        )}
      </PageHead>
      {g.active && g.flow === "character" && (
        <div className="note" style={{ marginBottom: 12 }}>
          <b>{g.instruction}</b> — {g.detail} <span className="dim">(the same instructions are on the overlay; <span className="kbd">{key}</span> = next)</span>
        </div>
      )}
      <div className="grid g3">
        <Card title="Skills" right={<button className="btn sm" disabled={g.active} onClick={() => mapSkills()}>Read</button>}>
          {planned.length ? (
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
                      <td className="mono" style={{ color: mine ? (mine.rank >= n ? "var(--green)" : "var(--gold)") : "var(--dim)" }}>
                        {mine ? `${mine.rank}${mine.max ? "/" + mine.max : ""}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty icon="📜">Import a build first.</Empty>
          )}
          <div className="small dim">Build column = points the guide puts into that skill.</div>
        </Card>

        <Card title="Paragon glyphs" right={<button className="btn sm" disabled={g.active} onClick={() => mapGlyphs()}>Read</button>}>
          {variant?.paragon.length ? (
            <table className="table">
              <thead>
                <tr>
                  <th>Board / glyph</th>
                  <th>Build</th>
                  <th>Yours</th>
                </tr>
              </thead>
              <tbody>
                {variant.paragon.map((p) => {
                  const mine = c.glyphs[p.glyphSlug];
                  return (
                    <tr key={p.slug}>
                      <td>
                        {p.glyphName}
                        <div className="small dim">{p.name}</div>
                      </td>
                      <td className="mono">{p.glyphLevel}</td>
                      <td className="mono" style={{ color: mine ? (mine.level >= p.glyphLevel ? "var(--green)" : "var(--gold)") : "var(--dim)" }}>
                        {mine ? mine.level : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <Empty icon="🔷">No paragon plan in this build.</Empty>
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
            <Empty icon="📊">Not read yet.</Empty>
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
