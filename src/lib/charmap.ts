// Character mapping: guided overlay flows that read YOUR character from the screen —
// the stats sheet (with "scroll down" prompts), skill ranks (hover each skill) and
// paragon glyph levels (hover each glyph socket). Saved as a profile the app and the
// AI coach can compare against the build.
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { overlayToast, playTone } from "./alerts";
import { beginFlow, cancelGuide, flowAlive, guideGameRect, guideSet, guideSleep, guideWait, useGuide, type GuideItem } from "./guide";
import { normName, table, trigramSim } from "./names";
import { captureRegion, cursorPosition, type OcrLine } from "./native";
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

export interface CharacterProfile {
  session: MapSession | null;
  stats: Record<string, string>;
  statsAt: number;
  skills: Record<string, { name: string; rank: number; max: number | null; at: number }>;
  glyphs: Record<string, { name: string; level: number; at: number }>;
}

interface CharState extends CharacterProfile {
  setStats: (s: Record<string, string>) => void;
  setSkill: (slug: string, v: { name: string; rank: number; max: number | null }) => void;
  setGlyph: (slug: string, v: { name: string; level: number }) => void;
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
      setStats: (stats) => set({ stats, statsAt: Date.now() }),
      setSkill: (slug, v) => set((s) => ({ skills: { ...s.skills, [slug]: { ...v, at: Date.now() } } })),
      setGlyph: (slug, v) => set((s) => ({ glyphs: { ...s.glyphs, [slug]: { ...v, at: Date.now() } } })),
      clear: () => set({ stats: {}, statsAt: 0, skills: {}, glyphs: {}, session: null }),
    }),
    { name: "character", storage: persistStorage },
  ),
);

/** Join OCR lines that sit on the same row (label left, value right). */
function rows(lines: OcrLine[]): string[] {
  const sorted = [...lines].sort((a, b) => a.y - b.y);
  const out: { y: number; h: number; parts: OcrLine[] }[] = [];
  for (const l of sorted) {
    const r = out.find((r) => Math.abs(r.y + r.h / 2 - (l.y + l.h / 2)) < Math.max(r.h, l.h) * 0.5);
    if (r) r.parts.push(l);
    else out.push({ y: l.y, h: l.h, parts: [l] });
  }
  return out.map((r) => r.parts.sort((a, b) => a.x - b.x).map((p) => p.text.trim()).join(" "));
}

