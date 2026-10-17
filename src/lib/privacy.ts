// What shared judgements must never carry: anything that names a player. Tooltips themselves don't, but
// OCR picks up what's behind and around them: nameplates ("Valora | 70 (229)"), guild tags
// ("<TSG> Malzahar"), chat ("[Party] Name: hi"), BattleTags ("Name#1234") and your own characters'
// names (the Character panel shows yours next to your gear).
import type { Rect } from "./native";

// a nameplate's "| 70", or its level and paragon "70 (241)" when OCR misreads the bar ("BoheQueenä170 (241)");
// a guild tag; a chat line; a BattleTag
const PERSONAL = /\|\s*\d{1,3}\b|(?:^|[^\d+\-])[1l|]?\d{1,2}\s*\(\d{1,3}\)|[a-wyzäöü][1l|]70\b|^\W*<[^>]{1,12}>|^\W*\[[^\]]{1,20}\]\s*[^:]{1,24}:|[A-Za-z][\w]{1,15}#\d{4,6}\b/;

/** Your characters' names, as whole words (the Character panel shows yours: "BAZAQ" above "Stats & Materials") */
let ownNames: string[] = [];
const namesRe = (flags: string) => new RegExp(`(^|[^a-z])(?:${ownNames.join("|")})(?=$|[^a-z])`, flags);

/** The names of your characters (profiles.ts): a line with one of them names a player too. */
export function setCharacterNames(names: string[]) {
  ownNames = names.map((n) => n.trim().replace(/[^A-Za-z]/g, "")).filter((n) => n.length >= 2);
}

/** A line of OCR text that names a player. */
export const isPersonalLine = (text: string) => PERSONAL.test(text) || (ownNames.length > 0 && namesRe("i").test(text));

/** Your characters' names taken out of a sentence: "great for your Necromancer (Bazaq)" → "… ([character])". */
export const withoutNames = (text: string) => (ownNames.length ? text.replace(namesRe("gi"), "$1[character]") : text);

/** Drop the lines that name a player from a block of text (a parsed item's raw tooltip text). */
export const withoutPersonal = (text: string) =>
  text
    .split("\n")
    .filter((l) => !isPersonalLine(l))
    .join("\n");

/** Whether two screen rects overlap. */
export const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
