import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import type { OverlayToast } from "../lib/alerts";
import type { Prelim, TooltipBox } from "../lib/autojudge";
import { emitMain, onOverlay } from "../lib/bus";
import type { OverlayState } from "../lib/engine";
import type { GuideState } from "../lib/guide";
import type { HordesState } from "../lib/hordesRunner";
import type { AdvisorState } from "../lib/activity";
import type { HelltideInfo } from "../lib/helltide";
import type { BossInfo } from "../lib/boss";
import type { MapPinsFrame } from "../lib/mapPinsRunner";
import type { PoiKind } from "../lib/mappins";
import { BookOpen, Castle, CircleCheck, DoorOpen, Eye, Flame, Gem, Landmark, MapPin, Package, ScrollText, Skull, Sparkles, Star, TreeDeciduous, Warehouse, type LucideIcon } from "lucide-react";
import { VERDICT_STYLE } from "../lib/judge";
import { EVENT_META, fmtCountdown, isActive } from "../lib/timers";
import type { JudgeResult } from "../lib/types";
import { cssToScreen, installDebugHooks, type Box, type OverlayRender, type RenderedElement } from "../lib/debugcore";

// Debug: this window's errors and what it draws go to the main window's event log (the overlay is
// hidden from screen capture, so this is the only way to see it). At most 10 events a second.
let dbgCount = 0;
let dbgWindow = 0;
function sendDebug(type: string, data?: Record<string, unknown>, src = "overlay") {
  const t = Date.now();
  if (t - dbgWindow > 1000) {
    dbgWindow = t;
    dbgCount = 0;
  }
  if (++dbgCount > 10) return;
  emitMain("debug-event", { src, type, data });
}
installDebugHooks((type, data) => sendDebug(type, { ...data, window: "overlay" }, "error"));

/** Where the overlay's CSS px sit on screen: the game window's corner (the overlay is glued to it). */
function overlayOrigin(st: OverlayState): [number, number] {
  const dpr = window.devicePixelRatio || 1;
  return [st.gameRect?.[0] ?? Math.round(window.screenX * dpr), st.gameRect?.[1] ?? Math.round(window.screenY * dpr)];
}

/** An element's box in overlay CSS px and absolute screen px. */
function measure(el: Element | null, st: OverlayState): { css: Box; screen: Box } | null {
  if (!el) return null;
  const r = el.getBoundingClientRect();
  const css = { x: Math.round(r.left), y: Math.round(r.top), w: Math.round(r.width), h: Math.round(r.height) };
  return { css, screen: cssToScreen(css, overlayOrigin(st), window.devicePixelRatio || 1) };
}

interface RenderInputs {
  tip: TooltipEvt | null;
  verdict: JudgeResult | null;
  toasts: OverlayToast[];
  judging: boolean;
  guide: GuideState | null;
  hordes: HordesState | null;
  advisor: AdvisorState | null;
  helltide: HelltideInfo | null;
  boss: BossInfo | null;
  mapPins: MapPinsFrame | null;
}

/** What this window is drawing right now, measured from the DOM (elements tagged data-dbg). */
function collectRender(st: OverlayState, x: RenderInputs): OverlayRender {
  const dpr = window.devicePixelRatio || 1;
  const bars = st.settings.layout === "bars" && !!st.settings.gameBounds && st.settings.gameBounds.left > 0.03;
  const guideOn = !!x.guide?.active;
  const visible = st.visible || guideOn;
  const elements: RenderedElement[] = [];
  document.querySelectorAll<HTMLElement>("[data-dbg]").forEach((el) => {
    const m = measure(el, st);
    if (!m || (m.css.w === 0 && m.css.h === 0)) return;
    const kids = [...el.querySelectorAll<HTMLElement>("[data-dbg]")].map((k) => k.dataset.dbg!);
    elements.push({ id: el.dataset.dbg!, ...m, ...(kids.length ? { children: kids } : { text: (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 200) }) });
  });
  return {
    at: Date.now(),
    window: { css: { x: window.screenX, y: window.screenY, w: window.innerWidth, h: window.innerHeight }, dpr, origin: overlayOrigin(st), gameRect: st.gameRect },
    visible,
    opacity: visible ? st.settings.opacity : 0,
    edit: st.edit,
    layout: bars ? "bars" : "free",
    gameBounds: st.settings.gameBounds,
    verdictCard: x.tip && { state: x.tip.state, quiet: !!x.tip.quiet, verdict: x.tip.verdict?.verdict, action: x.tip.verdict?.action?.slice(0, 160), tooltipBox: x.tip.box },
    verdictPanel: x.verdict && { verdict: x.verdict.verdict, item: x.verdict.item.name, judgedAt: x.verdict.at },
    judging: x.judging,
    toasts: x.toasts.map((t) => ({ title: t.title, body: t.body?.slice(0, 120) })),
    mapPins: x.mapPins && { pins: x.mapPins.pins.length, clip: x.mapPins.clip, hud: x.mapPins.hud.length, zoom: Math.round(x.mapPins.zoom * 100) / 100, label: x.mapPins.label, drawn: st.visible && !guideOn },
    guide: guideOn && x.guide ? { title: x.guide.title, step: x.guide.step, steps: x.guide.steps, instruction: x.guide.instruction.slice(0, 160), highlights: x.guide.highlights.length } : null,
    hordes: x.hordes?.active ? { aether: x.hordes.aether, offers: x.hordes.offers.map((o) => ({ title: o.title, rank: o.rank })), chests: x.hordes.chests.map((c) => ({ name: c.name, order: c.order })) } : null,
    advisor: x.advisor && { title: x.advisor.title, items: x.advisor.items.map((i) => ({ name: i.name, rank: i.rank })) },
    helltide: x.helltide?.active ? { cinders: x.helltide.cinders, secondsLeft: x.helltide.secondsLeft, best: x.helltide.best?.name ?? null } : null,
    boss: x.boss?.name ?? null,
    elements,
  };
}

