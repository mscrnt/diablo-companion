// Which build and variant the loot judge follows, as one short line for the overlay and the Build page,
// so a player judging with the leveling variant while running endgame content notices.

/** "Minion Necro, Endgame": the active build's name without a trailing "Build Guide", and the variant. */
export function judgingFor(buildName: string | null | undefined, variantName: string | null | undefined): string | null {
  const full = buildName?.trim();
  if (!full) return null;
  const name = full.replace(/\s*[-:|]?\s*(build\s+guide|guide|build)$/i, "").trim() || full;
  const v = variantName?.trim();
  return v && v.toLowerCase() !== name.toLowerCase() ? `${name}, ${v}` : name;
}
