// A capture that starts below a unique's title (2026-10-11 RC test): the type line was its only name
// ("Unique Gloves"), and the base armor line was counted as a greater affix (a 4★ read as 5★).
import { beforeAll, describe, expect, it } from "vitest";
import { fastParse, type FastLine } from "../src/lib/fastparse";
import { tablesForTests } from "./fixtures/tables";
import { hasGameData } from "./setup";

beforeAll(() => tablesForTests());

const L = (text: string, bullet: FastLine["bullet"] = "none"): FastLine => ({ text, bullet });

describe("a unique without its title", () => {
  const gloves = [
    L("Ancestral Unique Gloves"),
    L("900 Item Power"),
    L("801 Armor (-13.6% Toughness)", "greater"), // the icon check misread the base line
    L("+225 Intelligence (+53)", "greater"),
    L("+12.5% Attack Speed (+12.5%)", "greater"),
    L("x30% Cold Damage Multiplier (+30%)", "greater"),
    L("+18.8% Barrier Generation (+18.8%)", "greater"),
    L("Damaging enemies with a Non-Basic Skill cast marks them for 3 seconds. When a Basic Skill first hits a marked enemy, the Basic Skill's damage is echoed to all marked enemies, dealing 120% increased damage.", "greater"),
    L("Requires Level 70"),
  ];

  // the power text is matched against the game's own unique powers, which the fixtures never hold
  it.skipIf(!hasGameData)("is named from its unique power", () => {
    expect(fastParse(gloves, false, undefined)?.name).toBe("Paingorger's Gauntlets");
  });

  it("never counts the base stat line as a greater affix", () => {
    const item = fastParse(gloves, false, undefined)!;
    expect(item.affixes.filter((a) => a.greater).length).toBe(4);
    expect(item.affixes[0].greater).toBe(false);
  });
});
