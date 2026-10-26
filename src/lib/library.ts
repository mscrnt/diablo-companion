// The build library: every build you ever imported, grouped by class. A build a character plays lives in
// that character's own gear (store.ts useBuilds, profiles.ts), and a build no character has yet waits in
// useLibrary. Importing a Barbarian guide while you play your Necromancer puts it in the library instead of
// making it the build the loot judge follows, and the day you play a Barbarian she takes it (attachLibrary).
// A build is in one place only: on a character, or in the library, never both.
import { overlayToast } from "./alerts";
import { debugEvent } from "./debug";
import type { OtherBuild } from "./everyBuild";
import { emptyGear, emptyProgress, liveGear, useBuilds, useLibrary, useProfiles, type GearData, type Profile } from "./store";
import type { Build, SlotProgress } from "./types";

/** The library itself, as a place a build can be moved to. */
export const LIBRARY = "library";

const sameClass = (a: string, b: string) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/** "Barbarian", or a stand-in for a build whose site never said the class. */
export const classLabel = (c: string) => (c ? c.charAt(0).toUpperCase() + c.slice(1) : "Class not known");

/** The variant to play: the one picked for this build, else its last (the endgame one on every site). */
const variantFor = (b: Build, picked?: string | null) => (picked && b.variants.some((v) => v.id === picked) ? picked : b.variants[b.variants.length - 1]?.id ?? null);

const progressOf = (progress: Record<string, SlotProgress>, id: string) => Object.fromEntries(Object.entries(progress).filter(([k]) => k.startsWith(`${id}:`)));

/**
 * Where an imported build goes: to the character you play, or to the library only. A character whose class
 * isn't known yet (first run), and a build whose site didn't say the class, both count as a fit.
 */
export function importRoute(characterClass: string, buildClass: string): "character" | "library" {
  if (!characterClass || !buildClass) return "character";
  return sameClass(characterClass, buildClass) ? "character" : "library";
}

/** What to say when a build goes to the library instead of the character you play. */
export function libraryMessage(b: Build, characterClass: string, who: string): string {
  return `Saved to your library under ${classLabel(b.className)}. ${who} is a ${classLabel(characterClass)}, so it isn't the build the loot judge follows.`;
}

/** One build in the library, with the character that plays it (null: no character has it yet). */
export interface LibraryRow {
  build: Build;
  variantId: string | null;
  owner: { id: string; name: string } | null;
  /** the active build of the character that has it */
  active: boolean;
}

/** Every build there is, as plain data: each character's, then the ones no character has. */
export function libraryRows(input: { profiles: Profile[]; activeId: string; live: GearData; library: Record<string, Build>; variantOf?: Record<string, string> }): LibraryRow[] {
  const rows: LibraryRow[] = [];
  const seen = new Set<string>();
  for (const p of input.profiles) {
    const g = p.id === input.activeId ? input.live : p.gear;
    if (!g) continue;
    for (const b of Object.values(g.builds)) {
      if (seen.has(b.id)) continue;
      seen.add(b.id);
      const active = b.id === g.activeBuildId;
      rows.push({ build: b, variantId: variantFor(b, active ? g.activeVariantId : g.variantOf[b.id]), owner: { id: p.id, name: p.name }, active });
    }
  }
  for (const b of Object.values(input.library)) {
    if (seen.has(b.id)) continue;
    seen.add(b.id);
    rows.push({ build: b, variantId: variantFor(b, input.variantOf?.[b.id]), owner: null, active: false });
  }
  return rows;
}

/** The library grouped by class, each class's builds by name; builds with no class come last. */
export function byClass(rows: LibraryRow[]): { className: string; rows: LibraryRow[] }[] {
  const groups = new Map<string, LibraryRow[]>();
  for (const r of rows) {
    const k = classLabel(r.build.className);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k)!.push(r);
  }
  const unknown = classLabel("");
  return [...groups.entries()]
    .map(([className, rs]) => ({ className, rows: rs.sort((a, b) => a.build.name.localeCompare(b.build.name)) }))
    .sort((a, b) => Number(a.className === unknown) - Number(b.className === unknown) || a.className.localeCompare(b.className));
}

/** The library builds that belong to a character of this class (none while its class isn't known). */
export function attachable(cls: string, library: Record<string, Build>): Build[] {
  return cls ? Object.values(library).filter((b) => sameClass(cls, b.className)) : [];
}

