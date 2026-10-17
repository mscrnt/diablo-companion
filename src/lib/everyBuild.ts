// The loot judge checks every build of every character: the stash is shared by the whole account.
// The active build decides first. When it has no use for the item, another build that does says what
// to do with it: keep it in your bag for another build of this character, or stash it for another
// character. Only when no build of any character can use it does it get scrapped or sold.
import { decide, type Ctx } from "./judge";
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

/** The active build's verdict, unless it has no use for the item and another build does. */
export function judgeEveryBuild(item: ParsedItem, scored: Out, others: OtherBuild[], shared: Pick<Ctx, "cubeHint" | "inCodex"> = {}): Out {
  if (item.equipped || !unused(scored)) return scored;
  // the game compares with what THIS character wears: another character has its own gear
  const alone: ParsedItem = { ...item, compare: null, compareRows: undefined, compareKind: null, toughness: undefined, rawText: item.rawText?.split(/properties lost when equipped/i)[0] };
  let best: { o: OtherBuild; r: Out; rank: number } | null = null;
  for (const o of others) {
    const r = decide(o.sameCharacter ? item : alone, o.variant, { ...shared, prog: o.prog, worn: o.worn, talisman: o.talisman, className: o.build.className });
    const rank = USES.indexOf(r.verdict);
    if (rank < 0) continue;
    // the better use wins; on a tie, this character's own builds
    if (!best || rank < best.rank || (rank === best.rank && o.sameCharacter && !best.o.sameCharacter)) best = { o, r, rank };
  }
  return best ? forOther(scored, best.o, best.r) : scored;
}

function forOther(scored: Out, o: OtherBuild, r: Out): Out {
  const slot = o.variant.gear.find((g) => g.slot === r.slot)?.slotLabel;
  const forWhom = o.sameCharacter ? `your ${o.build.name} build` : `your ${whose(o.character)}`;
  const reasons = [`${o.build.name}${slot ? `, ${slot}` : ""}: ${r.action ?? ""}`, ...r.reasons];
  // the build's power for the Codex, which every character shares
  if (r.verdict === "EXTRACT") return { ...scored, verdict: "EXTRACT", action: r.action, reasons: [`For ${forWhom}.`, ...r.reasons] };
  if (o.sameCharacter) {
    const action = r.verdict === "WEAR" ? `Keep it: an upgrade for your ${o.build.name} build.` : `Keep it: your ${o.build.name} build uses it.`;
    return { ...scored, verdict: "KEEP", action, reasons };
  }
  return { ...scored, verdict: "STASH", action: `Stash it: great for your ${whose(o.character)}.`, reasons };
}
