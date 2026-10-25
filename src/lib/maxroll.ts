// Maxroll build importer: paste a build link, fetch that one planner profile, nothing else.
// The planner stores the game's own ids, so what it names is what the game names: the skill
// bar, runewords and the named uniques. Its affixes, glyphs and boards are numbers, and
// nothing of Maxroll's own is fetched to turn them into words, so those parts stay empty.
import { camelWords as camel, itemKindOf, looseRef, refOf, skillNameOf, slotGroup, slotLabel, socketRef, sortGear } from "./buildmap";
import { BROWSER_UA, http, httpJson } from "./http";
import { lexicalToText } from "./mobalytics";
import { humanize } from "./names";
import type { Build, BuildVariant, GearSlot, GuideSection, SkillBarEntry } from "./types";

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

function gearOf(profile: any, items: Record<string, any>, className: string): GearSlot[] {
  const out: GearSlot[] = [];
  for (const [key, ref] of Object.entries(profile?.items ?? {})) {
    const slot = SLOTS[key];
    const item = items[String(ref)];
    if (!slot || !item?.id) continue;
    const got = itemNameOf(item.id);
    const named = got.named ? refOf(got.name, undefined, className) : { slug: "", name: got.name };
    out.push({
      slot,
      slotLabel: slotLabel(slot),
      group: slotGroup(slot),
      itemSlug: named.slug,
      itemName: named.name,
      kind: itemKindOf(named.slug, named.name, `${slotGroup(slot) === "talisman" ? slot.replace(/-\d+$/, "") : ""} ${hintOf(item.id)}`),
      // the planner stores affixes as the game's numeric ids, which name nothing on their own
      affixes: [],
      tempers: [],
      sockets: (item.sockets ?? [])
        .filter(Boolean)
        .map((s: string) => socketNameOf(s))
        .filter(Boolean)
        .map((n: string) => socketRef(n)),
      implicits: [],
      extras: [],
    });
  }
  return sortGear(out.filter((g) => g.itemName || g.sockets.length));
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
    // the skill tree and the paragon boards are the planner's own numbers: nothing to name them
    skillOrder: [],
    skillRanks: {},
    skillBar: bar,
    summons: (profile?.minionUpgrades ?? [])
      .filter(Boolean)
      .map((id: string) => ({ type: "upgrade", slug: refOf(skillNameOf(id), "skills", className).slug, name: skillNameOf(id), description: "" })),
    paragon: [],
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
