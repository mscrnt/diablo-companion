// Mobalytics build importer.
// 1. Direct GraphQL (not behind Cloudflare) — fast path.
// 2. FlareSolverr page fetch + window.__PRELOADED_STATE__ — full-fidelity fallback.
import { slotGroup, slotLabel, sortGear } from "./buildmap";
import { BROWSER_UA, http, httpJson } from "./http";
import { humanize, lookup, nameOf, statName, temperName } from "./names";
import type {
  Build,
  BuildVariant,
  GearSlot,
  GuideSection,
  ItemKind,
  ParagonBoard,
  SocketRef,
  StatRef,
} from "./types";

const GQL = "https://mobalytics.gg/api/diablo4/v1/graphql/query";

export function parseBuildUrl(input: string): { slug: string; variant?: string; kind: "builds" | "profile"; author?: string } {
  const s = input.trim();
  if (!s.includes("/")) return { slug: s, kind: "builds" };
  const u = new URL(s);
  const parts = u.pathname.split("/").filter(Boolean);
  const i = parts.indexOf("builds");
  const slug = i >= 0 ? parts[parts.length - 1] : parts[parts.length - 1];
  const kind = parts.includes("profile") ? "profile" : "builds";
  const author = kind === "profile" ? parts[parts.indexOf("profile") + 1] : undefined;
  // ws-ngf5-1=activeVariantId,1
  let variant: string | undefined;
  for (const [, v] of u.searchParams) {
    const m = v.match(/activeVariantId,(.+)$/);
    if (m) variant = m[1];
  }
  return { slug, variant, kind, author };
}

// ---- raw fetchers ---------------------------------------------------------

const STAT_FIELDS = "id isGreater isMasterwork";
const BUILD_QUERY = `query D4Build($input: Diablo4UserGeneratedDocumentInputBySlug!) {
  diablo4 { documents { userGeneratedDocumentBySlug(input: $input) { error data {
    id slugifiedName type version updatedAt createdAt
    author { name }
    tags { data { groupSlug name slug } }
    data {
      ... on Diablo4UserGeneratedDocumentData {
        name
        buildVariants { values {
          id
          genericBuilder { slots { gameSlotSlug gameEntity { slug title type iconUrl
            modifiers {
              gearStats { ${STAT_FIELDS} } implicitStats { id } temperingStats { ${STAT_FIELDS} }
              socketStats { slug type } sealStats { id } charmStats { id } transfiguredStats { id } kulleanTransfiguredStats { id } isMythic
            } } } }
          assignedSkills { skills { position skill { slug name description iconUrl } } summons { type upgrade spec { slug name description } } }
          skillTree { skills { actionType skill { slug type { id } } } }
          paragon { nodes { slug } boards { x y rotation board { slug } glyph { slug } glyphLevel } }
          mercenary { primaryMercenary { slug } reinforcementMercenary { slug } skill { slug } opportunity { opportunity { slug } } skillTree { actionType skill { slug } } }
          equipmentPriorityList { slug type }
        } }
      }
    }
  } } } }
}`;

async function fetchViaGraphQL(slug: string, author?: string): Promise<any> {
  // profile builds (…/profile/<author>/builds/<name>) are looked up by author + name
  const query = author
    ? BUILD_QUERY.replace("($input: Diablo4UserGeneratedDocumentInputBySlug!)", "($input: NgfUserGeneratedDocumentInputBySlugifiedNameV2!)").replace(
        "userGeneratedDocumentBySlug(input: $input)",
        "userGeneratedDocumentBySlug: userGeneratedDocumentBySlugifiedNameV2(input: $input)",
      )
    : BUILD_QUERY;
  const input = author ? { type: "builds", authorProfileName: author, slugifiedName: slug } : { type: "builds", slug };
  const r = await httpJson<any>(GQL, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA },
    body: JSON.stringify({ query, variables: { input } }),
  });
  if (r.errors?.length) throw new Error("GraphQL: " + r.errors.map((e: any) => e.message).join("; "));
  const p = r.data?.diablo4?.documents?.userGeneratedDocumentBySlug;
  if (!p?.data) throw new Error("GraphQL: build not found" + (p?.error ? ` (${p.error})` : ""));
  return p.data;
}

