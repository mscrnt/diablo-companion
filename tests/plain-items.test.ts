// White and blue gear with no stats of its own, read while comparing with your gear (2026-10-13 test): the
// quick parse was right, the sanity check threw it out, and the AI read called them unique and scrapped them.
import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import { fastParse, looksSane, type FastLine } from "../src/lib/fastparse";
import { loadStaticData } from "../src/lib/names";

beforeAll(() => loadStaticData());

const L = (text: string, bullet: FastLine["bullet"] = "none"): FastLine => ({ text, bullet });
const lost = ["Properties lost when equipped:", "x26% Critical Strike Damage", "Multiplier", "+1,633 Maximum Life", "+144 Intelligence", "Unique Power", "Socket (1)", "Requires Level 70", "Sell Value: 5,915 •", "Equip"];

describe("plain gear with no stats", () => {
  it("a white ring: its title is its kind", () => {
    const item = fastParse([L("RING"), L("Ancestral Ring"), L("900 Item Power"), L("173 All Resist (-9.9% Toughness)"), ...lost.map((t) => L(t))], false, undefined)!;
    expect(item).toMatchObject({ rarity: "common", slot: "ring", itemPower: 900 });
    expect(looksSane(item)).toBe(true);
  });

  it("a white amulet", () => {
    const item = fastParse([L("AmULET"), L("Amulet"), L("850 Item Power"), L("157 All Resist (-18.2% Toughness)"), ...lost.map((t) => L(t))], false, undefined)!;
    expect(item.slot).toBe("amulet");
    expect(looksSane(item)).toBe(true);
  });

  it("a white chest", () => {
    const item = fastParse([L("HIDE TUNIC"), L("Ancestral Chest Armor"), L("900 Item Power"), L("2,805 Armor (-16.7% Toughness)"), ...lost.map((t) => L(t))], false, undefined)!;
    expect(item).toMatchObject({ name: "Hide Tunic", rarity: "common", slot: "chest" });
    expect(looksSane(item)).toBe(true);
  });

  it("a blue helm whose rarity word the OCR dropped", () => {
    const item = fastParse([L("STRIDER'S CROWN"), L("Helm"), L("850 Item Power"), L("1,275 Armor (-7.4% Toughness)"), ...lost.map((t) => L(t))], false, undefined)!;
    expect(item).toMatchObject({ name: "Strider's Crown", slot: "helm" });
    expect(item.rarity).not.toMatch(/unique|legendary|mythic/);
    expect(looksSane(item)).toBe(true);
  });

  it("a legendary that lost its rarity word still needs a closer look", () => {
    const item = fastParse(
      [L("RAZORPLATE"), L("Chest Armor"), L("900 Item Power"), L("+20% Thorns", "normal"), L("Gain thorns equal to your armor and deal increased damage while you have a barrier, up to 200% of your thorns.")],
      false,
      undefined,
    );
    if (item) expect(looksSane(item)).toBe(false);
  });
});

describe("the bottom of a seasonal socketable", () => {
  it("isn't gear, and is kept to amalgamate", () => {
    const item = fastParse([L("Amalgamable"), L("Account Bound"), L("Ø Seasonal Item"), L("Sell Value: 800 •")], false, undefined)!;
    expect(item.category).toBe("socketable");
    expect(decide(item, undefined).verdict).toBe("STASH");
  });
});
