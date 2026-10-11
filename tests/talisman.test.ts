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

describe("Undercity tributes", () => {
  it("are read as tributes, not gear, with what they earn and how much harder the run gets", async () => {
    const { readFileSync } = await import("node:fs");
    const { fastParse } = await import("../src/lib/fastparse");
    const f = JSON.parse(readFileSync(new URL("./fixtures/tooltips/mythic-tribute.json", import.meta.url), "utf8"));
    const item = fastParse(f.lines, false, ctx.variant)!;
    expect(item.category).toBe("tribute");
    const r = decide(item, ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
    expect(r.reasons.join(" ")).toMatch(/Mythic Unique/);
    expect(r.reasons.join(" ")).toMatch(/\+4 Monster Power.*45 s to start.*time bonuses -50%/);
  });

  it("even when the AI read it as an amulet", () => {
    const r = decide({ name: "Mythic Tribute of Armaments", slot: "amulet", rarity: "mythic", itemType: "Mythic Tribute", affixes: [], rawText: "Offer to the Undercity Spirit Brazier" } as any, ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Undercity/);
  });

  it("the Horadrim tribute is one to use: it earns charms and a Seal, which this build uses", () => {
    const raw = "GREATER TRIBUTE OF THE HORADRIM\nLegendary Greater Tribute of the Horadrim\nOffer to the Undercity Spirit Brazier to enhance its rewards:\n• Earn Horadric Charms and a Horadric Seal at Attunement Rank 1.\nOnly usable in Torment Difficulties.";
    const r = decide({ name: "Greater Tribute of the Horadrim", slot: "other", rarity: "legendary", itemType: "Legendary Greater Tribute of the Horadrim", affixes: [], rawText: raw, category: "tribute" } as any, ctx.variant, { prog: ctx.prog });
    expect(r.action).toMatch(/Use it on an Undercity run/);
    expect(r.reasons.join(" ")).toMatch(/Horadric Charms and a Horadric Seal/);
  });
});

describe("Chronicles of Nightmares", () => {
  it("a Chronicle of Nightmares is a key, never sold as an off-hand", () => {
    // as the AI read one (slot: offhand), with the tooltip text it saw
    const raw = "DIABLO III - THE SCOURING OF CALDEUM\nCHRONICLE OF NIGHTMARES\nRare Chronicle of Nightmares\nMinor Nightmare\nDiablo III - The Scouring of Caldeum in Burning Hells\nDUNGEON AFFIXES\nDungeon Delve\nStormbane's Wrath\nA vivid account of horrors long past, penned by a trembling hand.\nAccount Bound";
    const r = decide({ name: "Rare Chronicle of Nightmares", slot: "offhand", rarity: "rare", itemType: "Rare Chronicle of Nightmares", affixes: [], rawText: raw } as any, ctx.variant, { prog: ctx.prog });
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/use it on a Waking Nightmare \(Diablo III - The Scouring of Caldeum\)/);
    expect(r.reasons.join(" ")).toMatch(/Dungeon Delve, Stormbane's Wrath/);
  });
});
