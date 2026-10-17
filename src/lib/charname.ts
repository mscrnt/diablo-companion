// The character's name, read off the Character panel: it sits in capitals above the title and the
// "Stats & Materials" button ("232 BAZAQ Aged Boots Stats & Materials Weapon Damage 4,574 …" in a
// 2026-10 log). Names are letters only, 2 to 12 of them, so one word on its own.
import { confusionKey, editDistance } from "./ocrfix";

const ANCHOR = /stats\s*\S{0,2}\s*materia/i;
const HEADER = /^\W*character\b/i;
/** Panel words that stand alone like a name does */
const UI_WORDS = new Set([
  "character", "equipment", "inventory", "stats", "materials", "toughness", "armor", "close", "bonus", "pvp", "utility",
  "offensive", "defensive", "core", "weapon", "damage", "strength", "intelligence", "willpower", "dexterity", "life",
  "attributes", "level", "paragon", "title", "titles", "gold", "socketables", "consumables", "quest", "aspects", "unequip",
]);

const NAME = /^[A-Za-z]{2,12}$/;
const isCaps = (w: string) => w === w.toUpperCase();
/** A title under the name: one to three words, letters only ("Aged Boots", OCR may join them: "AgedBoots") */
const isTitle = (t: string) => /^[A-Za-z][A-Za-z' ]{2,30}$/.test(t) && t.split(/\s+/).length <= 3;
/** Numbers and marks around a word ("232 BAZAQ", "Zorvak ·") */
const trim = (t: string) => t.replace(/^[\W\d_]+|[\W\d_]+$/g, "");

/**
 * One line's name and what follows it on the same line: "BAZAQ Aged Boots" → BAZAQ (capitals, then
 * a title), "Zorvak" → Zorvak. null when the line isn't a name.
 */
function nameIn(text: string): { name: string; rest: string } | null {
  const t = trim(text);
  if (NAME.test(t)) return UI_WORDS.has(t.toLowerCase()) ? null : { name: t, rest: "" };
  const m = t.match(/^([A-Z]{2,12})\s+([A-Z][a-z].*)$/);
  return m && !UI_WORDS.has(m[1].toLowerCase()) ? { name: m[1], rest: m[2] } : null;
}

/**
 * The character's name in one OCR frame, or null. Only with the "Stats & Materials" button in the
 * frame: the name is among the lines just above it (or below the panel's "CHARACTER" header). A word
 * in capitals is the name; any other word must have a title right after it, so a title read without
 * its name ("Aged Boots") or a stat label is never taken for one.
 */
export function readCharacterName(lines: { text: string }[]): string | null {
  const a = lines.findIndex((l) => ANCHOR.test(l.text));
  if (a < 0) return null;
  let h = a - 1;
  while (h >= 0 && !HEADER.test(lines[h].text)) h--;
  const from = h >= 0 && a - h <= 8 ? h + 1 : Math.max(0, a - 4);
  // the button's own line can start with the panel text left of it
  const texts = lines.slice(from, a + 1).map((l, i, all) => (i === all.length - 1 ? l.text.split(ANCHOR)[0] : l.text));
  for (let i = 0; i < texts.length; i++) {
    const hit = nameIn(texts[i]);
    if (!hit) continue;
    const next = hit.rest || (texts[i + 1] ?? "").trim();
    if (isCaps(hit.name) || isTitle(next)) return displayName(hit.name);
  }
  return null;
}

/** "BAZAQ" → "Bazaq": the panel shows capitals, so the real casing isn't known. */
export const displayName = (name: string) => name.charAt(0).toUpperCase() + name.slice(1).toLowerCase();

/** Two reads of the same name: equal once OCR look-alikes are folded, or one letter apart in a longer name. */
export function sameName(a: string, b: string): boolean {
  const x = confusionKey(a);
  const y = confusionKey(b);
  return x === y || (Math.min(x.length, y.length) >= 5 && editDistance(x, y, 1) <= 1);
}