/** Every build there is, read off the stores. */
export function libraryOf(): LibraryRow[] {
  const { profiles, activeId } = useProfiles.getState();
  const lib = useLibrary.getState();
  return libraryRows({ profiles: Object.values(profiles), activeId, live: liveGear(), library: lib.builds, variantOf: lib.variantOf });
}

/** Where a build lives now: a profile id, LIBRARY, or "" when it's nowhere. */
export function ownerOf(id: string): string {
  if (useBuilds.getState().builds[id]) return useProfiles.getState().activeId;
  for (const p of Object.values(useProfiles.getState().profiles)) if (p.gear?.builds[id]) return p.id;
  return useLibrary.getState().builds[id] ? LIBRARY : "";
}

/** Keep a build in the library. A build a character already has stays where it is. */
export function toLibrary(b: Build, variantId?: string | null, progress?: Record<string, SlotProgress>): boolean {
  const owner = ownerOf(b.id);
  if (owner && owner !== LIBRARY) return false;
  useLibrary.getState().add(b, variantFor(b, variantId), progress);
  return true;
}

export type Landing = { to: "library"; text: string } | { to: "character" };

/**
 * An imported build: the character you play gets it, unless it's for another class, and then the library
 * keeps it and `text` says so. `className` is what the character has shown (profiles.ts shownClass).
 */
export function landBuild(b: Build, opts: { className: string; label: string; variant?: string }): Landing {
  if (importRoute(opts.className, b.className) === "character") {
    // the same build re-imported while you play that class: it's the character's now
    useLibrary.getState().remove(b.id);
    useBuilds.getState().addBuild(b, opts.variant);
    return { to: "character" };
  }
  toLibrary(b, opts.variant);
  debugEvent("library", "import", { className: b.className, character: opts.className, variants: b.variants.length });
  return { to: "library", text: libraryMessage(b, opts.className, opts.label) };
}

/**
 * The character you play takes every library build for its class, and plays the first one if it had no
 * build yet. Automatic on purpose: there's nothing to tick. Returns the builds it took.
 */
export function attachLibrary(cls: string, who: string): Build[] {
  const lib = useLibrary.getState();
  const mine = attachable(cls, lib.builds);
  if (!mine.length) return [];
  const s = useBuilds.getState();
  const builds = { ...s.builds };
  const variantOf = { ...s.variantOf };
  const progress = { ...s.progress };
  let activeBuildId = s.activeBuildId;
  let activeVariantId = s.activeVariantId;
  for (const b of mine) {
    builds[b.id] = b;
    const v = variantFor(b, lib.variantOf[b.id]);
    if (v) variantOf[b.id] = v;
    Object.assign(progress, progressOf(lib.progress, b.id));
    if (!activeBuildId) {
      activeBuildId = b.id;
      activeVariantId = v;
    }
  }
  useBuilds.setState({ builds, variantOf, progress, activeBuildId, activeVariantId });
  lib.remove(...mine.map((b) => b.id));
  debugEvent("library", "attach", { n: mine.length, className: cls });
  const target = who || "this character";
  const names = mine.map((b) => b.name);
  if (mine.length === 1) overlayToast(`Your ${names[0]} build is ready for ${target}`, "Taken from your library.", "#d4ad62", 6000);
  else overlayToast(`${mine.length} builds are ready for ${target}`, `From your library: ${names.join(", ")}.`, "#d4ad62", 7000);
  return mine;
}

/** The same gear without that build: its variant and progress go too, and another build plays if it was active. */
function dropBuild(g: GearData, id: string): GearData {
  const builds = { ...g.builds };
  delete builds[id];
  const variantOf = { ...g.variantOf };
  delete variantOf[id];
  const progress = Object.fromEntries(Object.entries(g.progress).filter(([k]) => !k.startsWith(`${id}:`)));
  if (g.activeBuildId !== id) return { ...g, builds, variantOf, progress };
  const next = Object.values(builds)[0];
  return { ...g, builds, variantOf, progress, activeBuildId: next?.id ?? null, activeVariantId: next ? variantFor(next, variantOf[next.id]) : null };
}

