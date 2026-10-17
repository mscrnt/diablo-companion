// Shared judgements never carry a player's name: lines that name one are dropped from the text, and their
// boxes blacked out in the picture. Real OCR lines from 2026-10-12/13 logs.
import { readFileSync, readdirSync } from "node:fs";
import { afterEach, describe, expect, it } from "vitest";
import { isPersonalLine, setCharacterNames, withoutNames, withoutPersonal } from "../src/lib/privacy";

describe("lines that name a player", () => {
  it("nameplates, guild tags, chat and BattleTags", () => {
    for (const t of [
      "Valora | 70 (229)",
      "<RtS> Looter | 70 (247)",
      "<TSG> Malzahar | 70",
      "Wednesday | 70 (224)",
      "BoheQueenä170 (241)",
      "BoneQueehi170 )",
      "[Party] Kenny: nice drop",
      "[Whisper] Someone: wtb",
      "Pillows#1234",
    ])
      expect(isPersonalLine(t), t).toBe(true);
  });

  it("never a tooltip's own lines", () => {
    // every line of every logged tooltip fixture stays
    const dir = new URL("./fixtures/tooltips/", import.meta.url);
    const lines: string[] = [];
    const walk = (x: unknown) => {
      if (Array.isArray(x)) x.forEach(walk);
      else if (x && typeof x === "object") {
        const o = x as Record<string, unknown>;
        if (typeof o.text === "string") lines.push(o.text);
        Object.values(o).forEach(walk);
      } else if (typeof x === "string" && x.length < 200) lines.push(x);
    };
    for (const f of readdirSync(dir).filter((f) => f.endsWith(".json"))) walk(JSON.parse(readFileSync(new URL(f, dir), "utf8")));
    expect(lines.length).toBeGreaterThan(200);
    const hit = lines.filter(isPersonalLine);
    expect(hit, hit.join(" / ")).toEqual([]);
    for (const t of ["25 (+25) Quality", "+111 Strength (-69)", "Socket (1)", "Radament's Desecration (0/5)", "(2) Set:", "Sell Value: 32,535 •", "Tempers: 3/3", "x29% Critical Strike Damage"])
      expect(isPersonalLine(t), t).toBe(false);
  });

  it("drops them from a block of text", () => {
    expect(withoutPersonal("THE PENITENT'S\nRING\n<TSG> Malzahar | 70\nAncestral Legendary Ring")).toBe("THE PENITENT'S\nRING\nAncestral Legendary Ring");
  });
});

describe("your own characters' names", () => {
  afterEach(() => setCharacterNames([]));

  it("a line with one, as the Character panel shows it behind a tooltip, names a player", () => {
    expect(isPersonalLine("232 BAZAQ Aged Boots")).toBe(false);
    setCharacterNames(["Bazaq", "Zorvak", ""]);
    expect(isPersonalLine("232 BAZAQ Aged Boots")).toBe(true);
    expect(isPersonalLine("Zorvak")).toBe(true);
    // only the whole word
    for (const t of ["Bazaqs Ring", "Pact of Bone", "+144 Intelligence"]) expect(isPersonalLine(t), t).toBe(false);
  });

  it("are taken out of a verdict before it's shared", () => {
    setCharacterNames(["Bazaq"]);
    expect(withoutNames("Stash it: great for your Necromancer (Bazaq).")).toBe("Stash it: great for your Necromancer ([character]).");
    expect(withoutNames("Wear this: it's better than yours.")).toBe("Wear this: it's better than yours.");
    setCharacterNames([]);
    expect(withoutNames("Stash it: great for your Necromancer (Bazaq).")).toBe("Stash it: great for your Necromancer (Bazaq).");
  });
});