interface TooltipEvt {
  box: TooltipBox;
  quiet?: boolean;
  state: "reading" | "judging" | "done";
  prelim?: Prelim;
  verdict?: JudgeResult;
}

/** Lucide icon for the overlay: inline with the text, thicker stroke and a shadow so it reads over the game. */
function Ico({ icon: I, size = 14, style }: { icon: LucideIcon; size?: number; style?: CSSProperties }) {
  return <I className="i" size={size} strokeWidth={2} aria-hidden style={style} />;
}

const fmt = (ms: number) => {
  const s = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
};

export default function Overlay() {
  const [st, setSt] = useState<OverlayState | null>(null);
  const [verdict, setVerdict] = useState<JudgeResult | null>(null);
  const [toasts, setToasts] = useState<OverlayToast[]>([]);
  const [judging, setJudging] = useState(false);
  const [tip, setTip] = useState<TooltipEvt | null>(null);
  const [guide, setGuide] = useState<GuideState | null>(null);
  const [hordes, setHordes] = useState<HordesState | null>(null);
  const [advisor, setAdvisor] = useState<AdvisorState | null>(null);
  const [helltide, setHelltide] = useState<HelltideInfo | null>(null);
  const [boss, setBoss] = useState<BossInfo | null>(null);
  const [mapPins, setMapPins] = useState<(MapPinsFrame & { labelUntil?: number }) | null>(null);
  const [now, setNow] = useState(Date.now());
  const vTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const tipTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const pinTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const stRef = useRef(st);
  stRef.current = st;

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 250);
    const subs = [
      onOverlay<OverlayState>("state", setSt),
      onOverlay<JudgeResult>("verdict", (v) => {
        setVerdict(v);
        clearTimeout(vTimer.current);
        // clears after "verdict stays for N s" (Overlay settings), in every layout
        vTimer.current = setTimeout(() => setVerdict(null), (stRef.current?.settings.verdictSeconds ?? 7) * 1000);
      }),
      onOverlay<OverlayToast>("toast", (x) => {
        sendDebug("toast", { title: x.title, body: x.body?.slice(0, 100), ttl: x.ttl, shown: !!stRef.current?.settings.widgets.toasts.on });
        setToasts((ts) => [...ts.slice(-3), x]);
        setTimeout(() => setToasts((ts) => ts.filter((y) => y.id !== x.id)), x.ttl);
      }),
      onOverlay<boolean>("judging", setJudging),
      onOverlay<TooltipEvt | null>("tooltip", (t) => {
        setTip(t);
        clearTimeout(tipTimer.current);
        // ground-loot badges vanish quickly so they don't clutter fights
        if (t?.quiet && t.state === "done") tipTimer.current = setTimeout(() => setTip(null), (stRef.current?.worldBadgeSeconds ?? 3) * 1000);
      }),
      onOverlay<GuideState>("guide", setGuide),
      onOverlay<HordesState>("hordes", setHordes),
      onOverlay<AdvisorState | null>("advisor", setAdvisor),
      onOverlay<HelltideInfo>("helltide", setHelltide),
      onOverlay<BossInfo | null>("boss", setBoss),
      onOverlay<MapPinsFrame | null>("mappins", (m) => {
        // pins that aren't refreshed go by themselves (the map may have closed while the main window stalled)
        clearTimeout(pinTimer.current);
        setMapPins(m && { ...m, labelUntil: m.labelMs != null ? Date.now() + m.labelMs : undefined });
        if (m) pinTimer.current = setTimeout(() => setMapPins(null), m.ttl || 1500);
      }),
      // the main window wants the render state now (a mark, or the Debug page)
      onOverlay<boolean>("debug-request", () => {
        dbgReq.current = true;
        setNow(Date.now());
      }),
    ];
    emitMain("overlay-ready", true);
    return () => {
      clearInterval(t);
      subs.forEach((p) => p.then((u) => u()));
    };
  }, []);

  // debug: report what is drawn (test mode / Debug page: at most once a second, when it changed; else on request)
  const dbgReq = useRef(false);
  const dbgLast = useRef({ key: "", at: 0 });
  useEffect(() => {
    if (!st || (!st.debug && !dbgReq.current)) return;
    const t = Date.now();
    if (!dbgReq.current && t - dbgLast.current.at < 1000) return;
    const rep = collectRender(st, { tip, verdict, toasts, judging, guide, hordes, advisor, helltide, boss, mapPins });
    const key = JSON.stringify({ ...rep, at: 0 });
    if (!dbgReq.current && key === dbgLast.current.key) return;
    dbgReq.current = false;
    dbgLast.current = { key, at: t };
    emitMain("overlay-debug", rep);
  });

  // debug: the verdict card beside the tooltip, and the verdict panel, shown / hidden (with where)
  const tipKey = tip ? `${tip.state}|${tip.verdict?.verdict ?? ""}|${tip.box.x},${tip.box.y}` : "";
  const hadTip = useRef(false);
  useEffect(() => {
    if (!st || (!tipKey && !hadTip.current)) return;
    hadTip.current = !!tipKey;
    if (!tip) return sendDebug("verdict-card-hidden");
    const info = { state: tip.state, quiet: !!tip.quiet, verdict: tip.verdict?.verdict, action: tip.verdict?.action?.slice(0, 120), tooltipBox: tip.box, overlayVisible: st.visible || !!guide?.active };
    // measured once its pop-in animation (150 ms, scaled) has finished
    const t = setTimeout(() => sendDebug("verdict-card-shown", { ...info, ...measure(document.querySelector('[data-dbg="verdict-card"]'), st) }), 200);
    return () => clearTimeout(t);
  }, [tipKey]);
  const hadVerdict = useRef(false);
  useEffect(() => {
    if (!st || (!verdict && !hadVerdict.current)) return;
    hadVerdict.current = !!verdict;
    if (!verdict) return sendDebug("verdict-hidden");
    sendDebug("verdict-shown", {
      verdict: verdict.verdict,
      item: verdict.item.name,
      widgetOn: st.settings.widgets.verdict.on,
      ...measure(document.querySelector('[data-dbg="verdict-panel"]'), st),
      overlayVisible: st.visible || !!guide?.active,
    });
  }, [verdict?.id]);

  if (!st) return null;
  const dpr = window.devicePixelRatio || 1;
  // absolute physical screen px → overlay CSS px
  const toCss = (b: { x: number; y: number; w: number; h: number }): CSSProperties => {
    const ox = st.gameRect?.[0] ?? window.screenX * dpr;
    const oy = st.gameRect?.[1] ?? window.screenY * dpr;
    return { left: (b.x - ox) / dpr, top: (b.y - oy) / dpr, width: b.w / dpr, height: b.h / dpr };
  };
  const bars = st.settings.layout === "bars" && !!st.settings.gameBounds && st.settings.gameBounds.left > 0.03;
  const guideOn = !!guide?.active;
  const visible = st.visible || guideOn;

  const panels = {
    timers: st.settings.widgets.timers.on && <TimersPanel st={st} now={now} big={bars} />,
    run: st.settings.widgets.run.on && (st.run || st.edit) && <RunPanel st={st} now={now} big={bars} />,
    farm: st.settings.widgets.farm.on && st.farm.length > 0 && <FarmPanel st={st} />,
    build: st.settings.widgets.build.on && st.build && <BuildPanel st={st} />,
    watchers: st.settings.widgets.watchers.on && (st.watchers.length > 0 || st.edit) && <WatchersPanel st={st} />,
    verdict:
      st.settings.widgets.verdict.on &&
      (judging && !verdict ? (
        <div className="ov-panel row" data-dbg="panel:reading">
          <span className="loader" /> Reading tooltip…
        </div>
      ) : verdict ? (
        <VerdictPanel v={verdict} detailed={bars} judging={judging} />
      ) : bars ? (
        <div className="ov-panel small muted" data-dbg="panel:loot-hint">
          {helltide?.active && helltide.best && (
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #3a2c22" }}>
          <div className="ov-title"><Ico icon={Flame} size={13} /> Helltide · {helltide.cinders ?? "?"} cinders</div>
          <div style={{ fontWeight: 800, color: helltide.cinders != null && helltide.cinders >= helltide.best.cost ? "var(--green)" : "var(--gold)", fontSize: 15 }}>
            {helltide.cinders != null && helltide.cinders >= helltide.best.cost ? <><Ico icon={CircleCheck} size={15} /> Open: </> : "Next: "}
            {helltide.best.name.replace("Tortured Gift of ", "")} ({helltide.best.cost})
          </div>
        </div>
      )}
      {advisor && advisor.items[0] && (
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #3a2c22" }}>
          <div className="ov-title"><Ico icon={TreeDeciduous} size={13} /> {advisor.title}</div>
          <div style={{ fontWeight: 800, color: "var(--green)", fontSize: 16 }}><Ico icon={CircleCheck} size={16} /> Take: {advisor.items[0].name}</div>
          <div className="small">{advisor.items[0].why}</div>
        </div>
      )}
      <div className="ov-title">Loot judge</div>
          {st.autoJudge ? "Hover any item — I'll tell you what to do with it." : "Hover an item and press the judge key."}
        </div>
      ) : st.edit ? (
        <div className="ov-panel small muted" data-dbg="panel:loot-placeholder">Loot verdicts appear here</div>
      ) : null),
    toasts: st.settings.widgets.toasts.on && toasts.length > 0 && (
      <div>
        {toasts.map((t) => (
          <div key={t.id} className="ov-panel ov-toast" data-dbg="toast" style={{ borderLeftColor: t.color ?? "var(--gold)" }}>
            <b>{t.title}</b>
            {t.body && <div className="small muted">{t.body}</div>}
          </div>
        ))}
      </div>
    ),
  };

  return (
    <div className={"ov-root " + (st.edit ? "edit" : "")} style={{ opacity: visible ? st.settings.opacity : 0, transition: "opacity .15s" }}>
      {st.edit && (
        <div className="ov-bar">
          <b style={{ color: "var(--gold)" }}>Overlay edit mode</b>
          <span className="small muted">{bars ? "Bar layout is automatic — switch to Free layout on the Overlay page to drag." : "Drag widgets anywhere."}</span>
          <button className="btn sm primary" onClick={() => emitMain("overlay-action", "overlayEdit")}>
            Done
          </button>
        </div>
      )}

      {bars ? (
        <>
          <div className="ov-col" data-dbg="bar-left" style={{ left: 0, width: `${st.settings.gameBounds!.left * 100}%` }}>
            {hordes?.active && <HordesPanel h={hordes} />}
            {helltide?.active && <HelltidePanel h={helltide} />}
            {boss && <BossPanel b={boss} />}
            {panels.timers}
            {panels.run}
            {panels.farm}
            {panels.build}
          </div>
          <div className="ov-col" data-dbg="bar-right" style={{ left: `${st.settings.gameBounds!.right * 100}%`, width: `${(1 - st.settings.gameBounds!.right) * 100}%`, bottom: 200 }}>
            {panels.verdict}
            {panels.watchers}
            {panels.toasts}
          </div>
        </>
      ) : (
        (Object.keys(panels) as (keyof typeof panels)[]).map(
          (k) =>
            panels[k] && (
              <Widget key={k} id={k} pos={st.settings.widgets[k]} edit={st.edit}>
                {panels[k]}
              </Widget>
            ),
        )
      )}

      {tip && <TooltipBadge t={tip} style={toCss(tip.box)} />}

      {hordes?.active && <HordesBadges h={hordes} toCss={toCss} />}
      {advisor && advisor.items.length > 0 && <AdvisorBadges a={advisor} toCss={toCss} />}
      {hordes?.active && !bars && (
        <div style={{ position: "absolute", left: 12, top: "38%", width: 360 }}>
          <HordesPanel h={hordes} />
        </div>
      )}

      {visible && st.settings.widgets.verdict.on && (
        <StatusCorner
          hordes={hordes}
          tip={tip}
          verdict={verdict}
          autoJudge={st.autoJudge}
          now={now}
          width={bars ? `calc(${(1 - st.settings.gameBounds!.right) * 100}% - 24px)` : "380px"}
        />
      )}

      {guideOn && guide && <GuidePanel g={guide} toCss={toCss} />}

      {mapPins && st.visible && !guideOn && <MapPinsLayer m={mapPins} toCss={toCss} now={now} />}
    </div>
  );
}

