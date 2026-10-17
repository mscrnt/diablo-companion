// Character mapping: guided overlay flows that read YOUR character from the screen —
// the stats sheet (with "scroll down" prompts), skill ranks (hover each skill) and
// paragon glyph levels (hover each glyph socket). Saved as a profile the app and the
// AI coach can compare against the build.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { overlayToast, playTone } from "./alerts";
import { beginFlow, cancelGuide, flowAlive, guideGameRect, guideSet, guideSleep, guideWait, useGuide, type GuideItem } from "./guide";
import { normName, table } from "./names";
import { glyphActiveText, looksLikeGlyph, ocrRows, parseGlyphHover, parseGlyphUpgrade, parseSkillHover, parseStatSheet, stepGlyphUpgrade, tidyStats, type GlyphUpgradeMemo } from "./charsheet";
import { debugEvent } from "./debug";
import { ocrVocabReady } from "./ocrfix";
import { captureRegion, cursorPosition, type OcrLine } from "./native";
import { glyphActiveAt } from "./glyphring";
import { persistStorage } from "./persist";
import { invoke } from "@tauri-apps/api/core";
import { getActiveVariant, useSettings } from "./store";

/** progress of a "Map my character" run, so it can be paused and resumed later */
export interface MapSession {
  startedAt: number;
  stats: boolean;
  skills: string[];
  glyphs: string[];
}

export interface SkillRank {
  name: string;
  /** points you spent; null when the gear bonus couldn't be read (older reads too) */
  rank: number | null;
  /** ranks from gear and buffs ("Item Contribution"); null = unknown */
  bonus: number | null;
  /** the rank the tooltip shows: points + bonus */
  total: number;
  max: number | null;
  at: number;
}

export interface CharacterProfile {
  session: MapSession | null;
  stats: Record<string, string>;
  statsAt: number;
  /** 1 = stats keyed by the game's stat names (older saves hold raw OCR labels) */
  statsV?: number;
  skills: Record<string, SkillRank>;
  /** every glyph you hovered; active = socketed on a board (the list's red ring), undefined = not checked */
  glyphs: Record<string, { name: string; level: number; at: number; active?: boolean }>;
}

interface CharState extends CharacterProfile {
  setStats: (s: Record<string, string>) => void;
  setSkill: (slug: string, v: Omit<SkillRank, "at">) => void;
  setGlyph: (slug: string, v: { name: string; level: number; active?: boolean }) => void;
  clear: () => void;
  patchSession: (p: Partial<MapSession> | null) => void;
}

export const useCharacter = create<CharState>()(
  persist(
    (set) => ({
      session: null,
      stats: {},
      statsAt: 0,
      skills: {},
      glyphs: {},
      patchSession: (p) =>
        set((s) => ({
          session: p === null ? null : { ...(s.session ?? { startedAt: Date.now(), stats: false, skills: [], glyphs: [] }), ...p },
        })),
      setStats: (stats) => set({ stats, statsAt: Date.now(), statsV: 1 }),
      setSkill: (slug, v) => set((s) => ({ skills: { ...s.skills, [slug]: { ...v, at: Date.now() } } })),
      setGlyph: (slug, v) => set((s) => ({ glyphs: { ...s.glyphs, [slug]: { ...v, at: Date.now() } } })),
      clear: () => set({ stats: {}, statsAt: 0, skills: {}, glyphs: {}, session: null }),
    }),
    {
      name: "character",
      storage: persistStorage,
      version: 1,
      migrate: (old: any, version) => {
        // v0 stored the tooltip's rank (points + gear ranks, e.g. 34/15) as "rank": keep it as the
        // total; the points spent are unknown until the skill is hovered again
        if (version < 1 && old?.skills) {
          for (const [slug, s] of Object.entries<any>(old.skills)) old.skills[slug] = { name: s.name, rank: null, bonus: null, total: s.rank, max: s.max ?? null, at: s.at };
          if (old.session) old.session.skills = [];
        }
        return old as CharState;
      },
    },
  ),
);

