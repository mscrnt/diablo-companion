// Icy Veins build importer: paste a build link, fetch that one build, nothing else.
// A build lives in the site's planner and its public API hands it over whole; items,
// aspects, sockets, glyphs, boards and mercenaries come back by name, so they map by name.
import { itemKindOf, looseRef, refOf, skillNameOf, slotGroup, slotLabel, socketRef, sortGear } from "./buildmap";
import { slugOf } from "./gamedata/convert";
import { BROWSER_UA, http, httpJson } from "./http";
import { humanize } from "./names";
import type { Build, BuildVariant, GearSlot, GuideSection, ParagonBoard, SkillBarEntry } from "./types";

const API = "https://www.icy-veins.com/api/d4-builds/";
const UID = /[?&]uid=([a-z0-9]{6,})/i;

/**
 * A planner link (…/d4/planner/?uid=61e715e1fa72) carries the build's id; a guide page
 * (…/d4/guides/blood-wave-necromancer-build) has it inside the page.
 */
export function parseIcyVeinsUrl(input: string): { uid?: string; page?: string } {
  const s = input.trim();
  if (!s.includes("/")) return { uid: s };
  const m = s.match(UID);
  if (m) return { uid: m[1] };
  const u = new URL(s);
  const api = u.pathname.match(/\/api\/d4-builds\/([a-z0-9]+)/i);
  if (api) return { uid: api[1] };
  return { page: u.toString() };
}

/** The build id out of a guide page: the page links its own planner. */
export function extractUid(html: string): string {
  const m = html.match(UID) ?? html.match(/d4-builds\\?\/([a-z0-9]{6,})\\?\//i);
  if (!m) throw new Error("No build found on that Icy Veins page");
  return m[1];
}

export async function fetchIcyVeinsRaw(urlOrUid: string): Promise<{ raw: any; uid: string }> {
  const { uid, page } = parseIcyVeinsUrl(urlOrUid);
  let id = uid;
  if (!id && page) {
    // the guide page sits behind a bot check: when it turns us away, the planner link works
    let html: string;
    try {
      const r = await http(page, { headers: { "User-Agent": BROWSER_UA } });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      html = await r.text();
    } catch (e) {
      throw new Error(
        `Icy Veins would not hand over that guide page (${(e as Error).message}). Open the build in its planner and paste that link: it ends with ?uid=…`,
      );
    }
    id = extractUid(html);
  }
  if (!id) throw new Error("That Icy Veins link has no build id in it");
  const r = await httpJson<any>(`${API}${id}/`, { headers: { Accept: "application/json", "User-Agent": BROWSER_UA }, timeoutMs: 30000 });
  if (!r?.build) throw new Error("Icy Veins: " + (r?.error ?? "build not found"));
  return { raw: r.build, uid: id };
}

// ---- normalisation --------------------------------------------------------

// the planner's own slot keys; charms are talisman_charm_1 … _6
const SLOTS: Record<string, string> = {
  helmet: "helm",
  chestplate: "chest-armor",
  gloves: "gloves",
  pants: "pants",
  boots: "boots",
  amulet: "amulet",
  ring1: "ring-1",
  ring2: "ring-2",
  mainWeapon: "weapon",
  offHand: "offhand",
  offhand: "offhand",
  shield: "offhand",
  focus: "offhand",
  bludgeoningWeapon: "bludgeoning-weapon",
  slashingWeapon: "slashing-weapon",
  dualWield1: "dual-wield-weapon-1",
  dualWield2: "dual-wield-weapon-2",
  rangedWeapon: "ranged-weapon",
  talisman_seal: "seal",
};

function slotKeyOf(key: string): string {
  if (SLOTS[key]) return SLOTS[key];
  const c = key.match(/^talisman_charm_(\d+)$/);
  return c ? `charm-${c[1]}` : key;
}

const map = (x: unknown): Record<string, any> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, any>) : {});
const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);

function gearOf(set: any, className: string): GearSlot[] {
  const names = map(set.equippedGear);
  const types = map(set.itemTypes);
  const aspects = map(set.itemAspects);
  const quality = map(set.itemQualities);
  const sockets = map(set.itemSockets);
  const mythic = map(set.itemMythicToggle);
  const transfig = map(set.itemAmuletTransfigurationAspect);
  const out: GearSlot[] = [];
  for (const key of new Set([...Object.keys(map(set.itemIds)), ...Object.keys(names)])) {
    const slot = slotKeyOf(key);
    // an aspect on a plain legendary is what the build is really after, as on Mobalytics
    const shown = String(aspects[key] ?? names[key] ?? "").trim();
    if (!shown) continue;
    // an empty slot shows its own item type ("Ring", "Boots", "Chest Armor"): nothing to track on it
    const flat = (t: string) => slugOf(t).replace(/-/g, "");
    if (!aspects[key] && [String(types[key] ?? ""), slotLabel(slot).replace(/\s*\d+$/, "")].some((t) => t && flat(shown) === flat(t))) continue;
    const item = refOf(shown, undefined, className);
    const extras: GearSlot["extras"] = [];
    const tf = transfig[key];
    if (tf?.name) extras.push({ label: "Transfigured (Horadric Cube)", stats: [{ slug: refOf(String(tf.name), "aspects", className).slug, name: String(tf.name) }] });
    out.push({
      slot,
      slotLabel: slotLabel(slot),
      group: slotGroup(slot),
      itemSlug: item.slug,
      itemName: item.name,
      kind: itemKindOf(item.slug, item.name, `${slotGroup(slot) === "talisman" ? slot.replace(/-\d+$/, "") : ""} ${mythic[key] ? "mythic" : (quality[key] ?? "")}`),
      // the planner stores affixes as the game's numeric ids, which name nothing on their own
      affixes: [],
      tempers: [],
      sockets: list(sockets[key]).filter(Boolean).map((s) => socketRef(String(s))),
      implicits: [],
      extras,
    });
  }
  return sortGear(out);
}

