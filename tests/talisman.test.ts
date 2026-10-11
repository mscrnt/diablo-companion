import { beforeAll, describe, expect, it } from "vitest";
import { decide } from "../src/lib/judge";
import type { ParsedItem } from "../src/lib/types";
import { exampleBuild } from "./helpers";

let ctx: Awaited<ReturnType<typeof exampleBuild>>;
beforeAll(async () => void (ctx = await exampleBuild()));

const charm = (name: string): ParsedItem =>
  ({ name, slot: "charm", rarity: "legendary", itemType: "Ancestral Set Charm", itemPower: 900, affixes: [{ text: "+4 to Minion Skills", greater: false, tempered: false, masterwork: false, enchanted: false, match: null }] }) as any;

describe("charms and caches", () => {
  // the AI parse can leave out the category: a charm must never be judged as gear
  it("keeps the build's own charm, by its own name", () => {
    const r = decide(charm("Mlor of the Black Shroud"), ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("SOCKET");
    expect(r.action).toMatch(/Mlor of the Black Shroud \(Charm 2\)/);
  });

  it("keeps another piece of the build's set", () => {
    const r = decide(charm("Peace of the Black Shroud"), ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Black Shroud set/);
  });

  it("stashes other charms instead of scrapping them", () => {
    expect(decide(charm("Phoba of the Waking Touch"), ctx.variant, { prog: ctx.prog }).verdict).toBe("STASH");
  });

  it("never scraps a Whisper Cache", () => {
    const r = decide({ name: "Whisper Cache", slot: "other", rarity: "legendary", itemType: "", affixes: [], rawText: "COLLECTION OF\nWhisper Cache" } as any, ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
  });
});
