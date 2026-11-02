// Gems in sockets show as stat lines at the bottom of the item's stats. They move to whatever you wear
// next and the game's comparison leaves them out, so they aren't the item's stats (2026-11-02: a helm with
// two Rubies was read with 270 Strength, one line of it "tempered").
import { readFileSync } from "node:fs";
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse } from "../src/lib/fastparse";
import { socketedGem } from "../src/lib/socketed";
import { tablesForTests } from "./fixtures/tables";
import { hasGameData } from "./setup";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));

describe("socketed gems", () => {
  beforeAll(async () => void (await tablesForTests()));

  it("knows a gem's line for the kind of slot it's in", () => {
    expect(socketedGem("@+120 Strength", "helm")).toBe("Horadric Ruby");
    expect(socketedGem("+90 Strength", "pants")).toBe("Grand Ruby");
    expect(socketedGem("+98 Strength", "helm")).toBeNull();
    expect(socketedGem("120 Strength", "ring")).toBeNull();
    expect(socketedGem("x28% Fire and Holy Damage Multiplier", "weapon")).toBe("Horadric Ruby");
    // several gems share "x28% {type} Damage Multiplier" and "+3500 {type} Resistance": a gem, whichever it is
    expect(socketedGem("x28% Poison Damage Multiplier", "weapon")).toMatch(/^Horadric /);
    expect(socketedGem("+3,500 Cold Resistance", "ring")).toMatch(/^Horadric /);
  });

  it("reads a helm's gems as its sockets, not its stats", () => {
    const f = fixture("helm-two-rubies");
    const item = fastParse(f.lines, f.equippedLabel, undefined)!;
    expect(item.affixes.map((a) => a.text)).toEqual(["1,167 Armor", "+60 Strength", "+750 Armor", "+11.5% Barrier Generation", "+239 Resistance to All Elements"]);
    expect(item.affixes.some((a) => a.tempered)).toBe(false);
    expect(item.socketed).toEqual(["Horadric Ruby", "Grand Ruby"]);
    expect(item.sockets).toBe(2);
  });

  it("counts an empty socket, and the one the comparison says you'd give up", () => {
    const f = fixture("helm-socket-fewer");
    const item = fastParse(f.lines, f.equippedLabel, undefined)!;
    expect(item.sockets).toBe(1);
    expect(item.socketsLost).toBe(1);
    expect(item.affixes.find((a) => /strength/i.test(a.text))?.text).toMatch(/98 Strength/);
  });

  // telling the power text from a stat takes the game's word list
  it.skipIf(!hasGameData)("never takes a stat above the item's power for a gem, whatever it reads like", () => {
    const f = fixture("sword-stat-like-a-gem");
    const item = fastParse(f.lines, f.equippedLabel, undefined)!;
    expect(item.affixes.some((a) => /x6% All Damage Multiplier/.test(a.text))).toBe(true);
    expect(item.socketed).toBeUndefined();
    expect(item.sockets).toBe(1);
  });
});
