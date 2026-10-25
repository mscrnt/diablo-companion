import { describe, expect, it } from "vitest";
import { inStrongroom, parseStrongroom, stageKey, stepStrongroom, type StrongroomAction, type StrongroomHud, type StrongroomTracker } from "../src/lib/strongroom";
import { line } from "./helpers";

/** A tracker block as it reads, written out by hand from the game's own objective wording. */
const block = (...objectives: string[]) => [line("Horadric Strongroom"), ...objectives.map((t, i) => line(t, 0, 30 + i * 30))];

describe("Horadric Strongroom tracker", () => {
  it("needs one of its own objectives, not just the name", () => {
    expect(inStrongroom(block("Slay Monsters for Horadric Attunement"))).toBe(true);
    expect(inStrongroom([line("Horadric Strongroom")])).toBe(false);
    // a Nightmare Sigil's affix over the tracker names the Strongroom but has no objective of it
    expect(inStrongroom([line("Escalation Sigil"), line("This place will always contain a Horadric Strongroom"), line("Ancient Reservoir in Hawezar")])).toBe(false);
    expect(parseStrongroom([line("Nightmare Dungeon"), line("Destroy the Seaborn Shrine: 1")])).toBeNull();
  });

  it("reads the step you are on, the furthest one showing", () => {
    expect(parseStrongroom(block("Slay Monsters for Horadric Attunement"))).toMatchObject({ stage: "attunement", label: "Attunement" });
    expect(parseStrongroom(block("Slay Monsters for Horadric Attunement", "Invoke 2/3 Horadric Statues"))).toMatchObject({ stage: "statues", label: "Statues 2/3", statues: { done: 2, needed: 3 } });
    expect(parseStrongroom(block("Slay Monsters for Horadric Attunement", "Enter the Main Chamber"))).toMatchObject({ stage: "main", label: "Main Chamber" });
    expect(parseStrongroom(block("Enter the Artifact Pillar Room"))).toMatchObject({ stage: "pillar" });
    expect(parseStrongroom(block("Slay the Strongroom Boss"))).toMatchObject({ stage: "boss", boss: true, done: false });
  });

  it("knows the rewards are open", () => {
    expect(parseStrongroom(block("Redeem your rewards at Horadric Cache"))).toMatchObject({ stage: "redeem", done: true });
    expect(parseStrongroom(block("Exit the Strongroom via the Portal"))).toMatchObject({ stage: "exit", done: true, label: "Left the Strongroom" });
  });

  it("reads reward upgrades and the death penalty", () => {
    const h = parseStrongroom(block("Slay Monsters for Horadric Attunement", "Reward Upgrades (3/6)", "Death penalty: 15s"))!;
    expect(h).toMatchObject({ upgrades: 3, upgradesMax: 6, deathPenalty: 15 });
    // no upgrade line yet: the chamber still has six to give
    expect(parseStrongroom(block("Slay the Strongroom Boss"))).toMatchObject({ upgrades: null, upgradesMax: 6, deathPenalty: null });
  });

  it("survives the OCR slips the other trackers show", () => {
    // "0" for O, "l" for I, a split count, icon specks on the ends
    const h = parseStrongroom([line("H0radric Str0ngroom •"), line("Slay M0nsters for H0radric Attunement"), line("Rewqrd Up-grades,(2/6)"), line("Death penaIty: 10s")])!;
    expect(h).toMatchObject({ stage: "attunement", upgrades: 2, upgradesMax: 6, deathPenalty: 10 });
    expect(parseStrongroom([line("Horadric Statues"), line("lnvoke 1/3 Horadric Statues")])).toMatchObject({ stage: "statues", statues: { done: 1, needed: 3 } });
  });

  it("gives each step its own key, so a repeat of the same read is not a step", () => {
    const a = parseStrongroom(block("Invoke 1/3 Horadric Statues"))!;
    const b = parseStrongroom(block("Invoke 1/3 Horadric Statues", "Reward Upgrades (1/6)"))!;
    const c = parseStrongroom(block("Invoke 2/3 Horadric Statues"))!;
    expect(stageKey(a)).toBe(stageKey(b));
    expect(stageKey(a)).not.toBe(stageKey(c));
  });
});

