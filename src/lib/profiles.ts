// Character profiles: one per character, each with its own builds, worn gear, gear progress and
// mapped stats, skills and glyphs. The character is read off the Character panel (charname.ts): a
// name read with confidence switches to its profile, and a name never seen before gets a new one.
// The active character's data lives in the usual stores (useBuilds, useCharacter), so the rest of the
// app only ever sees that character; switching saves it into its profile and loads the other one.
// Names stay on this computer: never in debug events, and shared judgements drop them (privacy.ts).
import { overlayToast } from "./alerts";
import { useCharacter, type CharacterProfile } from "./charmap";
import { readCharacterName, sameName } from "./charname";
import { debugEvent } from "./debug";
import type { OtherBuild } from "./everyBuild";
import { table } from "./names";
import { emptyProgress, emptyTalisman, newProfile, useBuilds, useProfiles, type GearData, type Profile } from "./store";

const gearOf = (): GearData => {
  const s = useBuilds.getState();
  return { builds: s.builds, activeBuildId: s.activeBuildId, activeVariantId: s.activeVariantId, progress: s.progress, variantOf: s.variantOf, worn: s.worn, talisman: s.talisman };
};
const emptyGear = (): GearData => ({ builds: {}, activeBuildId: null, activeVariantId: null, progress: {}, variantOf: {}, worn: {}, talisman: emptyTalisman });

const sheetOf = (): CharacterProfile => {
  const c = useCharacter.getState();
  return { session: c.session, stats: c.stats, statsAt: c.statsAt, statsV: c.statsV, skills: c.skills, glyphs: c.glyphs };
};
const emptySheet = (): CharacterProfile => ({ session: null, stats: {}, statsAt: 0, statsV: 1, skills: {}, glyphs: {} });

/** All three stores loaded from disk: switching before that would save half-loaded data. */
const ready = () => useProfiles.persist.hasHydrated() && useBuilds.persist.hasHydrated() && useCharacter.persist.hasHydrated();

export const activeProfile = (): Profile => {
  const { profiles, activeId } = useProfiles.getState();
  return profiles[activeId];
};

/** A profile's builds and gear: the live ones for the active character. */
const gearFor = (p: Profile): GearData => (p.id === useProfiles.getState().activeId ? gearOf() : p.gear ?? emptyGear());

/** "Bazaq", or a stand-in while the name hasn't been read. */
export const profileLabel = (p: Profile) => p.name || "Your character";

/**
 * A profile's class ("Necromancer"): its active build's, else the one saved with it, else the class of
 * the skills read in game (Map my character).
 */
export function profileClass(p: Profile): string {
  const g = gearFor(p);
  const build = (g.activeBuildId && g.builds[g.activeBuildId]) || Object.values(g.builds)[0];
  if (build?.className) return build.className;
  if (p.className) return p.className;
  const sheet = p.id === useProfiles.getState().activeId ? sheetOf() : p.sheet;
  const votes: Record<string, number> = {};
  for (const slug of Object.keys(sheet?.skills ?? {})) {
    const c = table("skills")[slug]?.c;
    if (c) votes[c] = (votes[c] ?? 0) + 1;
  }
  const top = Object.entries(votes).sort((a, b) => b[1] - a[1])[0]?.[0] ?? "";
  return top && top.charAt(0).toUpperCase() + top.slice(1);
}

/** Make another character active: the current one's builds, gear and stats go into its profile, the other's come out. */
export function switchProfile(id: string): boolean {
  const { profiles, activeId } = useProfiles.getState();
  const to = profiles[id];
  if (!to || id === activeId) return false;
  const from = profiles[activeId];
  const saved = from ? { [activeId]: { ...from, gear: gearOf(), sheet: sheetOf() } } : {};
  useBuilds.setState(to.gear ?? emptyGear());
  useCharacter.setState(to.sheet ?? emptySheet());
  useProfiles.setState({ activeId: id, profiles: { ...profiles, ...saved, [id]: { ...to, gear: null, sheet: null, seenAt: Date.now() } } });
  // the profile's id only: names never go in the debug log
  debugEvent("profiles", "switch", { to: id.slice(0, 8), builds: Object.keys(to.gear?.builds ?? {}).length });
  return true;
}

/** A new, empty profile for a character (not made active). Returns its id. */
export function createProfile(name: string): string {
  const id = crypto.randomUUID();
  useProfiles.setState((s) => ({ profiles: { ...s.profiles, [id]: { ...newProfile(id, name), gear: emptyGear(), sheet: emptySheet() } } }));
  return id;
}

/** Forget a character you no longer play (never the active one). */
export function removeProfile(id: string) {
  useProfiles.setState((s) => {
    if (id === s.activeId || !s.profiles[id]) return s;
    const profiles = { ...s.profiles };
    delete profiles[id];
    return { profiles };
  });
}

