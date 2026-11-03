import { describe, expect, it } from "vitest";
import { detectTooltips } from "../src/lib/autojudge";

const mk = (x: number, y: number, w: number, text: string) => ({ x, y, w, h: 24, text, bullet: "normal" as const });
const cap = (lines: ReturnType<typeof mk>[], cursor: [number, number]) =>
  ({ ocr: { lines }, region: { x: 0, y: 0, w: 2400, h: 1440 }, cursor }) as unknown as Parameters<typeof detectTooltips>[0];
// a tooltip's lines, one under the other at the game's line spacing
const tip = (x: number, y: number, rows: [number, number, string][]) => rows.map(([dx, w, t], i) => mk(x + dx, y + i * 36, w, t));

// worn amulet on the left (its EQUIPPED header scrolled off), the hovered one on the right
const worn = tip(721, 257, [
  [0, 308, "Ancestral Legendary Amulet"],
  [0, 169, "900 Item Power"],
  [0, 196, "25 +25 Quality"],
  [30, 181, "Armory Loadout"],
  [0, 167, "288 All Resist"],
  [33, 152, "+270 Strength"],
  [33, 224, "+15.0% Attack Speed"],
  [33, 383, "Imprinted: Your Disciple skills now"],
  [33, 385, "Weaken enemies for 8 seconds. You"],
]);
const hovered = tip(1259, 136, [
  [0, 155, "WARD OF"],
  [3, 235, "SOVEREIGNTY"],
  [2, 199, "Legendary Amulet"],
  [2, 169, "850 Item Power"],
  [4, 420, "157 All Resist (-10.6% Toughness)"],
  [35, 223, "+145 Strength (-125)"],
  [1, 338, "Properties lost when equipped:"],
  [35, 224, "+15.0% Attack Speed"],
  [35, 105, "Socket (1)"],
  [228, 200, "Requires Level 70"],
  [238, 211, "Sell Value: 34,790"],
]);
// glossary text and junk under the tooltips that reaches across the gap between them
const bridge = [mk(642, 610, 538, "S, Macabre, or Agility Skill unleashes all souls."), mk(1058, 650, 279, "02 a a")];

describe("tooltip detection", () => {
  it("finds the hovered tooltip next to the worn one", () => {
    expect(detectTooltips(cap([...worn, ...hovered], [1802, 600]))?.hovered.box.x).toBe(1259);
  });

  it("keeps two tooltips side by side apart when a stray line bridges them", () => {
    const d = detectTooltips(cap([...worn, ...hovered, ...bridge], [1802, 600]));
    const text = d?.hovered.lines.map((l) => l.text) ?? [];
    expect(d?.hovered.box.x).toBe(1259);
    expect(text).toContain("WARD OF");
    expect(text).not.toContain("+270 Strength");
  });

  it("drops the game's Scroll Up hint from a line", () => {
    const d = detectTooltips(cap([mk(721, 185, 150, "EQUIPPED"), mk(721, 221, 260, "e Armory Scroll Up"), ...worn], [800, 300]));
    expect(d?.hovered.lines.map((l) => l.text)).toContain("e Armory");
  });
});