// ---- panels --------------------------------------------------------------------

function TimersPanel({ st, now, big }: { st: OverlayState; now: number; big: boolean }) {
  const kinds = ["worldBoss", "helltide", "legion"] as const;
  return (
    <div className="ov-panel" data-dbg="panel:timers">
      <div className="ov-title">World events</div>
      {kinds.map((k) => {
        const list = st.events.filter((x) => x.kind === k && (x.end ?? x.start) > now).slice(0, big && k !== "legion" ? 2 : 1);
        return list.map((e, i) => {
          const active = isActive(e, now);
          const EvIcon = EVENT_META[k].icon;
          return (
            <div key={k + e.start} className="ov-ev" style={{ opacity: i ? 0.6 : 1, fontSize: big && !i ? 15 : undefined }}>
              <span style={{ color: EVENT_META[k].color, width: 18, display: "flex", justifyContent: "center", flex: "none" }}>
                <Ico icon={EvIcon} size={big && !i ? 17 : 15} />
              </span>
              <span style={{ minWidth: 0 }}>
                <b>{e.name}</b>
                {e.zone && <div className="small muted">{e.zone}</div>}
              </span>
              <span className="t" style={{ color: active ? EVENT_META[k].color : undefined }}>
                {active ? (e.end ? `ends ${fmtCountdown(e.end - now)}` : "now") : fmtCountdown(e.start - now)}
              </span>
            </div>
          );
        });
      })}
    </div>
  );
}