/** Move one of the active character's builds, with its tracked progress, to another character. */
export function moveBuild(buildId: string, toId: string) {
  const { profiles, activeId } = useProfiles.getState();
  const to = profiles[toId];
  const s = useBuilds.getState();
  const b = s.builds[buildId];
  if (!to || toId === activeId || !b) return;
  const g = to.gear ?? emptyGear();
  const progress = Object.fromEntries(Object.entries(s.progress).filter(([k]) => k.startsWith(`${buildId}:`)));
  const variant = s.activeBuildId === buildId ? s.activeVariantId : s.variantOf[buildId] ?? b.variants[b.variants.length - 1]?.id ?? null;
  const gear: GearData = {
    ...g,
    builds: { ...g.builds, [buildId]: b },
    // a character without a build plays this one
    activeBuildId: g.activeBuildId ?? buildId,
    activeVariantId: g.activeBuildId ? g.activeVariantId : variant,
    progress: { ...g.progress, ...progress },
    variantOf: variant ? { ...g.variantOf, [buildId]: variant } : g.variantOf,
  };
  useProfiles.setState({ profiles: { ...profiles, [toId]: { ...to, gear } } });
  s.removeBuild(buildId);
}

export type Seen = "same" | "switched" | "named" | "new";

/**
 * The character on screen is `name`: switch to its profile, or give the unnamed first profile (the
 * data saved before profiles existed) its name, or make a new profile for it.
 */
export function characterSeen(name: string, now = Date.now()): Seen {
  const { profiles, activeId } = useProfiles.getState();
  const known = Object.values(profiles).find((p) => p.name && sameName(p.name, name));
  if (known) {
    if (known.id !== activeId) {
      switchProfile(known.id);
      return "switched";
    }
    // seen again: a write a minute at most
    if (now - known.seenAt > 60_000) useProfiles.setState((s) => ({ profiles: { ...s.profiles, [known.id]: { ...known, seenAt: now } } }));
    return "same";
  }
  const active = profiles[activeId];
  if (active && !active.name) {
    useProfiles.setState((s) => ({ profiles: { ...s.profiles, [activeId]: { ...active, name, seenAt: now } } }));
    return "named";
  }
  switchProfile(createProfile(name));
  return "new";
}

/** Reads of the name that agree, so one misread frame never switches characters. */
let vote: { name: string; n: number; at: number } | null = null;

/**
 * An OCR'd frame (auto-judge, activity scans, the character mapping): when it shows the Character
 * panel, its name counts as a read. Two agreeing reads switch to a known character, three make a new one.
 */
export function noteCharacterFrame(lines: { text: string }[], now = Date.now()) {
  const name = readCharacterName(lines);
  if (!name) return;
  vote = vote && sameName(vote.name, name) && now - vote.at < 30_000 ? { name: vote.name, n: vote.n + 1, at: now } : { name, n: 1, at: now };
  const known = Object.values(useProfiles.getState().profiles).some((p) => p.name && sameName(p.name, vote!.name));
  if (vote.n < (known ? 2 : 3) || !ready()) return;
  // (the debug log records toasts: it scrubs names, see debug.ts)
  const seen = characterSeen(vote.name, now);
  const who = activeProfile().name;
  if (seen === "switched") overlayToast(`Playing ${who}`, "Their builds and gear are loaded.", "#d4ad62", 5000);
  if (seen === "new") overlayToast(`New character: ${who}`, "Import a build for them on the Build page. Loot is still judged for your other characters.", "#d4ad62", 8000);
}

/** Every build except the one you play now: your other builds, then your other characters' builds. */
export function otherBuilds(): OtherBuild[] {
  const { profiles, activeId } = useProfiles.getState();
  const out: OtherBuild[] = [];
  for (const p of Object.values(profiles)) {
    const live = p.id === activeId;
    const g = gearFor(p);
    const character = { name: p.name, className: profileClass(p) };
    for (const b of Object.values(g.builds)) {
      const current = b.id === g.activeBuildId;
      if (live && current) continue;
      const variant = b.variants.find((v) => v.id === (current ? g.activeVariantId : g.variantOf[b.id])) ?? b.variants[b.variants.length - 1];
      if (!variant) continue;
      out.push({
        build: b,
        variant,
        prog: (slot) => g.progress[`${b.id}:${variant.id}:${slot}`] ?? emptyProgress,
        // what a character wears was recorded for the build it plays
        worn: current ? (slot) => g.worn[slot] : undefined,
        talisman: current ? g.talisman : undefined,
        sameCharacter: live,
        character,
      });
    }
  }
  return out.sort((a, b) => Number(b.sameCharacter) - Number(a.sameCharacter));
}
