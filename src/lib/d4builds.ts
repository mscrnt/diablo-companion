// d4builds.gg build importer: paste a build link, fetch that one build, nothing else.
// A build page is a public Firestore document, and the document names every item,
// aspect, affix, gem, rune, glyph and board the way the game does, so it maps by name.
import { itemKindOf, looseRef, refOf, slotGroup, slotLabel, socketRef, sortGear, statRef, temperRef } from "./buildmap";
import { slugOf } from "./gamedata/convert";
import { BROWSER_UA, httpJson } from "./http";
import type { Build, BuildVariant, GearSlot, GuideSection, ParagonBoard, StatRef } from "./types";

const DOC = "https://firestore.googleapis.com/v1/projects/d4builds-a3254/databases/(default)/documents/builds/";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** d4builds.gg/builds/<build id>/?var=2 → the build's id and the variant the link opens. */
export function parseD4BuildsUrl(input: string): { id: string; variant?: string } {
  const s = input.trim();
  const u = new URL(s.includes("://") ? s : `https://d4builds.gg/builds/${s}`);
  const id = u.pathname.split("/").filter(Boolean).pop() ?? "";
  if (!UUID.test(id))
    throw new Error(
      `"${id}" is not a d4builds build id. Open the build on d4builds.gg and use its Share link: it ends with the build id, a long code with dashes in it.`,
    );
  const v = u.searchParams.get("var");
  return { id, variant: v ?? undefined };
}

/** Firestore's typed JSON ({"stringValue":"Enigma"}) → plain values. */
export function decodeFirestore(v: any): any {
  if (v == null) return null;
  if ("stringValue" in v) return v.stringValue;
  if ("integerValue" in v) return Number(v.integerValue);
  if ("doubleValue" in v) return v.doubleValue;
  if ("booleanValue" in v) return v.booleanValue;
  if ("timestampValue" in v) return v.timestampValue;
  if ("nullValue" in v) return null;
  if ("arrayValue" in v) return (v.arrayValue.values ?? []).map(decodeFirestore);
  if ("mapValue" in v) return Object.fromEntries(Object.entries(v.mapValue.fields ?? {}).map(([k, x]) => [k, decodeFirestore(x)]));
  return null;
}

export async function fetchD4BuildsRaw(urlOrId: string): Promise<any> {
  const { id } = parseD4BuildsUrl(urlOrId);
  const r = await httpJson<any>(DOC + id, { headers: { Accept: "application/json", "User-Agent": BROWSER_UA }, timeoutMs: 30000 });
  if (!r?.fields) throw new Error("d4builds: that build id has no public build on it");
  return decodeFirestore({ mapValue: { fields: r.fields } });
}

// ---- normalisation --------------------------------------------------------

// the site's slot names are the game's, so slugOf lands on the app's own keys; only the
// shield (an offhand in game) and the talisman need saying
const SLOT_ALIAS: Record<string, string> = { shield: "offhand", focus: "offhand", totem: "offhand" };
const slotKey = (label: string) => SLOT_ALIAS[slugOf(label)] ?? slugOf(label);

// gems grouped by item kind ("Jewelry", "Armor") belong to no one slot, so they are skipped
const isSlot = (slot: string) => slotGroup(slot) !== "other";

const list = (x: unknown): any[] => (Array.isArray(x) ? x : []);
const map = (x: unknown): Record<string, any> => (x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, any>) : {});