/** Older saves keyed stats by raw OCR labels ("Kyldirril", "Thoms"): tidy them once the game's stat names are loaded. */
export async function tidyCharacter() {
  if (!useCharacter.persist.hasHydrated()) await new Promise<void>((r) => useCharacter.persist.onFinishHydration(() => r()));
  const c = useCharacter.getState();
  if (c.statsV === 1 || !ocrVocabReady()) return;
  useCharacter.setState({ stats: Object.keys(c.stats).length ? tidyStats(c.stats) : c.stats, statsV: 1 });
}

/** Join OCR lines that sit on the same row (label left, value right). */
const rows = (lines: OcrLine[]): string[] => ocrRows(lines).map((r) => r.map((p) => p.text.trim()).join(" "));

// ---- stats ---------------------------------------------------------------------------

export async function mapStats(my?: number, embedded = false) {
  my ??= beginFlow("character", "Character stats", 1);
  const key = useSettings.getState().settings.hotkeys.judge;
  const rect = await guideGameRect();
  if (!rect) return;
  const found: Record<string, string> = {};
  // every frame votes; a stat keeps the value read most often (scrolling and overlapping
  // tooltips cause the odd wrong pairing)
  const votes: Record<string, Record<string, number>> = {};
  let lastNew = Date.now();
  let started = false;
  let logged = 0;
  let lastLog = 0;
  guideSet({
    instruction: "Open Character → Materials & Stats",
    detail: `Press C, then open the stats list. I'll read every line: scroll down slowly when I ask. Press ${key} when you reach the bottom · ${pauseKey()} pauses.`,
    items: [],
    highlights: [],
  });
  const res = await guideWait(
    async () => {
      const cap = await captureRegion(rect, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
      const lines = cap.ocr?.lines ?? [];
      let added = 0;
      for (const [name, value] of Object.entries(parseStatSheet(lines))) {
        const v = (votes[name] ??= {});
        v[value] = (v[value] ?? 0) + 1;
        const best = Object.entries(v).sort((a, b) => b[1] - a[1])[0][0];
        if (!(name in found)) added++;
        found[name] = best;
      }
      // keep a few raw frames (text + positions) so the reader can be tuned on real sheets
      if (lines.length && logged < 8 && Date.now() - lastLog > 6000) {
        logged++;
        lastLog = Date.now();
        invoke("debug_log_write", { name: `statsheet_${new Date().toISOString().replace(/[:.]/g, "-")}`, image: null, json: JSON.stringify({ read: found, lines }, null, 1) }).catch(() => {});
      }
      const n = Object.keys(found).length;
      if (added) {
        lastNew = Date.now();
        started = true;
      }
      if (started && n >= 8) {
        const idle = Date.now() - lastNew;
        guideSet({
          instruction: idle > 2500 ? "Scroll down ↓" : "Reading…",
          detail: `${n} stats read so far. ${idle > 2500 ? "Scroll the stats list a bit further." : ""} Press ${key} when you've reached the bottom.`,
          items: Object.entries(found)
            .slice(-8)
            .map(([k, v]) => ({ key: k, label: `${k}: ${v}`, done: true })),
        });
        // nothing new for a long while after lots of stats → assume we're at the end
        if (n >= 30 && idle > 12000) return true;
      }
      return false;
    },
    900,
    my,
  );
  if (res === false) return;
  if (Object.keys(found).length) {
    useCharacter.getState().setStats(found);
    useCharacter.getState().patchSession({ stats: true });
    overlayToast("Stats saved", `${Object.keys(found).length} stats read from your character sheet.`, "#5fd18a");
    playTone("good", useSettings.getState().settings.alerts.volume);
  }
  if (!embedded && flowAlive(my)) cancelGuide();
}

// ---- hover collectors (skills, glyphs) ----------------------------------------------------

let lastSkillLog = 0;

/**
 * OCR the whole game image while you hover something (skill / glyph tooltips can open far
 * from the cursor, e.g. above the skill bar). Only while the mouse is over the game, and
 * never our own windows.
 */
async function hoverText(): Promise<string[]> {
  const rect = await guideGameRect();
  if (!rect) return [];
  const [mx, my] = await cursorPosition();
  if (mx < rect.x || my < rect.y || mx > rect.x + rect.w || my > rect.y + rect.h) return [];
  const b = useSettings.getState().settings.overlay.gameBounds;
  const x0 = b ? rect.x + Math.round(rect.w * b.left) : rect.x;
  const x1 = b ? rect.x + Math.round(rect.w * b.right) : rect.x + rect.w;
  const cap = await captureRegion({ x: x0, y: rect.y, w: x1 - x0, h: rect.h }, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
  const lines = rows(cap.ocr?.lines ?? []);
  if (lines.some((l) => /diablo-companion|d4 companion|sanctuary toolkit/i.test(l))) return [];
  return lines;
}

export async function mapSkills(my?: number, embedded = false) {
  my ??= beginFlow("character", "Skill ranks", 1);
  const { variant } = getActiveVariant();
  const key = useSettings.getState().settings.hotkeys.judge;
  const bar = variant?.skillBar ?? [];
  // every class skill is a candidate (you might be running something not in the build)
  const cls = (getActiveVariant().build?.className ?? "").toLowerCase();
  const names = Object.entries(table("skills"))
    .filter(([, s]) => (!cls || s.c === cls) && s.t === "basic")
    .map(([slug, s]) => ({ slug, name: s.n }));
  const already = useCharacter.getState().session?.skills ?? [];
  const items: GuideItem[] = bar.map((s) => ({ key: s.slug, label: s.name, done: already.includes(s.slug), note: already.includes(s.slug) ? "done earlier" : undefined }));
  guideSet({
    instruction: "Hover each skill on your bar",
    detail: `Hover each skill icon on your bar (or in Abilities → Skill Tree) so its tooltip with "Rank" shows. Press ${key} when done · ${pauseKey()} pauses.`,
    items,
    highlights: [],
  });
  const res = await guideWait(
    async () => {
      const lines = await hoverText();
      // "Army of the Dead" / "RANK 9/15" / "(Item Contribution: 4)": 5 points + 4 from gear
      const read = parseSkillHover(lines, names);
      const text = lines.join(" ");
      // log misses (and reads whose gear bonus OCR lost) so the reader can be tuned on your real tooltips
      if ((!read || read.base === null) && /rank|cooldown|lucky hit|essence|skill/i.test(text) && Date.now() - lastSkillLog > 4000) {
        lastSkillLog = Date.now();
        invoke("debug_log_write", { name: `skillhover_${new Date().toISOString().replace(/[:.]/g, "-")}`, image: null, json: JSON.stringify({ read, lines }, null, 1) }).catch(() => {});
      }
      if (!read) return false;
      const { hit } = read;
      const prev = useCharacter.getState().skills[hit.slug];
      // a later hover that lost the contribution line doesn't overwrite a complete read of the same rank
      if (read.base === null && prev?.rank != null && prev.total === read.total) return false;
      useCharacter.getState().setSkill(hit.slug, { name: hit.name, rank: read.base, bonus: read.bonus, total: read.total, max: read.max });
      // done once the points are known; without them, ask for another hover
      if (read.base === null) return false;
      const it = items.find((i) => i.key === hit.slug || normName(i.label) === normName(hit.name));
      if (it && !it.done) {
        it.done = true;
        it.note = `${read.base} point${read.base === 1 ? "" : "s"}${read.bonus ? ` +${read.bonus} from gear` : ""}`;
        useCharacter.getState().patchSession({ skills: [...(useCharacter.getState().session?.skills ?? []), it.key] });
        playTone("tick", useSettings.getState().settings.alerts.volume);
      }
      guideSet({ items: [...items] });
      return items.length > 0 && items.every((i) => i.done);
    },
    500,
    my,
  );
  if (res === false) return;
  if (!embedded && flowAlive(my)) cancelGuide();
}

/**
 * Is the hovered glyph active? The tooltip says so: an active glyph offers "Unequip" (and "Locate"), an
 * inactive one "Drag to Equip" (seen in the side-panel Paragon view, 2026-10-12). That holds in every
 * layout; the red ring in the full-screen glyph list is the fallback. null when neither shows.
 */
async function glyphActive(lines: string[]): Promise<boolean | null> {
  return glyphActiveText(lines) ?? glyphRingUnderCursor().catch(() => null);
}

/** The red ring around an active glyph in the full-screen Paragon view's glyph list (left side). */
async function glyphRingUnderCursor(): Promise<boolean | null> {
  const rect = await guideGameRect();
  if (!rect) return null;
  const [mx, my] = await cursorPosition();
  const b = useSettings.getState().settings.overlay.gameBounds;
  const left = b ? rect.x + Math.round(rect.w * b.left) : rect.x;
  const width = b ? Math.round(rect.w * (b.right - b.left)) : rect.w;
  // the side-panel view's list is on the right and has no ring to read: the tooltip text decides there
  if (mx > left + width * 0.2) return null;
  const side = Math.round(rect.h * 0.1);
  const box = { x: mx - side / 2, y: my - side / 2, w: side, h: side };
  const cap = await captureRegion({ x: Math.round(box.x), y: Math.round(box.y), w: side, h: side }, { maxEdge: side, quality: 92 });
  const bytes = Uint8Array.from(atob(cap.image.replace(/^data:[^,]+,/, "")), (c) => c.charCodeAt(0));
  const bmp = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }));
  const canvas = new OffscreenCanvas(bmp.width, bmp.height);
  const ctx = canvas.getContext("2d", { willReadFrequently: true })!;
  ctx.drawImage(bmp, 0, 0);
  bmp.close();
  const px = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
  // crop px per screen px (the capture may come back scaled)
  const k = canvas.width / side;
  return glyphActiveAt(px, canvas.width, canvas.height, Math.round((mx - box.x) * k), Math.round((my - box.y) * k), rect.h * k);
}