export function extractPreloadedDoc(html: string, slug: string): any {
  const key = "window.__PRELOADED_STATE__=";
  const i = html.indexOf(key);
  if (i < 0) throw new Error("No preloaded state in page (Cloudflare challenge not solved?)");
  // The state is a JS object literal that is valid JSON; find its end by brace matching.
  let depth = 0,
    inStr = false,
    esc = false,
    j = i + key.length;
  const start = j;
  for (; j < html.length; j++) {
    const c = html[j];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) {
        j++;
        break;
      }
    }
  }
  const state = JSON.parse(html.slice(start, j));
  const queries: any[] = state?.diablo4State?.apollo?.graphqlV2?.queries ?? [];
  const q = queries.find((q) => JSON.stringify(q.queryKey ?? "").includes(slug)) ?? queries.find((q) =>
    JSON.stringify(q.queryKey ?? "").includes("document-page"),
  );
  const doc = q?.state?.data?.[0]?.game?.documents?.userGeneratedDocumentBySlug?.data;
  if (!doc) throw new Error("Build document not found in preloaded state");
  return doc;
}

async function fetchViaFlareSolverr(url: string, slug: string, flaresolverr: string): Promise<any> {
  const r = await httpJson<any>(flaresolverr.replace(/\/$/, "") + "/v1", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ cmd: "request.get", url, maxTimeout: 90000 }),
    timeoutMs: 120000,
  });
  if (r.status !== "ok") throw new Error("FlareSolverr: " + r.message);
  return extractPreloadedDoc(r.solution.response as string, slug);
}

async function fetchDirectPage(url: string, slug: string): Promise<any> {
  const r = await http(url, { headers: { "User-Agent": BROWSER_UA } });
  return extractPreloadedDoc(await r.text(), slug);
}

export interface ImportOptions {
  flaresolverr?: string;
  prefer?: "full" | "fast";
}

/**
 * Fetch a raw Mobalytics document. "full" (default) tries the page first because
 * it includes the author's guide text; GraphQL is used if the page is blocked.
 */
export async function fetchMobalyticsRaw(urlOrSlug: string, opts: ImportOptions = {}): Promise<{ raw: any; via: string }> {
  const { slug, author } = parseBuildUrl(urlOrSlug);
  const url = urlOrSlug.includes("://") ? urlOrSlug : `https://mobalytics.gg/diablo-4/builds/${slug}`;
  const errors: string[] = [];
  const attempts: [string, () => Promise<any>][] = [];
  if (opts.flaresolverr) attempts.push(["flaresolverr", () => fetchViaFlareSolverr(url, slug, opts.flaresolverr!)]);
  attempts.push(["page", () => fetchDirectPage(url, slug)]);
  attempts.push(["graphql", () => fetchViaGraphQL(slug, author)]);
  if (opts.prefer === "fast") attempts.unshift(attempts.pop()!);
  for (const [via, fn] of attempts) {
    try {
      return { raw: await fn(), via };
    } catch (e) {
      errors.push(`${via}: ${(e as Error).message}`);
    }
  }
  throw new Error("Could not import build:\n" + errors.join("\n"));
}

// ---- normalisation --------------------------------------------------------

function stats(list: any[] | null | undefined, temper = false): StatRef[] {
  return (list ?? [])
    .filter(Boolean)
    .map((s: any) => ({
      slug: s.id,
      name: temper ? temperName(s.id) : statName(s.id),
      greater: !!s.isGreater,
      masterwork: !!s.isMasterwork,
    }));
}

function sockets(list: any[] | null | undefined): SocketRef[] {
  return (list ?? []).filter(Boolean).map((s: any) => ({
    slug: s.slug,
    name: nameOf(s.slug, undefined, s.type === "runes" ? "runes" : s.type === "gems" ? "gems" : undefined),
    kind: s.type === "gems" ? "gem" : s.type === "runes" ? "rune" : "other",
  }));
}

function itemKind(ent: any): ItemKind {
  const t = ent?.type ?? "";
  if (t === "uniqueItems") {
    // The builder's isMythic flag marks "mythic quality" slots; trust game data for real mythics.
    const known = lookup(ent.slug, "uniques");
    return (known ? known.m : ent?.modifiers?.isMythic) ? "mythic" : "unique";
  }
  if (t === "aspects") return "aspect";
  if (t === "charms") return "charm";
  if (t === "seals") return "seal";
  if (t === "chaosPerks") return "chaosPerk";
  return "other";
}

