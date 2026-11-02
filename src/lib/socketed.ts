// A gem in a socket shows as a stat line at the bottom of the item's stats ("120 Strength" for a Horadric
// Ruby in a helm). It moves to whatever you wear next, and the game's comparison leaves it out, so it
// must never count as the item's own stat (a helm with two Rubies was read with 270 Strength, 2026-11-02).
import { onStaticData, table } from "./names";

type Line = { re: RegExp; gem: string; target: string };
let lines: Line[] | null = null;
onStaticData(() => (lines = null));

const norm = (t: string) =>
  t
    .toLowerCase()
    .replace(/(\d),(?=\d{3}\b)/g, "$1")
    .replace(/[^a-z0-9%.{} ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

function gemLines(): Line[] {
  if (lines) return lines;
  const seen = new Set<string>();
  lines = [];
  for (const e of Object.values(table("gemLines"))) {
    const key = `${e.t}|${norm(e.d ?? "")}`;
    if (!e.d || seen.has(key)) continue;
    seen.add(key);
    // {VALUE1} is the damage or resistance type the gem names ("Fire", "Shadow")
    const body = escape(norm(e.d)).replace(/\\\{value1\\\}/g, "[a-z]+(?: [a-z]+){0,2}");
    lines.push({ re: new RegExp(`^${body}$`), gem: e.n, target: e.t ?? "" });
  }
  // a line that names its type ("Fire and Holy") before one that stands for any type
  lines.sort((a, b) => Number(a.re.source.includes("[a-z]+(?:")) - Number(b.re.source.includes("[a-z]+(?:")));
  return lines;
}

/** Which gem effects a slot shows: weapons and jewellery have their own, off-hands take either kind. */
export function gemTarget(slot: string): string[] {
  if (slot === "weapon") return ["weapon"];
  if (slot === "ring" || slot === "amulet") return ["jewelry"];
  if (slot === "offhand") return ["weapon", "armor"];
  if (["helm", "chest", "gloves", "pants", "boots"].includes(slot)) return ["armor"];
  return [];
}

/** The gem a stat line comes from ("@+120 Strength" in armor → Horadric Ruby), or null. */
export function socketedGem(text: string, slot: string): string | null {
  const targets = gemTarget(slot);
  if (!targets.length) return null;
  // an OCR'd gem icon leads the line ("@+120 Strength")
  const t = norm(text.replace(/^[^0-9x+\-]*/i, ""));
  for (const l of gemLines()) if (targets.includes(l.target) && l.re.test(t)) return l.gem;
  return null;
}