export async function mapGlyphs(my?: number, embedded = false) {
  my ??= beginFlow("character", "Paragon glyphs", 1);
  const { variant } = getActiveVariant();
  const key = useSettings.getState().settings.hotkeys.judge;
  const names = glyphNames();
  const doneG = useCharacter.getState().session?.glyphs ?? [];
  const items: GuideItem[] = (variant?.paragon ?? []).map((p) => ({ key: p.glyphSlug, label: `${p.glyphName} (build: lvl ${p.glyphLevel})`, done: doneG.includes(p.glyphSlug), note: doneG.includes(p.glyphSlug) ? "done earlier" : undefined }));
  guideSet({
    instruction: "Abilities → Paragon: hover each glyph",
    detail: `Press A, open the Paragon tab, then hover each glyph in the glyph list (the active ones have a red ring) so the tooltip shows its level. Press ${key} when done · ${pauseKey()} pauses.`,
    items,
    highlights: [],
  });
  const res = await guideWait(
    async () => {
      const lines = await hoverText();
      // the glyph's name sits right above its "LEVEL 85" line; short names ("Essence") also
      // appear in normal stats, so only look next to that line. A skill's "RANK 9/15" isn't a glyph.
      const read = parseGlyphHover(lines, names);
      if (!read && lines.some((l) => /\bglyph\b|\blevel\s*\d+/i.test(l)) && Date.now() - lastSkillLog > 4000) {
        lastSkillLog = Date.now();
        invoke("debug_log_write", { name: `glyphhover_${new Date().toISOString().replace(/[:.]/g, "-")}`, image: null, json: JSON.stringify({ read, lines: lines.slice(0, 60) }, null, 1) }).catch(() => {});
      }
      if (!read) return false;
      const { hit, level } = read;
      // which glyphs you actually use: the build's list can name one you dropped long ago (player report, 2026-10-12)
      const active = await glyphActive(lines);
      useCharacter.getState().setGlyph(hit.slug, { name: hit.name, level, active: active ?? undefined });
      const use = active === false ? ", not active" : "";
      let it = items.find((i) => i.key === hit.slug);
      // a glyph the build doesn't list still counts: it's on your boards
      if (!it) {
        it = { key: hit.slug, label: `${hit.name} (not in the build)`, done: false };
        items.push(it);
      }
      const want = variant?.paragon.find((p) => p.glyphSlug === hit.slug)?.glyphLevel ?? 0;
      const note = `lvl ${level}${want && level < want ? `: ${want - level} to go` : want ? " ✓" : ""}${use}`;
      if (!it.done || it.note !== note) {
        const first = !it.done;
        it.done = true;
        it.note = note;
        if (first && want) {
          useCharacter.getState().patchSession({ glyphs: [...(useCharacter.getState().session?.glyphs ?? []), it.key] });
          playTone("tick", useSettings.getState().settings.alerts.volume);
        }
      }
      guideSet({ items: [...items] });
      // done by itself once the build's glyphs are read and all active: then they're the ones you use. If one
      // isn't active, you use another glyph instead: keep going until the done key so it can be hovered too
      const build = items.filter((i) => variant?.paragon.some((p) => p.glyphSlug === i.key));
      const glyphs = useCharacter.getState().glyphs;
      return build.length > 0 && build.every((i) => i.done && glyphs[i.key]?.active !== false);
    },
    500,
    my,
  );
  if (res === false) return;
  if (!embedded && flowAlive(my)) cancelGuide();
}