function normaliseSlots(slots: any[]): GearSlot[] {
  const out: GearSlot[] = [];
  for (const s of slots ?? []) {
    const ent = s.gameEntity;
    if (!ent?.slug && !ent?.title) continue;
    const m = ent.modifiers ?? {};
    const extras: GearSlot["extras"] = [];
    const tf = stats(m.transfiguredStats);
    if (tf.length) extras.push({ label: "Transfigured (Horadric Cube)", stats: tf });
    const kul = (m.kulleanTransfiguredStats ?? []).filter(Boolean).map((x: any) => ({ slug: x.id, name: nameOf(x.id, undefined, "aspects") }));
    if (kul.length) extras.push({ label: "Kullean Transfigure", stats: kul });
    const ch = stats(m.charmStats);
    if (ch.length) extras.push({ label: "Charm stats", stats: ch });
    const se = stats(m.sealStats);
    if (se.length) extras.push({ label: "Seal stats", stats: se });
    out.push({
      slot: s.gameSlotSlug,
      slotLabel: slotLabel(s.gameSlotSlug),
      group: slotGroup(s.gameSlotSlug),
      itemSlug: ent.slug ?? "",
      itemName: ent.title || nameOf(ent.slug ?? ""),
      kind: itemKind(ent),
      icon: ent.iconUrl ?? undefined,
      affixes: stats(m.gearStats),
      tempers: stats(m.temperingStats, true),
      sockets: sockets(m.socketStats),
      implicits: stats(m.implicitStats),
      extras,
    });
  }
  return sortGear(out);
}

/** Lexical rich-text JSON → plain text (with item/skill widget labels inlined). */
export function lexicalToText(node: any): string {
  if (!node) return "";
  if (typeof node === "string") {
    try {
      return lexicalToText(JSON.parse(node));
    } catch {
      return node;
    }
  }
  if (node.value) return lexicalToText(node.value);
  if (node.root) return lexicalToText(node.root).replace(/\n{3,}/g, "\n\n").trim();
  if (node.type === "text") return node.text ?? "";
  if (node.type === "static-data-widget") return node.label ?? humanize(node.id ?? "");
  if (node.type === "linebreak") return "\n";
  const inner = (node.children ?? []).map(lexicalToText).join("");
  switch (node.type) {
    case "paragraph":
      return inner + "\n";
    case "heading":
      return "\n## " + inner + "\n";
    case "listitem":
      return "• " + inner + "\n";
    case "list":
      return inner + "\n";
    default:
      return inner;
  }
}

const SECTION_TEXT_FIELDS = [
  "simplifiedContent",
  "optionalSubTitleV2",
  "descriptionSkillTree",
  "descriptionParagon",
  "descriptionMercenary",
  "descriptionAssignedSkills",
  "descriptionWarPlans",
  "strengths",
  "weaknesses",
];

function sectionOf(s: any): GuideSection | null {
  const d = s.data ?? {};
  const kind = String(s.__typename ?? "")
    .replace(/^(Ngf|Diablo4)Document(Cm|Ug)(Widget|Section)/, "")
    .replace(/V\d+$/, "");
  if (/Comments|PromoBanner|Discovery|VideoAd|TableOfContent|Auto\d*$/.test(kind)) return null;
  const parts: string[] = [];
  for (const f of SECTION_TEXT_FIELDS) {
    if (!d[f]) continue;
    const t = lexicalToText(d[f]).trim();
    if (t) parts.push(f === "strengths" ? "Strengths:\n" + t : f === "weaknesses" ? "Weaknesses:\n" + t : t);
  }
  const text = parts.join("\n\n").trim();
  if (!text) return null;
  return { id: s.id, title: d.title || humanize(kind), text, kind };
}

