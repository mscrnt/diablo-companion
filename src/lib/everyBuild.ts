// The loot judge checks every build of every character: the stash is shared by the whole account.
// The active build decides first. When it has no use for the item, another build that does says what
// to do with it: keep it in your bag for another build of this character, or stash it for another
// character, or for a build waiting in your library. Only when no build of yours can use it does it
// get scrapped or sold.
import { decide, sameItem, type Ctx } from "./judge";
import type { Build, BuildVariant, ParsedItem, SlotProgress, Talisman, Verdict } from "./types";

type Out = ReturnType<typeof decide>;

/** A build other than the active one, with what's known about the character that plays it. */
export interface OtherBuild {
  build: Build;
  variant: BuildVariant;
  prog: (slot: string) => SlotProgress;
  /** what that character wears (only for its active build: the gear memory is kept for that one) */
  worn?: (slot: string) => ParsedItem | undefined;
  talisman?: Talisman;
  /** a build of the character you're playing now */
  sameCharacter: boolean;
  /** a build in your library that no character has yet (library.ts) */
  library?: boolean;
  /** a later setup of the build you play (its Endgame when you follow its Leveling one): only its uniques count */
  setup?: boolean;
  /** the setup you follow now, for a later one: a unique both wear is judged by the one you follow */
  setupFrom?: BuildVariant;
  character: { name: string; className: string };
}

/** Verdicts that mean a build has a use for the item, best first. */
const USES: Verdict[] = ["WEAR", "CUBE", "SOCKET", "EXTRACT"];

/** The active build has no use for it: scrap, sell, no build yet, or a stash that isn't for this build. */
function unused(r: Out): boolean {
  return r.verdict === "SCRAP" || r.verdict === "SELL" || r.verdict === "UNKNOWN" || (r.verdict === "STASH" && !/your build uses/i.test(r.action ?? ""));
}

/** "Necromancer (Bazaq)", or just the class while the name hasn't been read. */
const whose = (c: OtherBuild["character"]) => {
  const cls = c.className ? c.className.charAt(0).toUpperCase() + c.className.slice(1) : "other character";
  return c.name ? `${cls} (${c.name})` : cls;
};

/** A tie goes to this character's own builds, then another character's, then the library's. */
const closest = (o: OtherBuild) => (o.sameCharacter ? 2 : o.library ? 0 : 1);

/** The active build's verdict, unless it has no use for the item and another build does. */
export function judgeEveryBuild(item: ParsedItem, scored: Out, others: OtherBuild[], shared: Pick<Ctx, "cubeHint" | "inCodex"> = {}): Out {
  if (item.equipped || !unused(scored)) return scored;
  // the game compares with what THIS character wears: another character has its own gear
  const alone: ParsedItem = { ...item, compare: null, compareRows: undefined, compareKind: null, toughness: undefined, rawText: item.rawText?.split(/properties lost when equipped/i)[0] };
  let best: { o: OtherBuild; r: Out; rank: number } | null = null;
  // the later setups whose gear names this unique, whether or not you have one yet: named together so the
  // verdict reads the same each time
  const unique = /unique|mythic/i.test(item.rarity ?? "");
  const wears = (v: BuildVariant) => v.gear.find((g) => (g.kind === "unique" || g.kind === "mythic") && sameItem(item.name, g.itemName));
  const wornBy = (o: OtherBuild) => wears(o.variant);
  // a unique the setup you follow wears too was already judged by it: a weaker copy isn't kept "for later"
  const setups = unique ? others.filter((o) => o.setup && wornBy(o) && !(o.setupFrom && wears(o.setupFrom))) : [];
  for (const o of others) {
    if (o.setup) continue;
    const r = decide(o.sameCharacter ? item : alone, o.variant, { ...shared, prog: o.prog, worn: o.worn, talisman: o.talisman, className: o.build.className, elsewhere: !o.sameCharacter });
    const rank = USES.indexOf(r.verdict);
    if (rank < 0) continue;
    // another character's gear isn't known: judged on its own stats, two of the build's are a coin flip that
    // stashed and scrapped the same gloves by turns (2026-11-02)
    if (!o.sameCharacter && r.verdict === "WEAR" && /^probably wear/i.test(r.action ?? "") && r.matched.length < 3) continue;
    // the better use wins; on a tie, the build closest to the character you play
    if (!best || rank < best.rank || (rank === best.rank && closest(o) > closest(best.o))) best = { o, r, rank };
  }
  if (best) return forOther(scored, best.o, best.r);
  if (!setups.length) return scored;
  const slot = wornBy(setups[0])!.slotLabel;
  const names = setups.map((o) => o.variant.name);
  return { ...scored, verdict: "STASH", action: `Stash it: your build's ${list(names)} setup${names.length > 1 ? "s wear" : " wears"} it (${slot}).`, reasons: scored.reasons.slice(0, 3) };
}

const list = (xs: string[]) => (xs.length < 2 ? xs.join("") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`);

function forOther(scored: Out, o: OtherBuild, r: Out): Out {
  const slot = o.variant.gear.find((g) => g.slot === r.slot)?.slotLabel;
  const forWhom = o.library ? `the ${o.build.name} build in your library` : o.sameCharacter ? `your ${o.build.name} build` : `your ${whose(o.character)}`;
  const reasons = [`${o.build.name}${slot ? `, ${slot}` : ""}: ${r.action ?? ""}`, ...r.reasons];
  // the build's power for the Codex, which every character shares
  if (r.verdict === "EXTRACT") return { ...scored, verdict: "EXTRACT", action: r.action, reasons: [`For ${forWhom}.`, ...r.reasons] };
  // a build no character has yet: the item waits in the stash for the day you play it
  if (o.library) return { ...scored, verdict: "STASH", action: `Stash it: fits the ${o.build.name} build in your library.`, reasons };
  if (o.sameCharacter) {
    const action = r.verdict === "WEAR" ? `Keep it: an upgrade for your ${o.build.name} build.` : `Keep it: your ${o.build.name} build uses it.`;
    return { ...scored, verdict: "KEEP", action, reasons };
  }
  return { ...scored, verdict: "STASH", action: `Stash it: great for your ${whose(o.character)}.`, reasons };
}
