// The "bars" overlay layout: which panels sit in the left and right black bar, in what order, and
// whether they stack from the top or the bottom. Each bar is a list with one "gap" in it: panels
// before the gap stack at the top, panels after it at the bottom. The left bar can also start lower
// to keep the top-left corner clear for Discord's voice overlay.

export type BarPanel = "activity" | "timers" | "run" | "farm" | "build" | "verdict" | "watchers" | "toasts";
export type BarItem = BarPanel | "gap";
export type Side = "left" | "right";
export type BarMove = "up" | "down" | "swap";

export interface Bars {
  left: BarItem[];
  right: BarItem[];
}

/** Where each panel goes by default (and where a panel added in an update first shows up). */
export const DEFAULT_BARS: Bars = {
  left: ["activity", "timers", "run", "farm", "build", "gap"],
  right: ["verdict", "watchers", "toasts", "gap"],
};

export const BAR_LABELS: Record<BarPanel, string> = {
  activity: "Activity (Helltide, Hordes, Undercity, bosses)",
  timers: "World events",
  run: "Run timer",
  farm: "Farm next",
  build: "Build card",
  verdict: "Loot verdict",
  watchers: "Tracked values",
  toasts: "Toasts",
};

const PANELS = Object.keys(BAR_LABELS) as BarPanel[];

/** Room for Discord as a fraction of the overlay height: kept between 5% and 60%. */
export const clampDiscordRoom = (h: number) => (Number.isFinite(h) ? Math.min(0.6, Math.max(0.05, h)) : 0.22);

/**
 * A clean layout from saved settings: unknown names and repeats dropped, one gap per bar (added at
 * the end if missing), and any panel that isn't in either bar put back where it goes by default.
 */
export function normalizeBars(saved: { left?: readonly string[]; right?: readonly string[] } | null | undefined): Bars {
  const seen = new Set<string>();
  const clean = (list: readonly string[] | undefined): BarItem[] => {
    const out: BarItem[] = [];
    let gap = false;
    for (const id of list ?? []) {
      if (id === "gap") {
        if (!gap) out.push("gap");
        gap = true;
      } else if ((PANELS as string[]).includes(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id as BarPanel);
      }
    }
    if (!gap) out.push("gap");
    return out;
  };
  const bars: Bars = { left: clean(saved?.left), right: clean(saved?.right) };
  for (const side of ["left", "right"] as Side[]) {
    for (const id of DEFAULT_BARS[side]) {
      if (id === "gap" || seen.has(id)) continue;
      // missing: into its default bar, just before the gap (top group)
      bars[side].splice(bars[side].indexOf("gap"), 0, id);
      seen.add(id);
    }
  }
  return bars;
}

/** The panels of one bar: the top group (before the gap) and the bottom group (after it). */
export function splitBar(list: readonly BarItem[]): { top: BarPanel[]; bottom: BarPanel[] } {
  const g = list.indexOf("gap");
  const at = g < 0 ? list.length : g;
  return { top: list.slice(0, at) as BarPanel[], bottom: list.slice(at + 1) as BarPanel[] };
}

/** Which bar a panel is in (after normalizing). */
export function sideOf(bars: Bars, id: BarPanel): Side {
  return bars.left.includes(id) ? "left" : "right";
}

/**
 * Move a panel: "up" / "down" swap it with its neighbour (stepping over the gap moves it between the
 * top and the bottom group), "swap" moves it to the other bar, in the same group (top: last of the
 * top group; bottom: first of the bottom group). Returns a new layout; the input isn't changed.
 */
export function movePanel(saved: { left?: readonly string[]; right?: readonly string[] }, id: BarPanel, move: BarMove): Bars {
  const bars = normalizeBars(saved);
  const side = sideOf(bars, id);
  const list = [...bars[side]];
  const i = list.indexOf(id);
  if (move === "up" || move === "down") {
    const j = move === "up" ? i - 1 : i + 1;
    if (j < 0 || j >= list.length) return bars;
    [list[i], list[j]] = [list[j], list[i]];
    return { ...bars, [side]: list };
  }
  const other: Side = side === "left" ? "right" : "left";
  const bottom = i > list.indexOf("gap");
  list.splice(i, 1);
  const dest = [...bars[other]];
  const g = dest.indexOf("gap");
  dest.splice(bottom ? g + 1 : g, 0, id);
  return { ...bars, [side]: list, [other]: dest } as Bars;
}
