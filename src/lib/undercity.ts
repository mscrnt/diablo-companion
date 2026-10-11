// Kurast Undercity: read the run's tracker block —
//   FLOOR / 2/3 / 73 (seconds left) / Torment XI / Kurast Undercity / I II III IV /
//   Reward Upgrades (1/4) / Attunement: Ignite Beacons, Slay Monsters / Time Bonus: Slay Afflicted Monsters
// OCR slips seen in real runs are tolerated ("2B", "4/3" for 3/3, "Rewqrd Upgrades", "Up-grades,(2/4").
import type { OcrLine } from "./native";

export interface UndercityHud {
  floor: number | null;
  floors: number;
  /** the countdown under the floor number (time bonuses push it back up) */
  secondsLeft: number | null;
  upgrades: number | null;
  upgradesMax: number;
  /** what fills the attunement bar on this floor ("Ignite Beacons, Slay Monsters") */
  attunement: string | null;
  /** what adds time ("Slay Afflicted Monsters") */
  timeBonus: string | null;
  /** the run is over: the game shows "FLOOR 4/3" (past the last floor) and "District Run" */
  done: boolean;
}

type Line = Pick<OcrLine, "text"> & Partial<Pick<OcrLine, "x" | "y" | "w" | "h">>;

/** Is this tracker the Undercity's run block? Needs the zone name and the FLOOR label. */
export function inUndercity(lines: Line[]): boolean {
  const t = lines.map((l) => l.text).join("\n");
  return /k[uü]r[a-z0-9]{2}t\W*und[eé]r?c[il1]t|und[eé]rc[il1]ty/i.test(t) && lines.some((l) => /^\W*fl[o0]{2}r\W*$/i.test(l.text.trim()));
}

export function parseUndercity(lines: Line[]): UndercityHud | null {
  if (!inUndercity(lines)) return null;
  const fi = lines.findIndex((l) => /^\W*fl[o0]{2}r\W*$/i.test(l.text.trim()));
  let floor: number | null = null;
  let floors = 3;
  let past = false;
  let secondsLeft: number | null = null;
  // the floor and the timer are the next short lines after the FLOOR label
  for (let i = fi + 1; i < Math.min(lines.length, fi + 4); i++) {
    const t = lines[i].text.trim();
    const f = t.match(/^(\d)\s*[\/B]\s*(\d)?$/i);
    if (f && floor == null) {
      floors = f[2] ? Math.max(1, Number(f[2])) : floors;
      // "4/3" is not a misread: past the last floor means the run is complete
      past = Number(f[1]) > floors;
      floor = Math.min(Number(f[1]), floors);
      continue;
    }
    if (/^\d{1,3}$/.test(t) && secondsLeft == null) {
      secondsLeft = Number(t);
      break;
    }
  }
  const text = lines.map((l) => l.text).join("\n");
  const up = text.match(/up[\s-]*grades?\W*\(?\s*(\d)\s*\/\s*(\d)/i);
  const att = text.match(/a?t+une?r?y?m?ent:\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  const tb = text.match(/b[o0]nus\s*[:;]\s*([^\n]+)/i)?.[1]?.trim() ?? null;
  return {
    floor,
    floors,
    secondsLeft,
    upgrades: up ? Number(up[1]) : null,
    upgradesMax: up ? Number(up[2]) : 4,
    attunement: att ? att.replace(/[•◆]\s*$/, "").trim() : null,
    timeBonus: tb ? tb.replace(/[•◆]\s*$/, "").trim() : null,
    done: past || /district run/i.test(text),
  };
}