function gearOf(v: any, className: string): GearSlot[] {
  const gear = map(v.gear);
  // `stats` is the older field, kept on builds last saved before the affix rework
  const affixes = Object.keys(map(v.newStats)).length ? map(v.newStats) : map(v.stats);
  const tempers = map(v.temperingStats);
  const sockets = Object.keys(map(v.newGems)).length ? map(v.newGems) : {};
  const greater = map(v.greaterAffixes);
  const mw = map(v.masterworking);
  const bloodied = map(v.bloodiedAffixes);
  const sanct = map(v.sanctification);
  const out: GearSlot[] = [];

  for (const label of new Set([...Object.keys(gear), ...Object.keys(affixes)])) {
    const name = gear[label];
    const slot = slotKey(label);
    if (!isSlot(slot)) continue;
    const item = refOf(String(name ?? ""), undefined, className);
    const stats: StatRef[] = list(affixes[label])
      .map((a, i) => (a ? statRef(String(a), { greater: list(greater[label])[i] != null, masterwork: list(mw[label])[i] != null }) : null))
      .filter(Boolean) as StatRef[];
    const extras: GearSlot["extras"] = [];
    const bl = list(bloodied[label]).filter(Boolean).map((b) => statRef(String(b)));
    if (bl.length) extras.push({ label: "Bloodied", stats: bl });
    const sa = (Array.isArray(sanct[label]) ? list(sanct[label]) : [sanct[label]]).filter(Boolean).map((x) => statRef(String(x)));
    if (sa.length) extras.push({ label: "Sanctified", stats: sa });
    if (!name && !stats.length && !extras.length) continue;
    out.push({
      slot,
      slotLabel: slotLabel(slot),
      group: slotGroup(slot),
      itemSlug: item.slug,
      itemName: item.name,
      kind: itemKindOf(item.slug, item.name),
      affixes: stats,
      tempers: list(tempers[label]).filter(Boolean).map((t) => temperRef(String(t))),
      sockets: list(sockets[label]).filter(Boolean).map((s) => socketRef(String(s))),
      implicits: [],
      extras,
    });
  }

  // the talisman: the seal, then the six charms with the stats wanted on each
  const seal = map(v.seal).name;
  if (seal) {
    const r = refOf(String(seal), "seals");
    out.push({
      slot: "seal",
      slotLabel: "Seal",
      group: "talisman",
      itemSlug: r.slug,
      itemName: r.name,
      kind: "seal",
      affixes: list(v.sealStats).filter(Boolean).map((s) => statRef(String(s))),
      tempers: [],
      sockets: [],
      implicits: [],
      extras: [],
    });
  }
  const charmStats = map(v.charmStats);
  list(v.charms).forEach((c, i) => {
    if (!c) return;
    const r = refOf(String(c), undefined, className);
    out.push({
      slot: `charm-${i + 1}`,
      slotLabel: `Charm ${i + 1}`,
      group: "talisman",
      itemSlug: r.slug,
      itemName: r.name,
      kind: itemKindOf(r.slug, r.name, "charm"),
      affixes: list(charmStats[String(i)]).filter(Boolean).map((s) => statRef(String(s))),
      tempers: [],
      sockets: [],
      implicits: [],
      extras: [],
    });
  });
  list(v.chaosPerks).forEach((p, i) => {
    if (!p) return;
    const r = refOf(String(p), "chaosPerks");
    out.push({
      slot: `chaos-perk-${i + 1}`,
      slotLabel: `Chaos Perk ${i + 1}`,
      group: "chaos",
      itemSlug: r.slug,
      itemName: r.name,
      kind: "chaosPerk",
      affixes: [],
      tempers: [],
      sockets: [],
      implicits: [],
      extras: [],
    });
  });
  return sortGear(out);
}

function paragonOf(v: any, className: string): ParagonBoard[] {
  const tiles = list(map(v.paragon).selectedTiles).map(String);
  return list(map(v.paragon).boards).map((b) => {
    const board = refOf(String(b?.name ?? ""), "boards", className);
    const glyph = refOf(String(b?.glyph ?? ""), "glyphs", className);
    // tiles are "<board name without spaces>_r<row>c<col>"
    const prefix = String(b?.name ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "") + "_";
    return {
      slug: board.slug,
      name: board.name,
      glyphSlug: glyph.slug,
      glyphName: glyph.name,
      glyphLevel: Number(b?.glyphLevel ?? 0),
      x: Number(b?.x ?? 0),
      y: Number(b?.y ?? 0),
      rotation: Number(b?.rotation ?? 0) % 360,
      nodes: tiles.filter((t) => t.startsWith(prefix)),
    };
  });
}

