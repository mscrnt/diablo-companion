import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { inMenuFooter } from "../src/lib/autojudge";

const fixture = (name: string) => JSON.parse(readFileSync(new URL(`./fixtures/tooltips/${name}.json`, import.meta.url), "utf8"));
const L = (...t: string[]) => t.map((text) => ({ text }));

describe("bag, stash or vendor open?", () => {
  // items in the bag's right-hand columns cover the CHARACTER header, so the tooltip's own footer has to tell
  it("recognises the footer that only menus show", () => {
    expect(inMenuFooter(fixture("mythic-tribute").lines)).toBe(true); // "Select", "Mark as Junk"
    expect(inMenuFooter(L("+120 Intelligence", "Equip", "SHIFT", "+ Drop", "Hide Comparison"))).toBe(true);
    expect(inMenuFooter(L("Sell Value: 35,492", "Unequip"))).toBe(true);
    expect(inMenuFooter(L("Take", "Mark as Favorite"))).toBe(true);
  });
  it("ground loot has no such footer", () => {
    expect(inMenuFooter(L("EDGEMASTER'S BOUNDARY", "Ancestral Legendary Ring", "900 Item Power", "+120 Intelligence", "Requires Level 70"))).toBe(false);
    // an affix that merely contains the words doesn't count
    expect(inMenuFooter(L("+15% Damage to Enemies that Take Damage over Time", "Lucky Hit: Up to a 20% chance to Equip"))).toBe(false);
  });
});
