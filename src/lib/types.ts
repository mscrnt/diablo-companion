// Normalised domain model. Importers (Mobalytics today) convert into this so the
// rest of the app never touches a site's raw shape.

export type ItemKind =
  | "unique"
  | "mythic"
  | "aspect"
  | "charm"
  | "seal"
  | "chaosPerk"
  | "power"
  | "other";

export interface StatRef {
  slug: string;
  name: string;
  greater?: boolean;
  masterwork?: boolean;
}

export interface SocketRef {
  slug: string;
  name: string;
  kind: "gem" | "rune" | "other";
}

export interface GearSlot {
  /** stable key, e.g. "helm", "ring-1", "season-12-charm-5" */
  slot: string;
  slotLabel: string;
  group: "gear" | "talisman" | "chaos" | "other";
  itemSlug: string;
  itemName: string;
  kind: ItemKind;
  icon?: string;
  affixes: StatRef[];
  tempers: StatRef[];
  sockets: SocketRef[];
  implicits: StatRef[];
  /** cube transfigure / kullean imprint / charm & seal stats */
  extras: { label: string; stats: StatRef[] }[];
}

export interface SkillPoint {
  slug: string;
  name: string;
  /** "basic" | "enhancement" | ... */
  type: string;
}

export interface SkillBarEntry {
  position: number;
  slug: string;
  name: string;
  description: string;
  icon?: string;
}

export interface SummonSpec {
  type: string;
  slug: string;
  name: string;
  description: string;
}

export interface ParagonBoard {
  slug: string;
  name: string;
  glyphSlug: string;
  glyphName: string;
  glyphLevel: number;
  x: number;
  y: number;
  rotation: number;
  nodes: string[];
}

export interface Mercenary {
  primary?: string;
  reinforcement?: string;
  reinforcementSkill?: string;
  trigger?: string;
  skills: string[];
}

export interface GuideSection {
  id: string;
  title: string;
  text: string;
  kind: string;
}

export interface BuildVariant {
  id: string;
  name: string;
  description: string;
  gear: GearSlot[];
  skillOrder: SkillPoint[];
  skillRanks: Record<string, number>;
  skillBar: SkillBarEntry[];
  summons: SummonSpec[];
  paragon: ParagonBoard[];
  mercenary: Mercenary;
  /** ordered list of item slugs the author says to get first */
  priority: string[];
  sections: GuideSection[];
}

export interface Build {
  id: string;
  source: "mobalytics";
  url: string;
  slug: string;
  name: string;
  author: string;
  className: string;
  season: string;
  tags: { group: string; name: string }[];
  updatedAt: string;
  fetchedAt: string;
  variants: BuildVariant[];
  sections: GuideSection[];
}

// ---- progress tracking --------------------------------------------------

export type OwnState = "missing" | "have" | "upgrade" | "perfect";

export interface SlotProgress {
  state: OwnState;
  /** affix slugs the owned item already has as Greater */
  greater: string[];
  /** affix slugs present at all */
  have: string[];
  tempered: boolean;
  masterwork: number; // 0..12
  note?: string;
}

// ---- loot judge ----------------------------------------------------------

export interface ParsedAffix {
  text: string;
  greater: boolean;
  tempered?: boolean;
  /** rerolled at the Occultist (blue ring icon) — the item's one enchant is used */
  enchanted?: boolean;
  /** the masterwork bonus landed on this stat (purple-blue square icon) */
  masterwork?: boolean;
  /** stat name from the build this affix maps to (LLM + fuzzy) */
  match?: string | null;
}


export interface ParsedItem {
  name: string;
  rarity: string;
  itemType: string;
  slot: string;
  itemPower: number | null;
  ancestral?: boolean;
  affixes: ParsedAffix[];
  /** imprinted = the power came from your Codex ("Imprinted: …"), so extracting it gains nothing */
  aspect?: { name: string; text: string; imprinted?: boolean } | null;
  sockets?: number;
  rawText?: string;
  /** the hovered tooltip is an item the character is wearing */
  equipped?: boolean;
  /** gear (default) or something you socket / slot into the talisman / consume */
  category?: "gear" | "socketable" | "talisman" | "tribute" | "consumable";
  /** the game shows "Scroll Down": some lines are hidden below the fold */
  truncated?: boolean;
  /** the title wasn't in the capture: `name` is the item type ("Legendary Sword") */
  untitled?: boolean;
  /** "Tempers: n/m" from the tooltip */
  tempersUsed?: number;
  /** the game's own Toughness change if you swap ("216 All Resist (-11.5% Toughness)") */
  toughness?: number;
  /** equipped item reconstructed from the game's comparison view (deltas + "Properties lost when equipped") */
  compare?: ParsedItem | null;
  /** what kind of item the game is comparing against ("Unique Power" / "Legendary Power" listed as lost) */
  compareKind?: "unique" | "legendary" | null;
  /** stat-by-stat: this item vs yours (null = that item doesn't have it) */
  compareRows?: CompareRow[];
}

export type Verdict =
  | "WEAR"
  | "WEARING"
  | "CUBE"
  | "EXTRACT"
  | "STASH"
  /** carry it and use it (keys, tributes, caches), or keep it in your bag for another build */
  | "KEEP"
  | "SCRAP"
  | "SELL"
  | "SOCKET"
  | "UNKNOWN"
  // legacy values from older history entries
  | "BIS"
  | "UPGRADE"
  | "IMPRINT"
  | "SALVAGE"
  | "EQUIPPED";

export interface JudgeResult {
  id: string;
  at: number;
  item: ParsedItem;
  verdict: Verdict;
  /** one plain-language instruction: what to do with this item */
  action?: string;
  /** ordered follow-ups: temper, masterwork, occultist, cube … */
  steps?: string[];
  score: number;
  slot: string | null;
  reasons: string[];
  matched: string[];
  missing: string[];
  greaterOnTargets: number;
  thumb?: string;
  advice?: string;
  ms: number;
  /** the player flagged this verdict as wrong (Loot page or hotkey) */
  flagged?: boolean;
  /** the character profile it was judged for (its id, see profiles.ts) */
  character?: string;
}

/** The seal and charms you were last seen wearing (talisman), for judging spares. */
export interface Talisman {
  seal: (ParsedItem & { at: number }) | null;
  charms: (ParsedItem & { at: number })[];
}

// ---- timers ---------------------------------------------------------------

export type EventKind = "worldBoss" | "helltide" | "legion" | "other";

export interface GameEvent {
  kind: EventKind;
  name: string;
  zone?: string;
  /** epoch ms */
  start: number;
  end?: number;
  source: string;
  extra?: Record<string, unknown>;
}

// ---- runs -----------------------------------------------------------------

export interface Run {
  id: string;
  activity: string;
  tier?: string;
  start: number;
  end?: number;
  /** `from`: an event inside the run (a dungeon's pop-up event) with its own start, not a step of the run */
  splits: { label: string; at: number; from?: number }[];
  notes?: string;
  loot?: string[];
  deaths?: number;
  success?: boolean;
  /** the character profile that ran it (its id, see profiles.ts) */
  character?: string;
}

export interface CompareRow {
  label: string;
  mine: number | null;
  yours: number | null;
  unit: string;
  wanted: boolean;
  match: string | null;
}
