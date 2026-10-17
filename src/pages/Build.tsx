import { useState } from "react";
import { Anvil, Diamond, ScanEye, ScrollText, Sparkles, Star } from "lucide-react";
import { Badge, Card, Empty, PageHead, timeAgo } from "../components/ui";
import { judgingFor } from "../lib/buildlabel";
import { importMobalytics } from "../lib/mobalytics";
import { scanSkillBar, useSkillBar } from "../lib/skillbar";
import { useRuntime } from "../lib/engine";
import { describe, normName } from "../lib/names";
import { emptyProgress, useActiveVariant, useBuilds, useSettings } from "../lib/store";
import type { GearSlot, OwnState } from "../lib/types";

const STATES: OwnState[] = ["missing", "have", "upgrade", "perfect"];
const STATE_LABEL: Record<OwnState, string> = { missing: "Missing", have: "Have (rough)", upgrade: "Have (good)", perfect: "Perfect" };

export default function BuildPage() {
  const { builds, activeBuildId, setActive, removeBuild, addBuild, updates, setUpdate } = useBuilds();
  const { build, variant } = useActiveVariant();
  const flaresolverr = useSettings((s) => s.settings.flaresolverr);
  const [url, setUrl] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [tab, setTab] = useState<"gear" | "talisman" | "skills" | "paragon" | "guide">("gear");

  const doImport = async (u: string) => {
    setBusy(true);
    setMsg(null);
    try {
      const { build: b, via, defaultVariant } = await importMobalytics(u, { flaresolverr });
      addBuild(b, defaultVariant);
      setUpdate(b.id, null);
      setMsg({ ok: true, text: `Imported "${b.name}" via ${via} (${b.variants.length} variants, updated ${b.updatedAt.slice(0, 10)}).` });
      setUrl("");
    } catch (e) {
      setMsg({ ok: false, text: String((e as Error).message ?? e) });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHead title="Build" sub={build ? `${build.name} by ${build.author} · ${build.className} · ${build.season} · updated ${build.updatedAt.slice(0, 10)}` : undefined}>
        {build && (
          <button className="btn sm" disabled={busy} onClick={() => doImport(build.url || build.slug)} title="Re-fetch the latest version of this guide">
            {busy ? <span className="loader" /> : "⟳"} Refresh from Mobalytics
          </button>
        )}
      </PageHead>

      <Card>
        <div className="row">
          <input
            type="url"
            className="grow"
            placeholder="Paste a Mobalytics build URL (mobalytics.gg/diablo-4/builds/...)"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && url && doImport(url)}
          />
          <button className="btn primary" disabled={!url || busy} onClick={() => doImport(url)}>
            {busy ? <span className="loader" /> : "Import"}
          </button>
        </div>
        {msg && (
          <div className={msg.ok ? "note" : "err"} style={{ marginTop: 10 }}>
            {msg.text}
          </div>
        )}
        {build && (
          <div className="row" style={{ marginTop: 12 }}>
            {build.variants.map((v) => (
              <button key={v.id} className={"btn sm " + (v.id === variant?.id ? "gold" : "")} onClick={() => setActive(build.id, v.id)}>
                {v.name}
              </button>
            ))}
            <span className="dim small right">fetched {timeAgo(Date.parse(build.fetchedAt))}</span>
          </div>
        )}
        {build && (
          <div className="small" style={{ marginTop: 8 }}>
            Judging for: <b style={{ color: "var(--gold)" }}>{judgingFor(build.name, variant?.name)}</b>
            {build.variants.length > 1 && <span className="muted">. Pick the variant you play now: leveling and endgame want different gear.</span>}
          </div>
        )}
        {variant?.description && <div className="muted small" style={{ marginTop: 6 }}>{variant.description}</div>}
      </Card>

      <Card title={`My builds (${Object.keys(builds).length})`} style={{ marginTop: 14 }} right={<span className="small muted">the active build drives the loot judge, farm plan and overlays · other builds still get "stash it for…" advice</span>}>
        <div className="grid g3">
          {Object.values(builds).map((b) => {
            const active = b.id === activeBuildId;
            const upd = updates[b.id];
            return (
              <div key={b.id} className="slot" style={{ gridTemplateColumns: "1fr", borderColor: active ? "var(--gold)" : undefined }}>
                <div className="row" style={{ gap: 6 }}>
                  <b className={active ? "rar-unique" : ""}>{b.name}</b>
                  {active && <span className="badge" style={{ color: "var(--gold)" }}>active</span>}
                  {upd && <span className="badge" style={{ color: "var(--green)" }} title={`Updated on Mobalytics ${upd.slice(0, 10)}`}>update</span>}
                </div>
                <div className="small muted">
                  {b.className} · {b.season} · by {b.author || "?"} · updated {b.updatedAt.slice(0, 10)}
                </div>
                <div className="row" style={{ marginTop: 6 }}>
                  {!active && (
                    <button className="btn sm gold" onClick={() => setActive(b.id)}>
                      Make active
                    </button>
                  )}
                  <button className="btn sm" disabled={busy || !b.url} onClick={() => doImport(b.url || b.slug)} title="Re-fetch the latest version">
                    ⟳ Refresh
                  </button>
                  {b.url && (
                    <a className="btn ghost sm" href={b.url} target="_blank" rel="noreferrer">
                      Open
                    </a>
                  )}
                  <button className="btn ghost sm right" onClick={() => confirm(`Remove ${b.name}? Its tracked progress is kept if you re-import it.`) && removeBuild(b.id)}>
                    ✕
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      {!variant ? (
        <Empty icon={ScrollText}>Import a build to get started.</Empty>
      ) : (
        <>
          <div className="tabs" style={{ marginTop: 16 }}>
            {(["gear", "talisman", "skills", "paragon", "guide"] as const).map((t) => (
              <button key={t} className={"tab " + (tab === t ? "on" : "")} onClick={() => setTab(t)}>
                {{ gear: "Gear & Aspects", talisman: "Talisman & Chaos", skills: "Skills & Mercs", paragon: "Paragon", guide: "Guide notes" }[t]}
              </button>
            ))}
          </div>
          {tab === "gear" && <GearGrid slots={variant.gear.filter((g) => g.group === "gear")} />}
          {tab === "talisman" && <GearGrid slots={variant.gear.filter((g) => g.group !== "gear")} compact />}
          {tab === "skills" && <Skills />}
          {tab === "paragon" && <Paragon />}
          {tab === "guide" && <Guide />}
        </>
      )}
    </>
  );
}

function GearGrid({ slots, compact }: { slots: GearSlot[]; compact?: boolean }) {
  const { build, variant } = useActiveVariant();
  const progress = useBuilds((s) => s.progress);
  const setProgress = useBuilds((s) => s.setProgress);
  const prog = (slot: string) => (build && variant && progress[`${build.id}:${variant.id}:${slot}`]) || emptyProgress;
  return (
    <div className="grid g2">
      {slots.map((g) => {
        const p = prog(g.slot);
        const desc = describe(g.itemSlug);
        return (
          <div key={g.slot} className="slot">
            {g.icon ? <img src={g.icon} alt="" loading="lazy" /> : <div />}
            <div className="col" style={{ gap: 4, minWidth: 0 }}>
              <div className="row" style={{ gap: 8 }}>
                <span className="dim small">{g.slotLabel}</span>
                <span className={"nm rar-" + g.kind}>{g.itemName}</span>
                {g.kind === "mythic" && <Badge color="#e08cff">Mythic</Badge>}
                <select
                  className={"right state-" + p.state}
                  value={p.state}
                  onChange={(e) => setProgress(g.slot, { state: e.target.value as OwnState })}
                  style={{ padding: "3px 6px", fontSize: 12 }}
                >
                  {STATES.map((s) => (
                    <option key={s} value={s}>
                      {STATE_LABEL[s]}
                    </option>
                  ))}
                </select>
              </div>
              {desc && !compact && (
                <div className="small muted" style={{ maxHeight: 54, overflow: "hidden" }} title={desc}>
                  {desc}
                </div>
              )}
              {desc && compact && <div className="small muted">{desc}</div>}
              {g.affixes.map((a) => {
                const isGa = p.greater.some((x) => normName(x) === normName(a.name));
                return (
                  <div key={a.slug} className="affix">
                    {a.greater ? (
                      <label title="Tick when your item has this as a Greater Affix" style={{ cursor: "pointer" }}>
                        <input
                          type="checkbox"
                          checked={isGa}
                          onChange={(e) =>
                            setProgress(g.slot, {
                              greater: e.target.checked ? [...p.greater, a.name] : p.greater.filter((x) => normName(x) !== normName(a.name)),
                            })
                          }
                          style={{ width: 12, height: 12, verticalAlign: "middle" }}
                        />{" "}
                        <Star className="ga mark" size={11} strokeWidth={2} fill="currentColor" aria-label="greater" />
                      </label>
                    ) : (
                      <Diamond className="dim mark" size={9} strokeWidth={2} fill="currentColor" aria-hidden />
                    )}
                    <span>{a.name}</span>
                    {a.masterwork && <span className="mw">MASTERWORK</span>}
                  </div>
                );
              })}
              {g.tempers.length > 0 && (
                <div className="affix">
                  <Anvil className="mark" size={13} strokeWidth={1.75} style={{ color: "var(--orange)" }} aria-label="temper" />
                  <span>{g.tempers.map((t) => t.name).join(" · ")}</span>
                  <label className="right small muted" style={{ cursor: "pointer" }}>
                    <input type="checkbox" checked={p.tempered} onChange={(e) => setProgress(g.slot, { tempered: e.target.checked })} style={{ width: 12, height: 12 }} /> done
                  </label>
                </div>
              )}
              {g.sockets.length > 0 && (
                <div className="affix">
                  <span style={{ color: "var(--purple)" }}>⬢</span>
                  <span>{g.sockets.map((s) => s.name).join(" + ")}</span>
                </div>
              )}
              {g.extras.map((e) => (
                <div key={e.label} className="affix">
                  <Sparkles className="mark" size={12} strokeWidth={1.75} style={{ color: "#8fd3c7" }} aria-hidden />
                  <span>
                    <span className="dim">{e.label}:</span> {e.stats.map((s) => s.name).join(", ")}
                  </span>
                </div>
              ))}
              {g.group === "gear" && (
                <div className="row small muted" style={{ gap: 6 }}>
                  Masterwork
                  <input type="range" min={0} max={12} value={p.masterwork} onChange={(e) => setProgress(g.slot, { masterwork: Number(e.target.value) })} style={{ width: 120 }} />
                  <span className="mono">+{p.masterwork}</span>
                </div>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Skills() {
  const { variant } = useActiveVariant();
  const sb = useSkillBar((s) => s.last);
  const game = useRuntime((s) => s.game);
  const [checking, setChecking] = useState(false);
  if (!variant) return null;
  const order = variant.skillOrder;
  return (
    <div className="grid g2">
      <Card
        title="Skill bar"
        right={
          <button
            className="btn sm"
            disabled={!game?.rect || checking}
            title="Reads the 6 skill icons on your in-game HUD"
            onClick={async () => {
              setChecking(true);
              await scanSkillBar(game!.rect!);
              setChecking(false);
            }}
          >
            {checking ? <span className="loader" /> : <ScanEye size={15} strokeWidth={1.75} aria-hidden />} Check my bar
          </button>
        }
      >
        {sb && (
          <div className={sb.error ? "note" : sb.ok ? "note" : "err"} style={{ marginBottom: 10 }}>
            {sb.error === "hud-hidden"
              ? "Couldn't see your skill bar: close menus in game and try again."
              : sb.error
                ? sb.error
                : sb.ok
                  ? `✓ All ${sb.onBar.length} build skills are on your bar. Your key order: ${sb.onBar.map((s) => s.name).join(" → ")}`
                  : `Not on your bar: ${sb.missing.map((m) => m.name).join(", ")}. Found: ${sb.onBar.map((s) => s.name).join(", ") || "none"}.`}
            <span className="dim small"> · checked {timeAgo(sb.at)}</span>
          </div>
        )}
        <div className="col">
          {variant.skillBar.map((s) => (
            <div key={s.position} className="row" style={{ alignItems: "flex-start" }}>
              {s.icon && <img src={s.icon} width={36} height={36} style={{ borderRadius: 6, border: "1px solid var(--line)" }} />}
              <div className="grow">
                <div style={{ fontWeight: 700 }}>
                  <span className="kbd">{s.position}</span> {s.name}
                </div>
                <div className="small muted">{(describe(s.slug, "skills") ?? s.description).slice(0, 220)}</div>
              </div>
            </div>
          ))}
        </div>
        {variant.summons.length > 0 && (
          <>
            <h3 style={{ marginTop: 14 }}>Book of the Dead</h3>
            {variant.summons.map((s) => (
              <div key={s.slug} style={{ marginBottom: 8 }}>
                <div style={{ fontWeight: 700, color: "var(--gold)" }}>{s.name}</div>
                <div className="small muted pre">{s.description}</div>
              </div>
            ))}
          </>
        )}
      </Card>
      <div className="col">
        <Card title={`Skill point order (${order.length} points)`}>
          <ol style={{ margin: 0, paddingLeft: 22, columns: 2, fontSize: 12 }}>
            {order.map((s, i) => (
              <li key={i} className={s.type === "basic" ? "" : "muted"}>
                {s.name}
              </li>
            ))}
          </ol>
        </Card>
        <Card title="Mercenaries">
          <div className="col small">
            <div>
              <span className="dim">Primary:</span> <b>{variant.mercenary.primary ?? "—"}</b>: {variant.mercenary.skills.join(", ")}
            </div>
            <div>
              <span className="dim">Reinforcement:</span> <b>{variant.mercenary.reinforcement ?? "—"}</b>
              {variant.mercenary.reinforcementSkill && <>: {variant.mercenary.reinforcementSkill}</>}
            </div>
            {variant.mercenary.trigger && (
              <div>
                <span className="dim">Trigger:</span> {variant.mercenary.trigger}
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}

function Paragon() {
  const { variant } = useActiveVariant();
  if (!variant) return null;
  return (
    <div className="grid g2">
      {variant.paragon.map((p, i) => (
        <Card key={p.slug} title={`${i + 1}. ${p.name}`} right={<span className="small muted">{p.nodes.length} nodes · rot {p.rotation % 360}°</span>}>
          <div style={{ color: "var(--gold)", fontWeight: 700 }}>
            Glyph: {p.glyphName} <span className="dim">lvl {p.glyphLevel}</span>
          </div>
          <div className="small muted pre">{describe(p.glyphSlug, "glyphs")}</div>
          {(() => {
            const named = p.nodes.map((n) => ({ n, d: describe(n, "nodes") })).filter((x) => x.d);
            return named.length ? (
              <div style={{ marginTop: 8 }}>
                <div className="small dim">Notable nodes</div>
                {named.slice(0, 8).map((x) => (
                  <div key={x.n} className="small" style={{ marginTop: 4 }}>
                    • {x.d}
                  </div>
                ))}
              </div>
            ) : null;
          })()}
        </Card>
      ))}
    </div>
  );
}

function Guide() {
  const { build, variant } = useActiveVariant();
  if (!build || !variant) return null;
  const sections = [...variant.sections, ...build.sections.filter((s) => !/Aspect & Uniques/.test(s.title))];
  return (
    <div className="col">
      {sections.length === 0 && (
        <div className="note">This import has no guide text (GraphQL fast path). Use "Refresh from Mobalytics" with FlareSolverr configured to pull the author's notes.</div>
      )}
      {sections.map((s) => (
        <Card key={s.id} title={s.title}>
          <div className="pre">{s.text}</div>
        </Card>
      ))}
    </div>
  );
}
