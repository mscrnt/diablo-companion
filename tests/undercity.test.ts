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

  it("knows the run is over: \"FLOOR 4/3\" (past the last floor) and \"District Run\"", () => {
    // seen at the end of two real runs: not a misread of 3/3
    expect(parseUndercity(L("FLOOR | 4/3 | 50 | Torment XI | Kurast Undercity | 11 111 IV | Reward Upgrades (4/4 | District Run"))).toMatchObject({ floor: 3, upgrades: 4, done: true });
    expect(parseUndercity(L("FLOOR | 4/3 | Torment XI | Kurast Undercity | District Run"))!.done).toBe(true);
    expect(parseUndercity(L("FLOOR | 3/3 | Torment XI | Kurast Undercity | Reward Upgrades (2/4)"))!.done).toBe(false);
  });

  it("isn't the Undercity outside a run", () => {
    // the quest line before entering, and the Journal page
    expect(inUndercity(L("Torment XI | Purge the Kurast Undercity | Descend into the Undercity and end the | horror that waits below."))).toBe(false);
    expect(inUndercity(L("ESC | JOURNAL | Quests | Nahantu | Purge the Kurast Undercity"))).toBe(false);
  });
});