/** Every glyph your class can use (all of them before a build is picked). */
function glyphNames() {
  const cls = (getActiveVariant().build?.className ?? "").toLowerCase();
  return Object.entries(table("glyphs"))
    .filter(([, g]) => !cls || !g.c || g.c === cls)
    .map(([slug, g]) => ({ slug, name: g.n }));
}

// ---- glyph levels kept current without the mapping flow ---------------------------------------

const upgradeMemo: GlyphUpgradeMemo = new Map();

/**
 * Any OCR'd frame (auto-judge around the cursor, the Pit's left panel): a glyph tooltip anywhere (the Paragon
 * screen's glyph list, the Pit's upgrade screen) saves that glyph's level, and the Pit's upgrade panel saves the
 * new level after "Upgrade Success". Quiet, except for a toast when an upgrade lands.
 */
export function watchGlyphs(ocr: OcrLine[]) {
  if (!ocr.some((l) => /glyph/i.test(l.text))) return;
  // the mapping flow reads them itself (and asks which ones are active)
  const g = useGuide.getState();
  if (g.active && g.flow === "character") return;
  const lines = rows(ocr);
  if (lines.some((l) => /diablo-companion|d4 companion|sanctuary toolkit/i.test(l)) && !lines.some((l) => /success\s*chance/i.test(l))) return;
  const names = glyphNames();
  const up = parseGlyphUpgrade(lines, names);
  if (up) {
    const r = stepGlyphUpgrade(upgradeMemo, up);
    if (r) saveGlyph(r.slug, r.name, r.level, null, r.upgraded ? "upgrade" : "upgrade panel");
    return;
  }
  if (!looksLikeGlyph(lines)) return;
  const hover = parseGlyphHover(lines, names);
  if (hover) saveGlyph(hover.hit.slug, hover.hit.name, hover.level, glyphActiveText(lines), "hover");
}