function RunPanel({ st, now, big }: { st: OverlayState; now: number; big: boolean }) {
  const el = st.run ? now - st.run.start : 0;
  return (
    <div className="ov-panel" data-dbg="panel:run">
      <div className="ov-title">
        {st.run?.activity ?? st.runActivity}
        {st.run?.tier ? ` · ${st.run.tier}` : ""}
      </div>
      <div style={{ fontSize: big ? 38 : 28, fontWeight: 800, fontVariantNumeric: "tabular-nums", fontFamily: "var(--display)" }}>{fmt(el)}</div>
      <div className="small muted">
        {st.pb != null && <>PB {fmt(st.pb)} </>}
        {st.run && st.pb != null && (
          <span style={{ color: el < st.pb ? "var(--green)" : "var(--blood2)" }}>
            ({el < st.pb ? "-" : "+"}
            {fmt(Math.abs(el - st.pb))})
          </span>
        )}
        {st.avg != null && <> · avg {fmt(st.avg)}</>}
        {st.run?.deaths ? <span style={{ color: "var(--blood2)" }}> <Ico icon={Skull} size={12} />{st.run.deaths}</span> : null}
      </div>
      {st.run?.splits.slice(big ? -8 : -4).map((s, i) => (
        <div key={i} className="small" style={{ display: "flex" }}>
          <span className="muted">{s.label}</span>
          <span className="right mono">{fmt(s.at - st.run!.start)}</span>
        </div>
      ))}
    </div>
  );
}

function FarmPanel({ st }: { st: OverlayState }) {
  return (
    <div className="ov-panel" data-dbg="panel:farm">
      <div className="ov-title">Farm next</div>
      {st.farm.map((f) => (
        <div key={f.item} style={{ marginBottom: 6 }}>
          <b style={{ color: "#d9a86a" }}>{f.item}</b> <span className="small dim">{f.slot}</span>
          {f.where && <div className="small muted">{f.where}</div>}
        </div>
      ))}
    </div>
  );
}