/** Take a build out of wherever it lives, with the variant you picked and its tracked progress. */
function takeBuild(id: string): { build: Build; variantId: string | null; progress: Record<string, SlotProgress> } | null {
  const lib = useLibrary.getState();
  if (lib.builds[id]) {
    const out = { build: lib.builds[id], variantId: lib.variantOf[id] ?? null, progress: progressOf(lib.progress, id) };
    lib.remove(id);
    return out;
  }
  const s = useBuilds.getState();
  if (s.builds[id]) {
    const out = { build: s.builds[id], variantId: s.activeBuildId === id ? s.activeVariantId : s.variantOf[id] ?? null, progress: progressOf(s.progress, id) };
    useBuilds.setState(dropBuild(liveGear(), id));
    return out;
  }
  const { profiles } = useProfiles.getState();
  for (const p of Object.values(profiles)) {
    const g = p.gear;
    if (!g?.builds[id]) continue;
    const out = { build: g.builds[id], variantId: g.activeBuildId === id ? g.activeVariantId : g.variantOf[id] ?? null, progress: progressOf(g.progress, id) };
    useProfiles.setState({ profiles: { ...profiles, [p.id]: { ...p, gear: dropBuild(g, id) } } });
    return out;
  }
  return null;
}

type Taken = NonNullable<ReturnType<typeof takeBuild>>;

/** The gear with that build added: a character without a build plays the one it gets. */
function withBuild(g: GearData, t: Taken): GearData {
  const v = variantFor(t.build, t.variantId);
  return {
    ...g,
    builds: { ...g.builds, [t.build.id]: t.build },
    progress: { ...g.progress, ...t.progress },
    variantOf: v ? { ...g.variantOf, [t.build.id]: v } : g.variantOf,
    activeBuildId: g.activeBuildId ?? t.build.id,
    activeVariantId: g.activeBuildId ? g.activeVariantId : v,
  };
}

/**
 * Move a build: between characters, from the library onto a character, or back to the library (LIBRARY).
 * Its variant and tracked progress go with it. Nothing moves if the build or the target is gone.
 */
export function assignBuild(id: string, toId: string): boolean {
  const { profiles, activeId } = useProfiles.getState();
  if (toId !== LIBRARY && !profiles[toId]) return false;
  if (ownerOf(id) === toId) return false;
  const t = takeBuild(id);
  if (!t) return false;
  if (toId === LIBRARY) useLibrary.getState().add(t.build, t.variantId, t.progress);
  else if (toId === activeId) useBuilds.setState(withBuild(liveGear(), t));
  else useProfiles.setState((s) => ({ profiles: { ...s.profiles, [toId]: { ...s.profiles[toId], gear: withBuild(s.profiles[toId].gear ?? emptyGear(), t) } } }));
  debugEvent("library", "assign", { to: toId === LIBRARY ? LIBRARY : toId.slice(0, 8), className: t.build.className });
  return true;
}

/** Forget a build for good, wherever it lives. */
export function forgetBuild(id: string) {
  const lib = useLibrary.getState();
  if (lib.builds[id]) return lib.remove(id);
  if (useBuilds.getState().builds[id]) return useBuilds.setState(dropBuild(liveGear(), id));
  const { profiles } = useProfiles.getState();
  for (const p of Object.values(profiles)) if (p.gear?.builds[id]) useProfiles.setState({ profiles: { ...profiles, [p.id]: { ...p, gear: dropBuild(p.gear, id) } } });
}

/**
 * The library's own builds for the loot judge: a build no character has can still say "stash it" for an
 * item, so nothing waiting for a build you mean to play gets scrapped. It can never scrap anything itself:
 * judgeEveryBuild only ever softens the active build's verdict (everyBuild.ts).
 */
export function libraryBuilds(): OtherBuild[] {
  const { builds, variantOf, progress } = useLibrary.getState();
  const out: OtherBuild[] = [];
  for (const b of Object.values(builds)) {
    const variant = b.variants.find((v) => v.id === variantOf[b.id]) ?? b.variants[b.variants.length - 1];
    if (!variant) continue;
    out.push({
      build: b,
      variant,
      prog: (slot) => progress[`${b.id}:${variant.id}:${slot}`] ?? emptyProgress,
      sameCharacter: false,
      library: true,
      character: { name: "", className: b.className },
    });
  }
  return out;
}
