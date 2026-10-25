import { describe, expect, it } from "vitest";
import { keepable } from "../src/lib/share";

describe("the kept share queue", () => {
  const now = Date.UTC(2026, 9, 25, 12);
  const item = (id: string, hoursAgo: number, size = 10) => ({ id, at: now - hoursAgo * 3_600_000, pad: "x".repeat(size) });

  it("keeps everything recent that fits, oldest first", () => {
    expect(keepable([item("a", 3), item("b", 2), item("c", 1)], now).map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("drops anything older than a week", () => {
    expect(keepable([item("old", 24 * 8), item("new", 1)], now).map((i) => i.id)).toEqual(["new"]);
  });

  it("keeps the newest when it's over the size budget", () => {
    const q = [item("a", 3, 400), item("b", 2, 400), item("c", 1, 400)];
    expect(keepable(q, now, 1000).map((i) => i.id)).toEqual(["b", "c"]);
  });
});