function BuildPanel({ st }: { st: OverlayState }) {
  return (
    <div className="ov-panel" data-dbg="panel:build">
      <div className="ov-title">{st.build!.variant}</div>
      <div className="small">
        {st.build!.skillBar.map((s, i) => (
          <span key={s} className="tag">
            {i + 1}. {s}
          </span>
        ))}
      </div>
      {st.build!.reminders.map((r) => (
        <div key={r} className="small muted">
          • {r}
        </div>
      ))}
    </div>
  );
}

function WatchersPanel({ st }: { st: OverlayState }) {
  return (
    <div className="ov-panel" data-dbg="panel:watchers">
      <div className="ov-title">Tracked</div>
      {st.watchers.length === 0 && <div className="small muted">Add "show on overlay" watchers</div>}
      {st.watchers.map((w) => (
        <div key={w.name} className="ov-ev">
          <span className="muted">{w.name.replace(" (auto)", "")}</span>
          <span className="t" style={{ color: w.fired ? "var(--gold2)" : undefined }}>
            {typeof w.value === "number" ? w.value.toLocaleString() : w.text || "—"}
          </span>
        </div>
      ))}
    </div>
  );
}

function VerdictPanel({ v, detailed, judging }: { v: JudgeResult; detailed: boolean; judging: boolean }) {
  const s = VERDICT_STYLE[v.verdict] ?? VERDICT_STYLE.UNKNOWN;
  const total = v.matched.length + v.missing.length;
  return (
    <div className={"ov-panel ov-verdict " + (v.verdict === "WEAR" || v.verdict === "CUBE" ? "bis" : "")} data-dbg="verdict-panel" style={{ borderColor: s.color, maxWidth: detailed ? "none" : 440 }}>
      <div className="row" style={{ gap: 8, color: s.color }}>
        <Ico icon={s.icon} size={detailed ? 30 : 24} />
        <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: detailed ? 28 : 22, letterSpacing: ".05em", textTransform: "uppercase" }}>{s.label}</div>
        {judging && <span className="loader right" />}
      </div>
      <div style={{ fontWeight: 700, fontSize: detailed ? 16 : 14, marginTop: 2 }}>{v.item.name}</div>
      {v.action && <div style={{ fontSize: detailed ? 16 : 14, marginTop: 6, color: "var(--text)", lineHeight: 1.35 }}>{v.action}</div>}
      {v.reasons.slice(0, detailed ? 3 : 2).map((r, i) => (
        <div key={i} className="small muted" style={{ marginTop: 3 }}>
          {r.length > 180 ? r.slice(0, 180) + "…" : r}
        </div>
      ))}
      {v.steps && v.steps.length > 1 && (
        <div style={{ marginTop: 8 }}>
          <div className="ov-title" style={{ marginBottom: 2 }}>
            To do
          </div>
          {v.steps.slice(0, detailed ? 7 : 4).map((st, i) => (
            <div key={i} className="small" style={{ display: "flex", gap: 6, marginTop: 2 }}>
              <span style={{ color: s.color, width: 14 }}>{i + 1}.</span>
              <span>{st}</span>
            </div>
          ))}
        </div>
      )}
      {detailed && total > 0 && (
        <div style={{ marginTop: 10 }}>
          <div className="ov-title" style={{ marginBottom: 2 }}>
            Stats your build wants ({v.matched.length} of {total})
          </div>
          {[...v.matched.map((m) => [m, true] as const), ...v.missing.map((m) => [m, false] as const)].map(([m, ok]) => (
            <div key={m} className="small" style={{ color: ok ? "var(--green)" : "var(--dim)" }}>
              {ok ? "✓" : "✗"} {m}
            </div>
          ))}
          {v.greaterOnTargets > 0 && (
            <div className="small" style={{ color: "var(--gold2)", marginTop: 2 }}>
              <Ico icon={Star} size={12} style={{ fill: "currentColor" }} /> {v.greaterOnTargets} of them {v.greaterOnTargets === 1 ? "is a" : "are"} greater (extra-strong) roll{v.greaterOnTargets === 1 ? "" : "s"}
            </div>
          )}
        </div>
      )}
      {detailed && v.thumb && <img src={v.thumb} style={{ width: "100%", marginTop: 10, borderRadius: 6, opacity: 0.85 }} />}
    </div>
  );
}

/** Card beside the in-game tooltip (left of it if there's room, else right). */
function TooltipBadge({ t, style }: { t: TooltipEvt; style: CSSProperties }) {
  const v = t.verdict;
  const s = v ? VERDICT_STYLE[v.verdict] ?? VERDICT_STYLE.UNKNOWN : null;
  const left = Number(style.left);
  const width = Number(style.width);
  const cardW = 300;
  const onLeft = left - cardW - 16 > 0;
  const x = onLeft ? left - cardW - 16 : left + width + 16;
  const y = Math.max(8, Number(style.top) + 8);
  return (
    <div
      className="ov-panel"
      data-dbg="verdict-card"
      style={{
        position: "absolute",
        left: x,
        top: y,
        width: cardW,
        borderColor: s?.color ?? "var(--gold)",
        borderWidth: 2,
        padding: "12px 14px",
        animation: "pop .15s ease-out",
        pointerEvents: "none",
      }}
    >
      {v ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: s!.color }}>
            <Ico icon={s!.icon} size={26} />
            <span style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 22, letterSpacing: ".05em", textTransform: "uppercase" }}>{s!.label}</span>
          </div>
          {v.action && <div style={{ marginTop: 6, fontSize: 15, lineHeight: 1.35 }}>{v.action}</div>}
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <div>
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 20, color: "var(--gold2)" }}>Checking…</div>
            {t.prelim?.name && <div className="small muted">{t.prelim.unique ?? t.prelim.name}</div>}
          </div>
        </div>
      )}
    </div>
  );
}