export function normaliseMobalytics(raw: any, url = ""): Build {
  const content: any[] = raw.content ?? [];
  const byId = new Map(content.map((c) => [c.id, c]));
  const variantsWidget = content.find((c) => c.data?.childrenVariants);
  const variantMeta: any[] = variantsWidget?.data?.childrenVariants ?? [];
  const variantChildIds = new Set(variantMeta.flatMap((v) => v.childrenIds ?? []));

  const tags = (raw.tags?.data ?? []).map((t: any) => ({ group: t.groupSlug, name: t.name }));
  const tag = (g: string) => tags.find((t: any) => t.group === g)?.name ?? "";

  const variants: BuildVariant[] = (raw.data?.buildVariants?.values ?? []).map((v: any, idx: number) => {
    const meta = variantMeta.find((m) => m.id === v.id) ?? variantMeta[idx];
    const skills = (v.skillTree?.skills ?? []).filter((s: any) => s.actionType === "ACTIVATE");
    const ranks: Record<string, number> = {};
    for (const s of skills) ranks[s.skill.slug] = (ranks[s.skill.slug] ?? 0) + 1;
    const nodes: string[] = (v.paragon?.nodes ?? []).map((n: any) => n.slug);
    const paragon: ParagonBoard[] = (v.paragon?.boards ?? []).map((b: any) => ({
      slug: b.board?.slug ?? "",
      name: nameOf(b.board?.slug ?? "", undefined, "boards"),
      glyphSlug: b.glyph?.slug ?? "",
      glyphName: nameOf(b.glyph?.slug ?? "", undefined, "glyphs"),
      glyphLevel: b.glyphLevel ?? 0,
      x: b.x,
      y: b.y,
      rotation: b.rotation,
      nodes: nodes.filter((n) => b.board?.slug && n.startsWith(b.board.slug + "-x")),
    }));
    const merc = v.mercenary ?? {};
    const sections: GuideSection[] = (meta?.childrenIds ?? [])
      .map((id: string) => byId.get(id))
      .filter(Boolean)
      .map(sectionOf)
      .filter(Boolean) as GuideSection[];
    return {
      id: v.id,
      name: meta?.title ?? `Variant ${idx + 1}`,
      description: meta?.description ? lexicalToText(meta.description) : "",
      gear: normaliseSlots(v.genericBuilder?.slots ?? []),
      skillOrder: skills.map((s: any) => ({
        slug: s.skill.slug,
        name: nameOf(s.skill.slug, undefined, "skills"),
        type: s.skill.type?.id ?? "",
      })),
      skillRanks: ranks,
      skillBar: (v.assignedSkills?.skills ?? [])
        .filter((s: any) => s?.skill)
        .sort((a: any, b: any) => a.position - b.position)
        .map((s: any) => ({
          position: s.position,
          slug: s.skill.slug,
          name: s.skill.name ?? nameOf(s.skill.slug),
          description: s.skill.description ?? "",
          icon: s.skill.iconUrl ?? undefined,
        })),
      summons: (v.assignedSkills?.summons ?? [])
        .filter((s: any) => s?.spec)
        .map((s: any) => ({ type: s.type, slug: s.spec.slug, name: s.spec.name, description: s.spec.description ?? "" })),
      paragon,
      mercenary: {
        primary: merc.primaryMercenary?.slug ? nameOf(merc.primaryMercenary.slug, undefined, "mercs") : undefined,
        reinforcement: merc.reinforcementMercenary?.slug ? nameOf(merc.reinforcementMercenary.slug, undefined, "mercs") : undefined,
        reinforcementSkill: merc.skill?.slug ? nameOf(merc.skill.slug, undefined, "mercSkills") : undefined,
        trigger: merc.opportunity?.opportunity?.slug ? nameOf(merc.opportunity.opportunity.slug, undefined, "mercOpp") : undefined,
        skills: (merc.skillTree ?? []).filter((s: any) => s?.skill).map((s: any) => nameOf(s.skill.slug, undefined, "mercSkills")),
      },
      priority: (v.equipmentPriorityList ?? []).map((p: any) => p.slug),
      sections,
    };
  });

  // Sections not owned by a specific variant (overview, FAQ, changelog, ...)
  const sections = content
    .filter((c) => !variantChildIds.has(c.id))
    .map(sectionOf)
    .filter(Boolean) as GuideSection[];

  return {
    id: raw.id,
    source: "mobalytics",
    url,
    slug: raw.featured?.slug ?? raw.slugifiedName ?? "",
    name: raw.data?.name ?? raw.slugifiedName ?? "Build",
    author: raw.author?.name ?? "",
    className: tag("class"),
    season: tag("season"),
    tags,
    updatedAt: raw.updatedAt ?? "",
    fetchedAt: new Date().toISOString(),
    variants,
    sections,
  };
}

/** Just the build's last-updated time (tiny GraphQL query) — for "the author updated this guide" badges. */
export async function fetchUpdatedAt(slug: string): Promise<string | null> {
  try {
    const r = await httpJson<any>(GQL, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": BROWSER_UA },
      body: JSON.stringify({
        query: "query U($input: Diablo4UserGeneratedDocumentInputBySlug!) { diablo4 { documents { userGeneratedDocumentBySlug(input: $input) { data { updatedAt } } } } }",
        variables: { input: { type: "builds", slug } },
      }),
      timeoutMs: 15000,
    });
    return r?.data?.diablo4?.documents?.userGeneratedDocumentBySlug?.data?.updatedAt ?? null;
  } catch {
    return null;
  }
}

export async function importMobalytics(urlOrSlug: string, opts: ImportOptions = {}) {
  const { raw, via } = await fetchMobalyticsRaw(urlOrSlug, opts);
  const url = urlOrSlug.includes("://") ? urlOrSlug : `https://mobalytics.gg/diablo-4/builds/${urlOrSlug}`;
  const build = normaliseMobalytics(raw, url);
  return { build, via, defaultVariant: parseBuildUrl(urlOrSlug).variant };
}
