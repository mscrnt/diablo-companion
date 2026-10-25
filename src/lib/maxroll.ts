// Maxroll build importer: paste a build link, fetch that one planner profile, nothing else.
// The planner stores the game's own ids throughout: items, skills and runes by id, affixes,
// aspects and glyphs by sno number ("nid": 1829592). Everything is read against the tables built
// from the game on this PC (buildmap.ts: affixById, itemById, boardById, glyphById), so nothing of
// Maxroll's own is fetched or kept. Only the skill tree stays empty: it is the planner's own
// node numbering, which the game data has nothing to match.
import { affixById, aspectById, boardById, camelWords as camel, glyphById, itemById, itemKindOf, looseRef, refOf, skillNameOf, slotGroup, slotLabel, socketRef, sortGear } from "./buildmap";
import { slugOf } from "./gamedata/convert";
import { BROWSER_UA, http, httpJson } from "./http";
import { lexicalToText } from "./mobalytics";
import { humanize } from "./names";
import type { Build, BuildVariant, GearSlot, GuideSection, ParagonBoard, SkillBarEntry, StatRef } from "./types";

const PROFILE = "https://planners.maxroll.gg/profiles/d4/";
const PLANNER = /maxroll\.gg\/d4\/planner\/([a-z0-9]+)(?:#(\d+))?/i;

/**
 * A planner link (planners.maxroll.gg/profiles/d4/xf9um40q, maxroll.gg/d4/planner/xf9um40q#3)
 * names the profile; a build guide (maxroll.gg/d4/build-guides/…) embeds one.
 */
export function parseMaxrollUrl(input: string): { id?: string; profile?: string; guide?: string } {
  const s = input.trim();
  if (!s.includes("/")) return { id: s };
  const m = s.match(PLANNER);
  if (m) return { id: m[1], profile: m[2] };
  const u = new URL(s);
  const prof = u.pathname.match(/\/profiles\/d4\/([a-z0-9]+)/i);
  if (prof) return { id: prof[1], profile: u.hash.replace("#", "") || undefined };
  if (/maxroll\.gg$/i.test(u.hostname.replace(/^www\./, ""))) return { guide: u.toString() };
  return {};
}

/** The planner a build guide embeds ("…/d4/planner/xf9um40q#3"). */
export function extractPlanner(html: string): { id: string; profile?: string } {
  const m = html.match(PLANNER);
  if (!m) throw new Error("That Maxroll guide has no build planner on it");
  return { id: m[1], profile: m[2] };
}

export async function fetchMaxrollRaw(urlOrId: string): Promise<{ raw: any; id: string; profile?: string }> {
  let { id, profile, guide } = parseMaxrollUrl(urlOrId);
  if (!id && guide) {
    const r = await http(guide, { headers: { "User-Agent": BROWSER_UA } });
    if (!r.ok) throw new Error(`Maxroll would not hand over that guide page (HTTP ${r.status})`);
    ({ id, profile } = extractPlanner(await r.text()));
  }
  if (!id) throw new Error("That Maxroll link has no build planner in it");
  const r = await httpJson<any>(PROFILE + id, { headers: { Accept: "application/json", "User-Agent": BROWSER_UA }, timeoutMs: 30000 });
  if (!r?.data) throw new Error("Maxroll: that planner has no build on it");
  return { raw: { ...r, data: typeof r.data === "string" ? JSON.parse(r.data) : r.data }, id, profile };
}

// ---- normalisation --------------------------------------------------------

// the planner's equipment slots, in the game's order
const SLOTS: Record<string, string> = {
  "4": "helm",
  "5": "chest-armor",
  "6": "offhand",
  "7": "weapon",
  "8": "bludgeoning-weapon",
  "9": "slashing-weapon",
  "10": "ranged-weapon",
  "11": "dual-wield-weapon-1",
  "12": "dual-wield-weapon-2",
  "13": "gloves",
  "14": "pants",
  "15": "boots",
  "16": "ring-1",
  "17": "ring-2",
  "18": "amulet",
  "20": "seal",
  "21": "charm-1",
  "22": "charm-2",
  "23": "charm-3",
  "24": "charm-4",
  "25": "charm-5",
  "26": "charm-6",
};

/**
 * The name inside one of the game's item ids, when it holds one: "Runeword_Enigma" → Enigma,
 * "S15_Charm_Unique_HellfireTorch" → Hellfire Torch. An id that only says what kind of item
 * it is says so instead ("Ring_Unique_Generic_105" → "Unique Ring"): the planner keeps no
 * name for it, and the app never asks Maxroll which one it is.
 */
export function itemNameOf(id: string): { name: string; named: boolean } {
  const s = String(id ?? "").replace(/^S\d+_(?:BSK_)?/, "");
  const rw = s.match(/^Runeword_([A-Za-z]+)/);
  if (rw) return { name: camel(rw[1]), named: true };
  const charm = s.match(/^(?:Talisman_)?Charm_Unique_([A-Za-z]+)$/);
  if (charm) return { name: camel(charm[1]), named: true };
  const kind = /Mythic/i.test(s) ? "Mythic" : /Unique/i.test(s) ? "Unique" : /Set/i.test(s) ? "Set" : /Legendary/i.test(s) ? "Legendary" : "";
  const type = TYPES.find((t) => new RegExp(`(^|_)${t}(_|$)`, "i").test(s));
  return { name: [kind, type ? camel(type) : ""].filter(Boolean).join(" "), named: false };
}

// the item type inside an id ("1HSword_Unique_Barb_101", "Talisman_Seal_Legendary")
const TYPES = [
  "Helm", "Chest", "ChestArmor", "Gloves", "Pants", "Boots", "Amulet", "Ring", "Scythe2H", "Scythe", "Polearm", "Staff", "Wand", "Totem",
  "1HSword", "2HSword", "1HMace", "2HMace", "1HAxe", "2HAxe", "1HDagger", "1HFocus", "1HShield", "Bow", "2HCrossbow", "1HCrossbow",
  "Seal", "Charm",
];

/** "Gem_Ruby_09" → Ruby. Runes and splinters are stored by their effect, not their name. */
export function socketNameOf(id: string): string {
  const m = String(id ?? "").match(/^Gem_([A-Za-z]+)_\d+$/);
  return m ? camel(m[1]) : "";
}

/** The quality word inside an item id, for naming the kind of thing a slot holds. */
const hintOf = (id: string) =>
  /Mythic/i.test(id) ? "mythic" : /_Unique_|^Runeword_|Runeword_/i.test(id) ? "unique" : /Legendary/i.test(id) ? "legendary" : "";

/** One of the planner's affix entries: `nid` is the game's affix sno, `greater` its ★, `upgrade` a masterwork hit. */
const affixes = (list: any[] | null | undefined): StatRef[] =>
  (list ?? [])
    .filter(Boolean)
    .map((a: any) => affixById(a.nid, { greater: !!a.greater, masterwork: Number(a.upgrade ?? 0) > 0 }))
    .filter(Boolean) as StatRef[];

function gearOf(profile: any, items: Record<string, any>, className: string): GearSlot[] {
  const out: GearSlot[] = [];
  for (const [key, ref] of Object.entries(profile?.items ?? {})) {
    const slot = SLOTS[key];
    const item = items[String(ref)];
    if (!slot || !item?.id) continue;
    // the game's own item id names a unique, charm or seal; on a plain legendary the aspect is what
    // the build is really after, as on the other sites; failing both, the id's own words say what it is
    const known = itemById(item.id, className);
    const aspect = (item.aspects ?? []).map((a: any) => aspectById(a?.nid, className)).find(Boolean);
    const got = itemNameOf(item.id);
    const named = known ?? aspect ?? (got.named ? refOf(got.name, undefined, className) : { slug: "", name: got.name });
    out.push({
      slot,
      slotLabel: slotLabel(slot),
      group: slotGroup(slot),
      itemSlug: named.slug,
      itemName: named.name,
      kind: itemKindOf(named.slug, named.name, `${slotGroup(slot) === "talisman" ? slot.replace(/-\d+$/, "") : ""} ${item.mythic ? "mythic" : hintOf(item.id)}`),
      affixes: affixes(item.explicits),
      tempers: affixes(item.tempered),
      sockets: (item.sockets ?? [])
        .filter(Boolean)
        // gems are stored by tier ("Gem_Ruby_09"); runes and splinters are items of their own
        .map((s: string) => socketNameOf(s) || itemById(s)?.name || "")
        .filter(Boolean)
        .map((n: string) => socketRef(n)),
      implicits: affixes(item.implicits),
      extras: [],
    });
  }
  return sortGear(out.filter((g) => g.itemName || g.sockets.length));
}

/**
 * The paragon of the step this profile is on (the planner keeps a step per level band). A board's
 * squares come as one number each, counted across the board's own width.
 */
function paragonOf(profile: any, className: string): ParagonBoard[] {
  const steps = (profile?.paragon?.steps ?? []).filter(Boolean);
  const step = steps[Number(profile?.paragon?.position ?? 0)] ?? steps[steps.length - 1];
  return ((step?.data ?? []) as any[]).filter(Boolean).map((b: any) => {
    const board = boardById(b.id);
    const glyph = glyphById(b.glyph, className);
    const w = board?.width ?? 21;
    return {
      slug: board?.slug ?? slugOf(String(b.id ?? "")),
      name: board?.name ?? camel(String(b.id ?? "")),
      glyphSlug: glyph?.slug ?? "",
      glyphName: glyph?.name ?? "",
      glyphLevel: Number(b.glyphLevel ?? 0),
      x: Number(b.position?.x ?? 0),
      y: Number(b.position?.y ?? 0),
      rotation: Number(b.rotation ?? 0) % 360,
      nodes: board ? Object.keys(b.nodes ?? {}).map((i) => `${board.slug}-x${(Number(i) % w) + 1}-y${Math.floor(Number(i) / w) + 1}`) : [],
    };
  });
}

function variantOf(profile: any, data: any, idx: number, className: string): BuildVariant {
  const bar: SkillBarEntry[] = (profile?.skillBar ?? [])
    .map((id: string, i: number) => {
      if (!id) return null;
      const r = refOf(skillNameOf(id), "skills", className);
      return { position: i + 1, slug: r.slug, name: r.name, description: "" };
    })
    .filter(Boolean) as SkillBarEntry[];
  const merc = profile?.mercenary ?? {};
  return {
    id: String(idx),
    name: String(profile?.name || `Variant ${idx + 1}`),
    description: "",
    gear: gearOf(profile, data.items ?? {}, className),
    // the skill tree is the planner's own node numbering: nothing in the game data names it
    skillOrder: [],
    skillRanks: {},
    skillBar: bar,
    summons: (profile?.minionUpgrades ?? [])
      .filter(Boolean)
      .map((id: string) => ({ type: "upgrade", slug: refOf(skillNameOf(id), "skills", className).slug, name: skillNameOf(id), description: "" })),
    paragon: paragonOf(profile, className),
    mercenary: {
      primary: merc.id ? looseRef(camel(String(merc.id).replace(/^MercenaryClass_/, "")), "mercs").name : undefined,
      reinforcement: merc.support ? looseRef(camel(String(merc.support).replace(/^MercenaryClass_/, "")), "mercs").name : undefined,
      reinforcementSkill: merc.supportSkills?.[0] ? looseRef(skillNameOf(String(merc.supportSkills[0])), "mercSkills").name : undefined,
      trigger: undefined,
      skills: [],
    },
    priority: [],
    sections: sectionsOf(profile),
  };
}

function sectionsOf(profile: any): GuideSection[] {
  return Object.entries(profile?.widgetNotes ?? {})
    .map(([k, v]) => ({ id: `note-${k}`, title: humanize(k), text: lexicalToText(v).trim(), kind: "Notes" }))
    .filter((s) => s.text);
}

export function normaliseMaxroll(raw: any, url = ""): Build {
  const data = raw.data ?? {};
  const className = String(raw.class ?? data.profiles?.[0]?.class ?? "");
  const sections: GuideSection[] = Object.entries(data.globalNotes ?? {})
    .map(([k, v]) => ({ id: `global-${k}`, title: humanize(k), text: lexicalToText(v).trim(), kind: "Notes" }))
    .filter((s) => s.text);
  const sw = data.strAndWeak ?? {};
  const bullets = (x: unknown) => (Array.isArray(x) ? x : []).filter(Boolean).map((s) => `• ${s}`).join("\n");
  if (sw.strengths?.length || sw.weaknesses?.length)
    sections.unshift({
      id: "strengths",
      title: "Strengths and weaknesses",
      text: [sw.strengths?.length ? "Strengths:\n" + bullets(sw.strengths) : "", sw.weaknesses?.length ? "Weaknesses:\n" + bullets(sw.weaknesses) : ""].filter(Boolean).join("\n\n"),
      kind: "StrengthsWeaknesses",
    });
  return {
    id: `maxroll:${raw.id ?? ""}`,
    source: "maxroll",
    url,
    slug: String(raw.id ?? ""),
    name: String(raw.name ?? "Build"),
    author: String(raw.user?.username ?? ""),
    className,
    season: raw.season ? `Season ${raw.season}` : "",
    tags: [
      ...(className ? [{ group: "class", name: className }] : []),
      ...(raw.category ? [{ group: "category", name: String(raw.category) }] : []),
    ],
    updatedAt: raw.date ? new Date(String(raw.date).replace(" ", "T") + "Z").toISOString() : "",
    fetchedAt: new Date().toISOString(),
    variants: (data.profiles ?? []).map((p: any, i: number) => variantOf(p, data, i, className)),
    sections,
  };
}

export async function importMaxroll(urlOrId: string) {
  const { raw, id, profile } = await fetchMaxrollRaw(urlOrId);
  const url = `https://maxroll.gg/d4/planner/${id}${profile ? `#${profile}` : ""}`;
  return { build: normaliseMaxroll(raw, url), via: "maxroll", defaultVariant: profile };
}