function paragonOf(board: any, className: string): ParagonBoard[] {
  const glyphs = map(board.equippedGlyphs);
  const rotations = map(board.actualRotations);
  const nodes = Object.entries(map(board.nodeStates))
    .filter(([, n]) => (n as any)?.state === "active")
    .map(([k]) => k);
  // the starting board's nodes and glyph have no board prefix; every other board does
  const boards: { slug: string; name: string; x: number; y: number; prefix: string }[] = [
    { slug: "", name: "Starting Board", x: 0, y: 0, prefix: "" },
    ...Object.values(map(board.connectedBoards)).map((b: any) => ({
      slug: String(b?.slug ?? ""),
      name: String(b?.boardData?.name ?? humanize(String(b?.slug ?? ""))),
      x: Number(b?.position?.col ?? 0),
      y: Number(b?.position?.row ?? 0),
      prefix: String(b?.slug ?? "") + "-",
    })),
  ];
  return boards.map((b) => {
    const ref = refOf(b.name, "boards", className);
    const own = (k: string) => (b.prefix ? k.startsWith(b.prefix) : /^\d+-\d+$/.test(k));
    const g = Object.entries(glyphs).find(([k]) => own(k))?.[1] as any;
    const glyph = refOf(String(g?.name ?? ""), "glyphs", className);
    return {
      slug: ref.slug,
      name: ref.name,
      glyphSlug: glyph.slug,
      glyphName: glyph.name,
      glyphLevel: Number(g?.level ?? 0),
      x: b.x,
      y: b.y,
      rotation: Number(b.prefix ? rotations[b.slug] ?? 0 : 0) % 360,
      nodes: nodes.filter(own),
    };
  });
}

export function normaliseIcyVeins(raw: any, url = ""): Build {
  const sets = list(raw.gear_data?.sets);
  const byId = (section: any, id: string) => list(section?.sets).find((s: any) => s?.id === id);
  const className = humanize(String(sets[0]?.class ?? ""));

  const variants: BuildVariant[] = sets.map((g: any, i: number): BuildVariant => {
    const skills = byId(raw.skills_data, g.id);
    const paragon = byId(raw.paragon_data, g.id);
    const merc = byId(raw.mercenary_data, g.id);
    const sections: GuideSection[] = [];
    const notes = String(g.notes ?? "").trim();
    if (notes) sections.push({ id: `notes-${g.id}`, title: "Author's notes", text: notes, kind: "Notes" });
    const bar = Object.entries(map(skills?.equippedSkills))
      .filter(([, v]) => v)
      .map(([k, v]): SkillBarEntry => {
        const r = refOf(skillNameOf(String(v)), "skills", className);
        return { position: Number(k.replace(/\D+/g, "")) || 1, slug: r.slug, name: r.name, description: "" };
      })
      .sort((a, b) => a.position - b.position);
    return {
      id: String(g.id ?? i),
      name: String(g.name || `Variant ${i + 1}`),
      description: "",
      gear: gearOf(g, className),
      // the skill tree is stored as the planner's own node indices: only the bar is named
      skillOrder: [],
      skillRanks: {},
      skillBar: bar,
      summons: Object.values(map(g.equippedMechanics))
        .filter((m: any) => m?.name && m?.id)
        .map((m: any) => ({ type: String(m.shape ?? "upgrade"), slug: refOf(skillNameOf(String(m.id)), "skills", className).slug, name: String(m.name), description: "" })),
      paragon: paragon?.paragonBoard ? paragonOf(paragon.paragonBoard, className) : [],
      mercenary: {
        primary: merc?.selectedMercenary ? looseRef(String(merc.selectedMercenary), "mercs").name : undefined,
        reinforcement: merc?.selectedReinforcement ? looseRef(String(merc.selectedReinforcement), "mercs").name : undefined,
        reinforcementSkill: merc?.selectedSkill ? looseRef(String(merc.selectedSkill), "mercSkills").name : undefined,
        trigger: merc?.selectedOpportunity ? looseRef(String(merc.selectedOpportunity), "mercOpp").name : undefined,
        skills: [],
      },
      priority: [],
      sections,
    };
  });

  return {
    id: `icy-veins:${raw.uid ?? raw.id ?? ""}`,
    source: "icy-veins",
    url,
    slug: String(raw.uid ?? ""),
    name: String(raw.name ?? "Build"),
    author: "",
    className,
    season: "",
    tags: [
      ...(className ? [{ group: "class", name: className }] : []),
      ...(raw.version ? [{ group: "patch", name: String(raw.version) }] : []),
    ],
    updatedAt: String(raw.updated_at ?? raw.updatedAt ?? ""),
    fetchedAt: new Date().toISOString(),
    variants,
    sections: [],
  };
}

export async function importIcyVeins(urlOrUid: string) {
  const { raw, uid } = await fetchIcyVeinsRaw(urlOrUid);
  const url = `https://www.icy-veins.com/d4/planner/?uid=${uid}`;
  return { build: normaliseIcyVeins(raw, url), via: "icy-veins", defaultVariant: undefined as string | undefined };
}
