// Pop-up events inside a dungeon run get their own split. The tracker reads below are the real ones from
// 2026-10-11 ("…Shrine: 1 / Nightmare Dungeon / Cursed Shrine", "Slay the Infested Villagers: 2 / Nightmare Dungeon /
// Nest"); the event's own lines under its name (countdown, objective, "Mastery:") follow the game's strings
// (Quest_DE_CursedShrine_Standard, ObjectiveTracker.Optional), since the logs cut the text off there.
import { describe, expect, it } from "vitest";
import { eventLabel, eventName, readDungeonEvent, readObjective, stepEvent, stepObjective, closeEvent, type EventRun, type ObjectiveState } from "../src/lib/dungeon";
import { loadStaticData } from "../src/lib/names";
import { beforeAll } from "vitest";

const L = (s: string) => s.split(" | ").map((text) => ({ text }));
beforeAll(() => loadStaticData());

const dungeon = "Torment X1 | Submerged Ruins | Destroy the Seabom Shrine: 1 | Nightmare Dungeon";
const shrine = (secs: number, mastery = "Mastery: Defeat 5 waves", count = 2) => `Cursed Shrine | X0:${String(secs).padStart(2, "0")} | Slay as many enemy waves as you can before time runs out: ${count} | ${mastery}`;

describe("reading an event off the tracker", () => {
  it("knows the events by name, OCR slips included", () => {
    expect(eventName("Cursed Shrine")).toBe("Cursed Shrine");
    expect(eventName("Nest •")).toBe("Nest");
    expect(eventName("Impromptu lnvestigation")).toBe("Impromptu Investigation");
    expect(eventName("Grand Spirit Beacon")).toBe("Grand Spirit Beacon");
    // the dungeon's own lines aren't events
    for (const t of ["Destroy the Seaborn Shrine: 1", "Nightmare Dungeon", "Submerged Ruins", "Free the Hostages", "Legion 10:00 PM", "Clear the nest"]) expect(eventName(t), t).toBeNull();
  });

  it("reads the event's block under the dungeon's: countdown, mastery, and only its own lines", () => {
    const ev = readDungeonEvent(L(`${dungeon} | ${shrine(45)} | Conquer a Nightmare Dungeon`))!;
    expect(ev).toMatchObject({ name: "Cursed Shrine", mastery: true, failed: false, secondsLeft: 45 });
    expect(ev.lines).toEqual([4, 5, 6, 7]);
    // the real read, cut short after the name
    expect(readDungeonEvent(L("Torment X1 | Blind Burrows | Slay the Infested Villagers: 2 • | Nightmare Dungeon | Nest"))).toMatchObject({ name: "Nest", mastery: false, secondsLeft: null });
    expect(readDungeonEvent(L(dungeon))).toBeNull();
  });

  it("a failed mastery reads as one", () => {
    expect(readDungeonEvent(L(`${dungeon} | ${shrine(12, "Mastery Failed")}`))).toMatchObject({ mastery: true, failed: true });
  });
});

describe("timing an event", () => {
  /** Feed reads 2 s apart (null = the dungeon's block without an event); the events that ended. */
  function play(texts: string[], t0 = 1_000_000) {
    let run: EventRun | null = null;
    const done = [];
    const objective: ObjectiveState = { objective: null, pending: null };
    const splits: string[] = [];
    texts.forEach((text, k) => {
      const lines = L(text);
      const ev = readDungeonEvent(lines);
      const r = stepEvent(run, ev, t0 + k * 2000);
      run = r.run;
      if (r.done) done.push(r.done);
      // the dungeon's objective, read from the lines above the marker without the event's (as the tracker does)
      const marker = lines.findIndex((l) => l.text === "Nightmare Dungeon");
      const own = new Set(ev?.lines ?? []);
      const above = lines.slice(0, marker).filter((_, i) => !own.has(i)).slice(2);
      const finished = stepObjective(objective, readObjective(above.map((l) => l.text).join(" "), "Submerged Ruins"));
      if (finished) splits.push(finished.label);
    });
    if (run) {
      const last = closeEvent(run);
      if (last) done.push(last);
    }
    return { done, splits, t0 };
  }

  it("one split with its duration and the mastery met; the dungeon's objective doesn't move", () => {
    const reads = [dungeon, dungeon, ...Array.from({ length: 30 }, (_, k) => `${dungeon} | ${shrine(60 - k * 2)}`), dungeon, dungeon, dungeon];
    const p = play(reads);
    expect(p.done).toHaveLength(1);
    expect(p.done[0]).toMatchObject({ name: "Cursed Shrine", start: p.t0 + 2 * 2000, end: p.t0 + 31 * 2000, mastery: "met" });
    expect(eventLabel(p.done[0])).toBe("Cursed Shrine: mastery met");
    expect(p.splits).toEqual([]);
  });

  it("a mastery failed partway counts as failed; an event without one has no mastery", () => {
    const failed = play([...Array(5).fill(`${dungeon} | ${shrine(40)}`), ...Array(5).fill(`${dungeon} | ${shrine(30, "Mastery Failed")}`), dungeon, dungeon]);
    expect(failed.done[0].mastery).toBe("failed");
    const nest = play([...Array(6).fill(`${dungeon} | Nest | X0:50 | Destroy Eggs before they hatch`), dungeon, dungeon]);
    expect(nest.done[0]).toMatchObject({ name: "Nest", mastery: null });
    expect(eventLabel(nest.done[0])).toBe("Nest");
  });

  it("one read without it (OCR missed the block) doesn't end it; one read of a name isn't an event", () => {
    const flicker = play([`${dungeon} | ${shrine(50)}`, `${dungeon} | ${shrine(48)}`, dungeon, `${dungeon} | ${shrine(44)}`, `${dungeon} | ${shrine(42)}`, dungeon, dungeon]);
    expect(flicker.done).toHaveLength(1);
    expect(flicker.done[0].end - flicker.done[0].start).toBe(8000);
    expect(play([`${dungeon} | ${shrine(50)}`, dungeon, dungeon, dungeon]).done).toHaveLength(0);
  });

  it("the dungeon's steps still split around an event", () => {
    const next = "Torment X1 | Submerged Ruins | Travel to the Brine | Nightmare Dungeon";
    const p = play([dungeon, dungeon, ...Array(10).fill(`${dungeon} | ${shrine(50)}`), dungeon, dungeon, next, next, next]);
    expect(p.done).toHaveLength(1);
    expect(p.splits).toEqual(["Destroy the Seabom Shrine: 1"]);
  });
});