function saveGlyph(slug: string, name: string, level: number, active: boolean | null, via: "hover" | "upgrade panel" | "upgrade") {
  const prev = useCharacter.getState().glyphs[slug];
  if (prev?.level === level && (active == null || prev.active === active)) return;
  useCharacter.getState().setGlyph(slug, { name, level, active: active ?? prev?.active });
  debugEvent("character", "glyph-level", { glyph: name, from: prev?.level ?? null, to: level, via });
  if (via !== "upgrade" || (prev && prev.level >= level)) return;
  const want = getActiveVariant().variant?.paragon.find((p) => p.glyphSlug === slug)?.glyphLevel ?? 0;
  overlayToast(`${name} level ${level}`, want ? (level >= want ? "At the build's level" : `${want - level} to go for the build`) : "", "#5fd18a", 4000);
}

const pauseKey = () => (useSettings.getState().settings.hotkeys.mapCharacter || "the map hotkey").replace("CommandOrControl", "Ctrl");

/** Stats → skills → glyphs in one guided run. Resumes a paused session where it left off. */
export async function mapCharacter() {
  const c = useCharacter.getState();
  const { variant } = getActiveVariant();
  const s = c.session;
  const allSkills = (variant?.skillBar ?? []).every((b) => s?.skills.includes(b.slug));
  const allGlyphs = (variant?.paragon ?? []).every((p) => s?.glyphs.includes(p.glyphSlug));
  // a finished (or very old) session starts over
  if (!s || (s.stats && allSkills && allGlyphs) || Date.now() - s.startedAt > 7 * 86400_000) c.patchSession(null), c.patchSession({});
  const sess = useCharacter.getState().session!;
  const my = beginFlow("character", sess.stats || sess.skills.length || sess.glyphs.length ? "Map my character (resumed)" : "Map my character", 3);
  if (!sess.stats) {
    guideSet({ step: 1 });
    await mapStats(my, true);
    if (!flowAlive(my)) return;
  }
  if (!(variant?.skillBar ?? []).every((b) => useCharacter.getState().session?.skills.includes(b.slug))) {
    guideSet({ step: 2 });
    await guideSleep(600);
    await mapSkills(my, true);
    if (!flowAlive(my)) return;
  }
  if (!(variant?.paragon ?? []).every((p) => useCharacter.getState().session?.glyphs.includes(p.glyphSlug))) {
    guideSet({ step: 3 });
    await guideSleep(600);
    await mapGlyphs(my, true);
    if (!flowAlive(my)) return;
  }
  useCharacter.getState().patchSession(null);
  guideSet({ instruction: "Character mapped ✓", detail: "See the Character page: the coach now knows your real stats, skills and glyphs.", items: [] });
  playTone("bis", useSettings.getState().settings.alerts.volume);
  await guideSleep(4000);
  if (flowAlive(my)) cancelGuide();
}