const STAT_ROW = /^([A-Za-z][A-Za-z '%&\-:()]{2,60}?)\s*[:.]?\s+([+\-x]?\s?[\d][\d.,]*\s?%?)$/;

// ---- stats ---------------------------------------------------------------------------

export async function mapStats(my?: number, embedded = false) {
  my ??= beginFlow("character", "Character stats", 1);
  const key = useSettings.getState().settings.hotkeys.judge;
  const rect = await guideGameRect();
  if (!rect) return;
  const found: Record<string, string> = {};
  let lastNew = Date.now();
  let started = false;
  guideSet({
    instruction: "Open Character → Materials & Stats",
    detail: `Press C, then open the stats list. I'll read every line — scroll down slowly when I ask. Press ${key} when you reach the bottom · ${pauseKey()} pauses.`,
    items: [],
    highlights: [],
  });
  const res = await guideWait(
    async () => {
      const cap = await captureRegion(rect, { ocr: true, ocrMaxChannel: true, maxEdge: 64, quality: 50 });
      let added = 0;
      for (const row of rows(cap.ocr?.lines ?? [])) {
        const m = row.match(STAT_ROW);
        if (!m) continue;
        const label = m[1].replace(/\s+/g, " ").trim();
        if (label.length < 4 || /item power|sell value|requires|durability/i.test(label)) continue;
        if (found[label] !== m[2]) {
          if (!(label in found)) added++;
          found[label] = m[2].replace(/\s+/g, "");
        }
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

function bestName(lines: string[], names: { slug: string; name: string }[], min = 0.8) {
  let best: { slug: string; name: string; score: number; i: number } | null = null;
  lines.forEach((l, i) => {
    for (const n of names) {
      const s = trigramSim(l, n.name);
      if (s >= min && (!best || s > best.score)) best = { ...n, score: s, i };
    }
  });
  return best as { slug: string; name: string; score: number; i: number } | null;
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
      // the skill's title sits just above its "Rank" line — look there first
      const ri = lines.findIndex((l) => /rank/i.test(l));
      const near = ri >= 0 ? lines.slice(Math.max(0, ri - 6), ri + 1) : lines;
      const hit = bestName(near, names, 0.75) ?? (ri < 0 ? null : bestName(lines, names, 0.85));
      const text = lines.join(" ");
      const m =
        text.match(/rank\s*(\d+)\s*\/\s*(\d+)/i) ??
        text.match(/(\d+)\s*\/\s*(\d+)\s*rank/i) ??
        text.match(/rank\s*:?\s*(\d+)/i) ??
        text.match(/lv?l\.?\s*(\d+)/i);
      // log misses so the reader can be tuned on your real tooltips
      if ((!hit || !m) && /rank|cooldown|lucky hit|essence|skill/i.test(text) && Date.now() - lastSkillLog > 4000) {
        lastSkillLog = Date.now();
        invoke("debug_log_write", { name: `skillhover_${new Date().toISOString().replace(/[:.]/g, "-")}`, image: null, json: JSON.stringify({ hit, rank: m?.[0] ?? null, lines }, null, 1) }).catch(() => {});
      }
      if (!hit || !m) return false;
      useCharacter.getState().setSkill(hit.slug, { name: hit.name, rank: Number(m[1]), max: m[2] ? Number(m[2]) : null });
      const it = items.find((i) => i.key === hit.slug || normName(i.label) === normName(hit.name));
      if (it && !it.done) {
        it.done = true;
        it.note = `rank ${m[1]}${m[2] ? "/" + m[2] : ""}`;
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

export async function mapGlyphs(my?: number, embedded = false) {
  my ??= beginFlow("character", "Paragon glyphs", 1);
  const { variant } = getActiveVariant();
  const key = useSettings.getState().settings.hotkeys.judge;
  const cls = (getActiveVariant().build?.className ?? "").toLowerCase();
  const names = Object.entries(table("glyphs"))
    .filter(([, g]) => !cls || !g.c || g.c === cls)
    .map(([slug, g]) => ({ slug, name: g.n }));
  const doneG = useCharacter.getState().session?.glyphs ?? [];
  const items: GuideItem[] = (variant?.paragon ?? []).map((p) => ({ key: p.glyphSlug, label: `${p.glyphName} (build: lvl ${p.glyphLevel})`, done: doneG.includes(p.glyphSlug), note: doneG.includes(p.glyphSlug) ? "done earlier" : undefined }));
  guideSet({
    instruction: "Abilities → Paragon: hover each glyph",
    detail: `Press A, open the Paragon tab, then hover each glyph in the grid at the bottom of the panel (or its socket on the board) so the tooltip shows its level. Press ${key} when done · ${pauseKey()} pauses.`,
    items,
    highlights: [],
  });
  const res = await guideWait(
    async () => {
      const lines = await hoverText();
      // the glyph's name sits right above its level / rank line; short names ("Essence") also
      // appear in normal stats, so only look next to that line
      const li = lines.findIndex((l) => /\b(level|rank)\s*:?\s*\d+/i.test(l) || /\bglyph\b/i.test(l));
      const near = li >= 0 ? lines.slice(Math.max(0, li - 4), li + 2) : [];
      const hit = near.length ? bestName(near, names, 0.8) : null;
      const m = near.join(" ").match(/\b(?:level|rank)\s*:?\s*(\d+)/i) ?? lines.join(" ").match(/glyph[^\d]{0,20}(\d+)/i);
      if ((!hit || !m) && li >= 0 && Date.now() - lastSkillLog > 4000) {
        lastSkillLog = Date.now();
        invoke("debug_log_write", { name: `glyphhover_${new Date().toISOString().replace(/[:.]/g, "-")}`, image: null, json: JSON.stringify({ hit, level: m?.[0] ?? null, near, lines: lines.slice(0, 60) }, null, 1) }).catch(() => {});
      }
      if (!hit || !m) return false;
      const level = Number(m[1]);
      useCharacter.getState().setGlyph(hit.slug, { name: hit.name, level });
      const it = items.find((i) => i.key === hit.slug);
      if (it && !it.done) {
        it.done = true;
        const want = variant?.paragon.find((p) => p.glyphSlug === hit.slug)?.glyphLevel ?? 0;
        it.note = `lvl ${level}${want && level < want ? ` — ${want - level} to go` : " ✓"}`;
        useCharacter.getState().patchSession({ glyphs: [...(useCharacter.getState().session?.glyphs ?? []), it.key] });
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
  guideSet({ instruction: "Character mapped ✓", detail: "See the Character page — the coach now knows your real stats, skills and glyphs.", items: [] });
  playTone("bis", useSettings.getState().settings.alerts.volume);
  await guideSleep(4000);
  if (flowAlive(my)) cancelGuide();
}

/** Hotkey / chord: start, pause (progress kept) or resume the character mapping. */
export function toggleMapCharacter() {
  const g = useGuide.getState();
  if (g.active && g.flow === "character") {
    cancelGuide();
    overlayToast("Character mapping paused", `Progress saved — press ${pauseKey()} to pick up where you left off.`, "#d4ad62", 6000);
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
  if (Object.keys(c.skills).length) parts.push("SKILL RANKS (read in game):\n" + Object.values(c.skills).map((s) => `- ${s.name}: rank ${s.rank}${s.max ? "/" + s.max : ""}`).join("\n"));
  if (Object.keys(c.glyphs).length) parts.push("GLYPHS (read in game):\n" + Object.values(c.glyphs).map((g) => `- ${g.name}: level ${g.level}`).join("\n"));
  return parts.join("\n\n");
}

// background loops hold references to this module: reload the page instead of hot-swapping
if (import.meta.hot) import.meta.hot.accept(() => window.location.reload());