/** Always-on status card in the bottom-right corner: watching / checking / last outcome. */
function StatusCorner({ tip, verdict, autoJudge, width, now, hordes }: { tip: TooltipEvt | null; verdict: JudgeResult | null; autoJudge: boolean; width: string; now: number; hordes?: HordesState | null }) {
  const checking = !!tip && tip.state !== "done";
  const recent = verdict && now - verdict.at < 15_000 ? verdict : null;
  const s = recent ? VERDICT_STYLE[recent.verdict] ?? VERDICT_STYLE.UNKNOWN : null;
  return (
    <div
      className="ov-panel"
      data-dbg="status-corner"
      style={{
        position: "absolute",
        right: 12,
        bottom: 12,
        width,
        borderColor: checking ? "var(--gold2)" : s?.color ?? "#4a3828",
        borderWidth: 2,
        padding: "12px 14px",
        pointerEvents: "none",
      }}
    >
      {hordes?.active && (hordes.offers[0] || hordes.chests[0]) && (
        <div style={{ marginBottom: 8, paddingBottom: 8, borderBottom: "1px solid #3a2c22" }}>
          <div className="ov-title"><Ico icon={Flame} size={13} /> Infernal Hordes{hordes.aether != null ? ` · ${hordes.aether} Aether` : ""}</div>
          {hordes.offers[0] ? (
            <div style={{ fontWeight: 800, color: "var(--green)", fontSize: 16 }}><Ico icon={CircleCheck} size={16} /> Pick: {hordes.offers[0].title}</div>
          ) : (
            <div style={{ fontWeight: 800, color: "var(--green)", fontSize: 16 }}><Ico icon={CircleCheck} size={16} /> Open: {hordes.chests[0].name}</div>
          )}
        </div>
      )}
      <div className="ov-title">Loot judge</div>
      {checking ? (
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span className="loader" style={{ width: 22, height: 22, borderWidth: 3 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 22, color: "var(--gold2)" }}>Checking…</div>
            <div className="small muted" style={{ whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {tip?.prelim?.unique ?? tip?.prelim?.name ?? "reading the tooltip"}
            </div>
          </div>
        </div>
      ) : recent ? (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, color: s!.color }}>
            <Ico icon={s!.icon} size={26} />
            <span style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: 22, letterSpacing: ".05em", textTransform: "uppercase" }}>{s!.label}</span>
          </div>
          <div style={{ fontWeight: 700, marginTop: 2 }}>{recent.item.name}</div>
          {recent.action && <div style={{ marginTop: 4, fontSize: 14, lineHeight: 1.35 }}>{recent.action}</div>}
        </>
      ) : (
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <Ico icon={Eye} size={22} style={{ color: "var(--gold)" }} />
          <span className="muted">{autoJudge ? "Watching — hover any item" : "Hover an item and press the judge key"}</span>
        </div>
      )}
    </div>
  );
}

/** Rank badges glued to the Infernal Offer labels and Spoils chests in the arena. */
function HordesBadges({ h, toCss }: { h: HordesState; toCss: (b: { x: number; y: number; w: number; h: number }) => CSSProperties }) {
  return (
    <>
      {h.offers.filter((o) => o.visible !== false).map((o) => {
        const css = toCss(o.box);
        const top = Number(css.top);
        const best = o.rank === 1;
        return (
          <div
            key={o.key}
            className="ov-panel"
            data-dbg="hordes-offer"
            style={{
              position: "absolute",
              left: Number(css.left),
              top: Math.max(4, top - (best ? 64 : 40)),
              minWidth: 0,
              maxWidth: 360,
              padding: best ? "8px 12px" : "4px 10px",
              borderWidth: 2,
              borderColor: best ? "var(--green)" : "#6d5a48",
              pointerEvents: "none",
              animation: "pop .15s ease-out",
            }}
          >
            <div style={{ fontFamily: "var(--display)", fontWeight: 800, fontSize: best ? 18 : 14, color: best ? "var(--green)" : "var(--muted)" }}>
              {best ? <><Ico icon={CircleCheck} size={18} /> PICK THIS</> : `#${o.rank}`}
            </div>
            {best && <div className="small">{o.why}</div>}
          </div>
        );
      })}
      {h.chests.map((c) => {
        const css = toCss(c.box);
        return (
          <div
            key={c.key}
            className="ov-panel"
            data-dbg="hordes-chest"
            style={{
              position: "absolute",
              left: Number(css.left),
              top: Math.max(4, Number(css.top) - 42),
              minWidth: 0,
              padding: "4px 10px",
              borderWidth: 2,
              borderColor: c.order === 1 ? "var(--green)" : "#6d5a48",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontWeight: 800, color: c.order === 1 ? "var(--green)" : "var(--muted)" }}>{c.order === 1 ? <><Ico icon={CircleCheck} size={14} /> OPEN THIS FIRST</> : c.order < 99 ? `#${c.order}` : "skip"}</span>
          </div>
        );
      })}
    </>
  );
}