/** What the actions do to the run timer (like useRuns, without the store). */
function timer(canStart = true) {
  const t: StrongroomTracker = { run: null, endSeen: 0 };
  const runs: { start: number; splits: string[]; end?: number; cleared?: boolean; own: boolean }[] = [];
  const toasts: string[] = [];
  let active: (typeof runs)[number] | null = null;
  const apply = (a: StrongroomAction) => {
    if (a.kind === "start") {
      if (a.own) runs.push((active = { start: a.at, splits: [], own: true }));
      toasts.push("start");
    } else if (a.kind === "step") {
      if (active && a.label) active.splits.push(a.label);
    } else if (a.kind === "upgrade") toasts.push(`upgrade ${a.to}/${a.max}`);
    else if (a.kind === "discard") {
      if (active) runs.pop();
      active = null;
    } else {
      if (active) {
        active.end = a.at;
        active.cleared = a.cleared;
        active = null;
      } else runs.push({ start: a.from, end: a.at, cleared: a.cleared, splits: [], own: false });
      toasts.push(`end ${a.cleared ? "cleared" : "left"} ${a.upgrades}/${a.max}`);
    }
  };
  return {
    t,
    runs,
    toasts,
    feed(read: StrongroomHud | null, now: number) {
      for (const a of stepStrongroom(t, read, now, canStart && !active)) apply(a);
    },
  };
}

/** A whole chamber, read every 2 s the way the app reads the tracker. */
const replay = (steps: string[][], from = 0, canStart = true) => {
  const tm = timer(canStart);
  let now = from;
  for (const objectives of steps) {
    tm.feed(objectives.length ? parseStrongroom(block(...objectives)) : null, now);
    now += 2000;
  }
  return tm;
};

describe("timing a Horadric Strongroom", () => {
  const long = (objectives: string[], seconds: number) => Array.from({ length: Math.round(seconds / 2) }, () => objectives);

  it("times a chamber of its own, with a split per step", () => {
    const tm = replay([
      ...long(["Slay Monsters for Horadric Attunement", "Reward Upgrades (0/6)"], 20),
      ...long(["Invoke 1/3 Horadric Statues"], 10),
      ...long(["Invoke 2/3 Horadric Statues", "Reward Upgrades (2/6)"], 10),
      ...long(["Enter the Main Chamber"], 10),
      ...long(["Slay the Strongroom Boss"], 30),
      ["Redeem your rewards at Horadric Cache"],
      ["Redeem your rewards at Horadric Cache"],
    ]);
    expect(tm.runs).toHaveLength(1);
    expect(tm.runs[0].cleared).toBe(true);
    expect(tm.runs[0].own).toBe(true);
    // the clock starts at the first read of the block, not the second
    expect(tm.runs[0].start).toBe(0);
    expect(tm.runs[0].splits).toEqual(["Attunement", "Statues 1/3", "Statues 2/3", "Main Chamber"]);
    expect(tm.toasts).toContain("upgrade 2/6");
    expect(tm.toasts.at(-1)).toBe("end cleared 2/6");
  });

  it("inside a dungeon's run it is one split, with its own start", () => {
    const tm = replay([...long(["Slay Monsters for Horadric Attunement"], 30), ...long(["Slay the Strongroom Boss"], 20), ["Exit the Strongroom via the Portal"], ["Exit the Strongroom via the Portal"]], 10_000, false);
    expect(tm.runs).toEqual([{ start: 10_000, end: 10_000 + 52_000, cleared: true, splits: [], own: false }]);
  });

  it("a chamber you walk out of ends where it was last seen, uncleared without its boss", () => {
    const tm = replay([...long(["Invoke 1/3 Horadric Statues"], 40), ...Array.from({ length: 35 }, () => [])]);
    expect(tm.runs[0]).toMatchObject({ cleared: false });
    expect(tm.runs[0].end).toBe(38_000); // the last read of the block
  });

  it("one read of a sigil's affix text is not a chamber", () => {
    const tm = timer();
    tm.feed(parseStrongroom(block("Slay Monsters for Horadric Attunement")), 0);
    for (let i = 1; i <= 40; i++) tm.feed(null, i * 2000);
    expect(tm.runs).toEqual([]);
  });

  it("drops a run too short to have been a chamber, and the leftover exit line starts none", () => {
    const tm = replay([...long(["Exit the Strongroom via the Portal"], 10), ...Array.from({ length: 40 }, () => []), ...long(["Exit the Strongroom via the Portal"], 10)]);
    expect(tm.runs).toEqual([]);
  });

  it("picks a chamber up again after a restart, with no splits for what it missed", () => {
    const tm = timer();
    tm.t.run = { start: 0, lastSeen: 1000, reads: 1, stage: null, label: "", key: "", statues: null, upgrades: 0, upgradesMax: 6, deathPenalty: null, sawBoss: false, own: true, doneReads: 0, resumed: true };
    tm.feed(parseStrongroom(block("Slay the Strongroom Boss", "Reward Upgrades (4/6)")), 60_000);
    expect(tm.runs).toEqual([]); // nothing started: the run was already open in the store
    expect(tm.t.run).toMatchObject({ stage: "boss", upgrades: 4 });
    tm.feed(parseStrongroom(block("Exit the Strongroom via the Portal")), 62_000);
    tm.feed(parseStrongroom(block("Exit the Strongroom via the Portal")), 64_000);
    expect(tm.toasts.at(-1)).toBe("end cleared 4/6");
  });
});
