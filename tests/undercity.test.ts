import { describe, expect, it } from "vitest";
import { inUndercity, parseUndercity } from "../src/lib/undercity";

// tracker lines as the app read them during a real run (2026-10-10, Torment XI)
const L = (s: string) => s.split(" | ").map((text) => ({ text }));

describe("Kurast Undercity tracker", () => {
  it("reads floor, timer, upgrades and the floor's objectives", () => {
    const h = parseUndercity(L("FLOOR | 2/3 | 73 | Torment X1 | Kurast Undercity | 11 111 IV | Reward Upgrades (1/4) | Attunement: Ignite Beacons, Slay Monsters | X Time Bonus: Slay Afflicted Monsters"))!;
    expect(h).toMatchObject({ floor: 2, floors: 3, secondsLeft: 73, upgrades: 1, upgradesMax: 4 });
    expect(h.attunement).toBe("Ignite Beacons, Slay Monsters");
    expect(h.timeBonus).toBe("Slay Afflicted Monsters");
  });

  it("copes with the misreads seen in play", () => {
    expect(parseUndercity(L("FLOOR | 2/3 | 66 | Torment X1 | Kurast Undercity | Reward Upgrades (1/4)"))).toMatchObject({ floor: 2, done: false });
    expect(parseUndercity(L("FLOOR | 2/3 | 66 | Torment X1 | Kurast Undercity | 11 111. IV | Reward Upgrades,(2/4) | Attunement: Ignite Beacons, Slay_Monsters"))!.upgrades).toBe(2);
    expect(parseUndercity(L("FLOOR | 70 | 4VAfflicted | Torment X1 | Kurast Undercity | Reward Upgrades (1/4)"))).toMatchObject({ floor: null, secondsLeft: 70, upgrades: 1 });
    expect(parseUndercity(L("FLOOR | 1/3 | Torment X1 | Kürast Undercity | 11 111 IV | Reward Upgrades (0/4)"))).toMatchObject({ floor: 1, upgrades: 0 });
  });

  it("\"FLOOR 4/3\" with the attunement bar is the boss floor, not the end", () => {
    // 2026-10-15: fighting Alia, Kurast's End (+8) and Yoche the Golden (+6) on "FLOOR 4/3"
    expect(parseUndercity(L("FLOOR | 4/3 | 58 | Torment X1 | Kurast Undercity | 11 111 IV | 4/4) | Reward Upgrades ( | District Run"))).toMatchObject({ floor: 3, upgrades: 4, boss: true, bar: true, done: false });
    expect(parseUndercity(L("FLOOR | 4/3 | 50 | Torment XI | Kurast Undercity | 11 111 IV | Reward Upgrades (4/4 | District Run"))).toMatchObject({ boss: true, done: false });
    expect(parseUndercity(L("FLOOR | 3/3 | Torment XI | Kurast Undercity | Reward Upgrades (2/4)"))).toMatchObject({ boss: false, done: false });
  });

  it("the run is over when the attunement bar goes (the boss died)", () => {
    // seconds after the kill: the bar went first, then the upgrades line
    expect(parseUndercity(L("FLOOR | 4/3 | 58 | Torment X1 | Kurast Undercity | 4/4) | Reward Upgrades ( | District Run | Purge the Kurast Undercity"))).toMatchObject({ boss: false, done: true });
    expect(parseUndercity(L("FLOOR | 4/3 | 58 | Torment X1 | Kurast Undercity | District Run | Purge the Kurast Undercity@"))!.done).toBe(true);
    expect(parseUndercity(L("FLOOR | 4/3 | Torment XI | Kurast Undercity | District Run"))!.done).toBe(true);
  });

  it("reads the attunement bar however OCR spells it", () => {
    for (const bar of ["11 111 IV", "I II III IV", "1 11 111. IV", "|| ||| IV"]) expect(parseUndercity(L(`FLOOR | 4/3 | Kurast Undercity | ${bar}`))!.bar, bar).toBe(true);
    for (const not of ["Torment XI", "4/4)", "IV"]) expect(parseUndercity(L(`FLOOR | 4/3 | Kurast Undercity | ${not}`))!.bar, not).toBe(false);
  });

  it("isn't the Undercity outside a run", () => {
    // the quest line before entering, and the Journal page
    expect(inUndercity(L("Torment XI | Purge the Kurast Undercity | Descend into the Undercity and end the | horror that waits below."))).toBe(false);
    expect(inUndercity(L("ESC | JOURNAL | Quests | Nahantu | Purge the Kurast Undercity"))).toBe(false);
  });
});