function HordesPanel({ h }: { h: HordesState }) {
  return (
    <div className="ov-panel" data-dbg="panel:hordes">
      <div className="ov-title">
        <Ico icon={Flame} size={13} /> Infernal Hordes{h.aether != null ? ` · ${h.aether} Aether` : ""}
      </div>
      {h.offers.length > 0 ? (
        h.offers.map((o) => (
          <div key={o.key} style={{ marginBottom: 6 }}>
            <div style={{ fontWeight: 700, color: o.rank === 1 ? "var(--green)" : undefined }}>
              {o.rank === 1 ? <><Ico icon={CircleCheck} size={14} /> </> : `${o.rank}. `}
              {o.title}
            </div>
            <div className="small" style={{ color: "var(--gold)" }}>
              + {o.boon}
            </div>
            <div className="small" style={{ color: "var(--blood2)" }}>
              − {o.bane}
            </div>
          </div>
        ))
      ) : h.chests.length > 0 ? null : (
        <div className="small muted">{h.lastPick ? `Last pick: ${h.lastPick}` : "Walk up to the offers — I'll rank them."}</div>
      )}
      {h.chests.length > 0 && (
        <>
          <div className="ov-title" style={{ marginTop: 6 }}>
            Spoils
          </div>
          {h.advice.map((a, i) => (
            <div key={i} className="small" style={{ marginBottom: 3 }}>
              • {a}
            </div>
          ))}
        </>
      )}
    </div>
  );
}

/** Ranked badges for a reward screen (Tree of Whispers caches). */
function AdvisorBadges({ a, toCss }: { a: AdvisorState; toCss: (b: { x: number; y: number; w: number; h: number }) => CSSProperties }) {
  return (
    <>
      {a.items.map((c) => {
        if (!c.box) return null;
        const css = toCss(c.box);
        const best = c.rank === 1;
        return (
          <div
            key={c.key}
            className="ov-panel"
            data-dbg="advisor-badge"
            style={{
              position: "absolute",
              left: Number(css.left) + Number(css.width) + 12,
              top: Number(css.top) - 6,
              minWidth: 0,
              maxWidth: 340,
              padding: best ? "6px 12px" : "3px 10px",
              borderWidth: 2,
              borderColor: best ? "var(--green)" : "#6d5a48",
              pointerEvents: "none",
            }}
          >
            <span style={{ fontWeight: 800, color: best ? "var(--green)" : "var(--muted)" }}>{best ? <><Ico icon={CircleCheck} size={14} /> TAKE THIS</> : `#${c.rank}`}</span>
            {best && <div className="small">{c.why}</div>}
          </div>
        );
      })}
    </>
  );
}

function HelltidePanel({ h }: { h: HelltideInfo }) {
  const mins = h.secondsLeft != null ? `${Math.floor(h.secondsLeft / 60)}:${String(h.secondsLeft % 60).padStart(2, "0")}` : "?";
  return (
    <div className="ov-panel" data-dbg="panel:helltide">
      <div className="ov-title"><Ico icon={Flame} size={13} /> Helltide · {mins} left</div>
      <div style={{ fontSize: 22, fontWeight: 800, fontFamily: "var(--display)" }}>{h.cinders ?? "?"} cinders</div>
      {h.plan.map((p, i) => (
        <div key={i} className="small" style={{ marginTop: 4 }}>
          • {p}
        </div>
      ))}
      <div className="small dim" style={{ marginTop: 6 }}>
        Armour & rings 75 · amulets 125 · weapons 150
      </div>
    </div>
  );
}

function BossPanel({ b }: { b: BossInfo }) {
  return (
    <div className="ov-panel" data-dbg="panel:boss" style={{ borderColor: "var(--blood2)" }}>
      <div className="ov-title"><Ico icon={Skull} size={13} /> {b.name}</div>
      {b.wanted.length ? (
        b.wanted.map((w) => (
          <div key={w.item} style={{ marginBottom: 4 }}>
            <b style={{ color: "#d9a86a" }}>{w.item}</b> <span className="small dim">{w.slot}</span>
            <div className="small">Look for {w.lookFor}.</div>
          </div>
        ))
      ) : (
        <div className="small muted">Nothing for your build drops here.</div>
      )}
      {b.notes.map((n, i) => (
        <div key={i} className="small dim" style={{ marginTop: 4 }}>
          {n}
        </div>
      ))}
    </div>
  );
}