/** Hotkey / chord: start, pause (progress kept) or resume the character mapping. */
export function toggleMapCharacter() {
  const g = useGuide.getState();
  if (g.active && g.flow === "character") {
    cancelGuide();
    overlayToast("Character mapping paused", `Progress saved: press ${pauseKey()} to pick up where you left off.`, "#d4ad62", 6000);
    return;
  }
  if (g.active) return; // another guide is running
  mapCharacter();
}

/** Short text block for the AI coach. */
export function characterContext(): string {
  const c = useCharacter.getState();
  const parts: string[] = [];
  if (Object.keys(c.stats).length) parts.push("CHARACTER SHEET:\n" + Object.entries(c.stats).map(([k, v]) => `- ${k}: ${v}`).join("\n"));
  const skill = (s: SkillRank) =>
    s.rank !== null
      ? `- ${s.name}: ${s.rank} skill point${s.rank === 1 ? "" : "s"}${s.bonus ? ` + ${s.bonus} ranks from gear (rank ${s.total})` : ""}`
      : `- ${s.name}: rank ${s.total} including gear ranks (points spent unknown)`;
  if (Object.keys(c.skills).length) parts.push("SKILL RANKS (read in game):\n" + Object.values(c.skills).map(skill).join("\n"));
  if (Object.keys(c.glyphs).length) parts.push("GLYPHS (read in game):\n" + Object.values(c.glyphs).map((g) => `- ${g.name}: level ${g.level}${g.active === false ? " (not active, not on the boards)" : g.active ? " (active)" : ""}`).join("\n"));
  return parts.join("\n\n");
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
