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

describe("keys are never scrapped", () => {
  const k = (name: string, raw: string, slot = "other") => decide({ name, slot, rarity: "legendary", itemType: "", affixes: [], rawText: raw } as any, ctx.variant, { prog: ctx.prog });
  it("a Hordes compass opens the Infernal Hordes", () => {
    // the AI read one as gear ("Your build doesn't use this kind of item → Scrap")
    const r = k("Compass", "Pass through the Gates of Hell to face\nthe Infernal Hordes.", "offhand");
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Infernal Hordes/);
  });
  it("sigils say what they open", () => {
    expect(k("Broken Bulwark Escalation Sigil", "Legendary Escalation Sigil\nBrave a series of dungeons, each one deadlier than the last").action).toMatch(/Escalating Nightmare/);
    expect(k("Garan Hold Nightmare Sigil", "Nightmare Sigil\n0 Garan Hold in Kehjistan\nDUNGEON AFFIXES\nHoradric Strongroom\nVolcanic").action).toMatch(/Nightmare Dungeon \(Garan Hold\)/);
  });
  it("the bottom half of a Chronicle (no title) is still a Chronicle, not a ring", () => {
    const r = k("Diamond Reserve", "Raging\nA vivid account of horrors long past, penned\nby a trembling hand.", "ring");
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/Waking Nightmare/);
  });
});

describe("tribute advice comes from what it earns", () => {
  it("a Tribute of Armaments isn't called a charm tribute because a neighbouring item mentions a Seal", () => {
    const raw = "Rare Tribute of Armaments\nOffer to the Undercity Spirit Brazier\nto enhance its rewards:\n• Complete with Attunement Rank 1 or higher for a chance to earn Legendary equipment.\nHoradric Seal of Glory";
    const r = decide({ name: "Rare Tribute of Armaments", slot: "other", rarity: "rare", itemType: "Rare Tribute", affixes: [], rawText: raw, category: "tribute" } as any, ctx.variant, { prog: ctx.prog });
    expect(r.action).not.toMatch(/charms and a Seal/);
  });
});

// the capture started below the title (2026-10-11 test session): only the description was read
describe("caches and experience tomes", () => {
  const read = async (texts: string[]) => {
    const { fastParse } = await import("../src/lib/fastparse");
    return fastParse(texts.map((text) => ({ text, bullet: "none" as const })), false, ctx.variant)!;
  };

  it("a Dungeon Cache: open it", async () => {
    const item = await read(["A collection of items as a reward for", "completing a Dungeon the first time.", "Use this cache to receive your rewards.", "Account Bound", "Cannot Salvage", "Sell Value: Cannot Be Sold"]);
    expect(item.category).toBe("consumable");
    const r = decide(item, ctx.variant, { prog: ctx.prog }, null);
    expect(r.verdict).toBe("STASH");
    expect(r.action).toMatch(/^Open it/);
  });

  it("an Experience Tome: use it", async () => {
    const item = await read(["Grants a substantial amount of", "experience.", "Use this cache to receive your rewards.", "Within are the teachings of ages past. Use", "them to build a better future.", "Account Bound", "Cannot Salvage"]);
    expect(item.name).toBe("Experience Tome");
    expect(decide(item, ctx.variant, { prog: ctx.prog }, null).action).toMatch(/grants experience/);
  });
});

// a spare seal against the mythic one you wear (2026-10-11 RC test): the comparison lists what you'd lose
describe("spare seals", () => {
  const read = async (texts: string[]) => {
    const { fastParse } = await import("../src/lib/fastparse");
    return fastParse(texts.map((text) => ({ text, bullet: "none" as const })), false, ctx.variant)!;
  };
  const seal = ["HARMONIOUS", "HORADRIC SEAL", "OF CURSES", "Legendary Horadric Seal", "850 Item Power", "Unlocks 5 Charm Slots", "+7.0% All Stats (-0.5%)", "Word of the Blood Binder:", "+9% Blood Skill Damage", "Radament's Desecration:", "+7% Damage against Cursed Enemies"];

  it("yours unlocks more slots and has more powers: salvage it", async () => {
    const item = await read([...seal, "Properties lost when equipped:", "Unlocks 1 Charm Slots", "Seal Power", "Seal Power", "Seal Power", "Requires Level 50", "Sell Value: 13,380,834"]);
    const r = decide(item, ctx.variant, { prog: ctx.prog }, null);
    expect(r.verdict).toBe("SCRAP");
    expect(r.action).toMatch(/1 more charm slot and 3 seal powers/);
  });

  it("against your seal's own column: a mythic wins", async () => {
    const item = await read([...seal, "Requires Level 50"]);
    const worn = await read(["SEAL OF THE", "DIAMOND MIND", "Mythic Horadric Seal", "900 Item Power", "Unlocks 6 Charm Slots", "+7.5% All Stats", "Rathma's Walking Touch:", "+7% Minion Damage", "Requires Level 70"]);
    const r = decide(item, ctx.variant, { prog: ctx.prog }, worn);
    expect(r.verdict).toBe("SCRAP");
    expect(r.action).toMatch(/a mythic seal \(5 charm slots vs your 6\)/);
  });

  it("without a comparison it's still kept for the build", async () => {
    const r = decide(await read([...seal, "Requires Level 50"]), ctx.variant, { prog: ctx.prog }, null);
    expect(r.verdict).toBe("SOCKET");
  });
});

describe("a seal the AI read couldn't name", () => {
  it("'Unlocks 5 Charm Slots' makes it a seal, never off-hand gear to scrap", () => {
    const item: ParsedItem = {
      name: "Legendary Horadric Seal",
      rarity: "legendary",
      itemType: "",
      slot: "offhand",
      itemPower: null,
      affixes: [{ text: "Unlocks 5 Charm Slots", greater: false }],
      aspect: null,
      rawText: "Unlocks 5 Charm Slots\n20.0% Damage (+20.0%)\nProperties lost when equipped:\nUnlocks 1 Charm Slots\n+7.5% All Stats\nSeal Power\nSeal Power\nSeal Power\nRequires Level 50",
    };
    const r = decide(item, ctx.variant, { prog: ctx.prog }, null);
    expect(r.verdict).toBe("SCRAP");
    expect(r.action).toMatch(/the seal you wear is better/);
  });
});