function GuidePanel({ g, toCss }: { g: GuideState; toCss: (b: { x: number; y: number; w: number; h: number }) => CSSProperties }) {
  return (
    <>
      {g.highlights.map((h, i) => {
        const css = toCss(h);
        return (
          <div key={i} className="ov-hl" data-dbg="guide-highlight" style={css}>
            <div className="ov-hl-label">
              {h.arrow === "down" ? "↓ " : h.arrow === "left" ? "← " : ""}
              {h.label}
            </div>
            {h.arrow === "down" && <div className="ov-hl-arrow">⇣</div>}
          </div>
        );
      })}
      <div className="ov-guide" data-dbg="guide">
        <div className="row" style={{ gap: 10 }}>
          <span className="ov-title" style={{ margin: 0 }}>
            {g.title}
          </span>
          {g.steps > 1 && (
            <span className="small muted">
              step {g.step}/{g.steps}
            </span>
          )}
          {g.busy && <span className="loader right" />}
        </div>
        <div className="ov-guide-main">{g.instruction}</div>
        {g.detail && <div className="muted">{g.detail}</div>}
        {g.items.length > 0 && (
          <div className="ov-guide-items">
            {g.items.map((it) => (
              <div key={it.key} className="small" style={{ color: it.done ? "var(--green)" : "var(--text)" }}>
                {it.done ? "✓" : "○"} {it.label}
                {it.note && <span className="muted"> — {it.note}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </>
  );
}

// ---- map pins ------------------------------------------------------------------

const PIN_STYLE: Record<PoiKind, { icon: LucideIcon; color: string; minor?: boolean }> = {
  journal: { icon: BookOpen, color: "#f6e2a8" },
  altar: { icon: Gem, color: "#e978ff" },
  tenet_of_akarat: { icon: Sparkles, color: "#e978ff" },
  chronicle_of_creation: { icon: Sparkles, color: "#e978ff" },
  stronghold: { icon: Castle, color: "#ff6a55" },
  dungeon: { icon: DoorOpen, color: "#ffd25a" },
  cellar: { icon: Warehouse, color: "#ffa25a", minor: true },
  boss_dungeon: { icon: Skull, color: "#ff4a4a" },
  undercity: { icon: Landmark, color: "#6fb2ff" },
  side_quest: { icon: ScrollText, color: "#8fe07a", minor: true },
  helltide_chest: { icon: Package, color: "#ff5a2f", minor: true },
  waypoint: { icon: CircleCheck, color: "#5fe6ff" },
};

/**
 * Pins over the open in-game map. Positions arrive in absolute physical screen px (frame px
 * mapped through the capture region) and go through the same toCss as every other badge,
 * inside a box clipped to the visible map area (between the nav bar and the hint bar, left of
 * the side panel), with the HUD boxes over the map cut out of it: nothing is drawn outside the
 * map. The preset's name shows in the map's top-left corner for a moment after switching.
 */
function MapPinsLayer({ m, toCss, now }: { m: MapPinsFrame & { labelUntil?: number }; toCss: (b: { x: number; y: number; w: number; h: number }) => CSSProperties; now: number }) {
  const clip = toCss(m.clip);
  const ox = Number(clip.left), oy = Number(clip.top), cw = Number(clip.width), ch = Number(clip.height);
  // the visible area minus the HUD boxes (even-odd: each box is a hole)
  const holes = (m.hud ?? [])
    .map((h) => {
      const b = toCss(h);
      const x0 = Number(b.left) - ox, y0 = Number(b.top) - oy, x1 = x0 + Number(b.width), y1 = y0 + Number(b.height);
      return `M${x0.toFixed(1)} ${y0.toFixed(1)} H${x1.toFixed(1)} V${y1.toFixed(1)} H${x0.toFixed(1)} Z`;
    })
    .join(" ");
  const clipPath = holes ? `path(evenodd, "M0 0 H${cw.toFixed(1)} V${ch.toFixed(1)} H0 Z ${holes}")` : undefined;
  // zoomed out, the minor kinds (cellars, side quests, chests) shrink to dots so the map stays readable
  const far = m.zoom < 2.5;
  const flash = m.labelUntil != null && now < m.labelUntil;
  return (
    <>
      <div data-dbg="map-pins" style={{ position: "absolute", ...clip, overflow: "hidden", clipPath, pointerEvents: "none" }}>
        {m.pins.map((p, i) => {
          const sty = PIN_STYLE[p.k] ?? PIN_STYLE.waypoint;
          const at = toCss({ x: p.x, y: p.y, w: 0, h: 0 });
          const left = Number(at.left) - ox, top = Number(at.top) - oy;
          // found altars and collectibles (with "unfound only" off) and approximate spots are drawn faded
          const fade = p.found ? 0.35 : p.approx ? 0.6 : 1;
          if (far && sty.minor) {
            return <div key={i} className="ov-pin-dot" style={{ left, top, background: sty.color, opacity: p.approx ? 0.5 : 0.85 }} />;
          }
          const size = sty.minor ? 20 : 24;
          return (
            <div key={i} className="ov-pin" style={{ left, top, width: size, height: size, borderColor: sty.color, color: sty.color, opacity: fade }}>
              <Ico icon={sty.icon} size={sty.minor ? 11 : 13} />
              {p.label && <span className="ov-pin-label" style={{ color: sty.color }}>{p.label}</span>}
            </div>
          );
        })}
      </div>
      {m.label && (flash || m.labelMs == null) && (
        <div className={"ov-pin-chip" + (flash ? " flash" : "")} data-dbg="map-pins-chip" style={{ left: ox + 12, top: oy + 10 }}>
          <Ico icon={MapPin} size={flash ? 13 : 11} /> {m.label}
        </div>
      )}
    </>
  );
}

function Widget({ id, pos, edit, children }: { id: string; pos: { x: number; y: number; scale: number }; edit: boolean; children: ReactNode }) {
  const [drag, setDrag] = useState<{ dx: number; dy: number; x: number; y: number } | null>(null);
  const x = drag ? drag.x : pos.x;
  const y = drag ? drag.y : pos.y;
  return (
    <div
      className="ov-w"
      data-dbg={`widget:${id}`}
      style={{ left: `${x * 100}%`, top: `${y * 100}%`, transform: `scale(${pos.scale})` }}
      onPointerDown={(e) => {
        if (!edit) return;
        (e.target as HTMLElement).setPointerCapture(e.pointerId);
        const r = e.currentTarget.getBoundingClientRect();
        setDrag({ dx: e.clientX - r.left, dy: e.clientY - r.top, x: pos.x, y: pos.y });
      }}
      onPointerMove={(e) => {
        if (!drag) return;
        setDrag({ ...drag, x: (e.clientX - drag.dx) / innerWidth, y: (e.clientY - drag.dy) / innerHeight });
      }}
      onPointerUp={() => {
        if (!drag) return;
        emitMain("layout", { id, x: drag.x, y: drag.y });
        setDrag(null);
      }}
    >
      {children}
    </div>
  );
}