function variantOf(v: any, className: string, idx: number, label: string): BuildVariant {
  const sections: GuideSection[] = [];
  const notes = String(v.notes ?? "").trim();
  if (notes) sections.push({ id: `notes-${idx}`, title: "Author's notes", text: notes, kind: "Notes" });
  const mercSkill = String(v.mercenarySkill2 ?? "").replace(/-v\d+$/, "");
  return {
    id: String(idx),
    name: label,
    description: "",
    gear: gearOf(v, className),
    // the skill tree is a bit string of the site's own node order: only the bar is named
    skillOrder: [],
    skillRanks: {},
    skillBar: list(v.skills)
      .map((s, i) => {
        if (!s) return null;
        const r = refOf(String(s), "skills", className);
        return { position: i + 1, slug: r.slug, name: r.name, description: "" };
      })
      .filter(Boolean) as BuildVariant["skillBar"],
    summons: Object.entries(map(v.summons))
      .filter(([, s]) => s?.spec || s?.upgrade)
      .map(([type, s]) => ({ type, slug: slugOf(String(s.spec ?? s.upgrade)), name: String(s.spec ?? s.upgrade), description: "" })),
    paragon: paragonOf(v, className),
    mercenary: {
      primary: v.mercenary2 ? looseRef(String(v.mercenary2), "mercs").name : undefined,
      reinforcement: v.reinforcement2 ? looseRef(String(v.reinforcement2), "mercs").name : undefined,
      reinforcementSkill: mercSkill ? looseRef(mercSkill, "mercSkills").name : undefined,
      trigger: v.mercenaryOpportunity2 ? looseRef(String(v.mercenaryOpportunity2), "mercOpp").name : undefined,
      skills: [],
    },
    priority: list(v.craftedMythic).filter(Boolean).map((m) => slugOf(String(m))),
    sections,
  };
}

export function normaliseD4Builds(raw: any, url = "", id = ""): Build {
  const className = String(raw.class ?? "");
  // the document itself is the first variant; the others hang off it, each with its own gear
  const rest = list(raw.variants).map((v, i) => ({ v, idx: Number(v?.index ?? i + 1), label: String(v?.name || v?.variantName || `Variant ${i + 2}`) }));
  const all = [{ v: raw, idx: Number(raw.index ?? 0), label: String(raw.variantName || "Variant 1") }, ...rest].sort((a, b) => a.idx - b.idx);
  const updated = Number(raw.lastUpdatedSort ?? 0) || Date.parse(String(raw.lastUpdated ?? "")) || 0;
  return {
    id: `d4builds:${id || slugOf(String(raw.name ?? "build"))}`,
    source: "d4builds",
    url,
    slug: "",
    name: String(raw.name ?? "Build"),
    author: "",
    className,
    season: raw.season ? `Season ${raw.season}` : "",
    tags: [
      ...(className ? [{ group: "class", name: className }] : []),
      ...(raw.leveling ? [{ group: "stage", name: "Leveling" }] : []),
    ],
    updatedAt: updated ? new Date(updated).toISOString() : "",
    fetchedAt: new Date().toISOString(),
    variants: all.map(({ v, idx, label }) => variantOf(v, className, idx, label)),
    sections: [],
  };
}

export async function importD4Builds(urlOrId: string) {
  const { id, variant } = parseD4BuildsUrl(urlOrId);
  // the link back opens the variant the player pasted
  const url = `https://d4builds.gg/builds/${id}/${variant ? `?var=${variant}` : ""}`;
  const raw = await fetchD4BuildsRaw(id);
  const build = normaliseD4Builds(raw, url, id);
  return { build, via: "d4builds", defaultVariant: variant };
}
