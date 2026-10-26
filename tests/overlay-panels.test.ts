import { describe, expect, it } from "vitest";
import {
  LEAD_CHOICES,
  MAP_PINS_SPEC,
  OVERLAY_SPEC,
  PANELS,
  PANEL_IDS,
  PANEL_LABELS,
  PIN_GROUPS,
  SETTABLE_PATHS,
  applyOverlayPatch,
  hiddenPanels,
  optionValue,
  optionsFor,
  pinGroupsNow,
  setLead,
  setPinGroup,
  showPanel,
  touchesMapPins,
  type OverlayPatch,
  type PanelId,
  type PanelSettings,
  type PanelSpec,
} from "../src/lib/overlaypanels";
import { defaultSettings, presetGroups, type MapPinGroup, type Settings } from "../src/lib/store";

const fresh = (): Settings => structuredClone(defaultSettings);
const read = (s: Settings, path: string) => path.split(".").reduce<any>((o, k) => o?.[k], s);
const panelSettings = (s: Settings): PanelSettings => ({
  overlay: s.overlay,
  alerts: { enabled: s.alerts.enabled, leadMinutes: s.alerts.leadMinutes, sound: s.alerts.sound, volume: s.alerts.volume, onlyWhileGameRuns: s.alerts.onlyWhileGameRuns },
  autoJudge: s.autoJudge,
  hordes: s.hordes,
  mapPins: s.mapPins,
  autoRuns: s.autoRuns,
});
const allSpecs: PanelSpec[] = [...PANEL_IDS.map((id) => PANELS[id]), OVERLAY_SPEC, MAP_PINS_SPEC];

describe("which options each panel exposes", () => {
  it("covers every panel the overlay can hide, with a name and a page", () => {
    expect(PANEL_IDS).toEqual(["activity", "timers", "run", "farm", "build", "verdict", "watchers", "toasts", "status"]);
    for (const id of PANEL_IDS) {
      expect(PANEL_LABELS[id]).toBeTruthy();
      expect(PANELS[id].more.page).toBeTruthy();
      // the hide switch is the panel's own "on", the one the Overlay page ticks
      expect(PANELS[id].hide).toBe(`overlay.widgets.${id}.on`);
    }
  });

  it("names settings that exist, and nothing player-facing uses an em dash", () => {
    const s = fresh();
    for (const id of PANEL_IDS) expect(read(s, PANELS[id].hide), PANELS[id].hide).toBeTypeOf("boolean");
    for (const spec of allSpecs) {
      for (const o of spec.options) {
        if (o.kind === "toggle" || o.kind === "range" || o.kind === "choice") expect(read(s, o.path), o.path).not.toBeUndefined();
        if (o.kind === "range") expect(read(s, o.path)).toBeGreaterThanOrEqual(o.min);
        if (o.kind === "choice") expect(o.choices.map((c) => c.value)).toContain(read(s, o.path));
        expect(o.label).not.toMatch(/[—–]/);
      }
    }
    for (const id of PANEL_IDS) expect(PANEL_LABELS[id]).not.toMatch(/[—–]/);
  });

  it("only offers the Size slider where a panel is scaled", () => {
    const size = (spec: PanelSpec, layout: "bars" | "free") => optionsFor(spec, layout).some((o) => o.kind === "range" && o.path.endsWith(".scale"));
    // a bar sizes the panels inside it, so Size would do nothing there
    expect(size(PANELS.timers, "bars")).toBe(false);
    expect(size(PANELS.timers, "free")).toBe(true);
    expect(optionsFor(PANELS.timers, "free")).toHaveLength(optionsFor(PANELS.timers, "bars").length + 1);
    // the status corner sits in no bar: it scales in either layout
    expect(size(PANELS.status, "bars")).toBe(true);
    expect(size(PANELS.status, "free")).toBe(true);
  });

  it("gives the panels the owner asked about their own options", () => {
    const paths = (spec: PanelSpec) => spec.options.flatMap((o) => ("path" in o ? [o.path] : [o.kind]));
    expect(paths(PANELS.verdict)).toContain("overlay.verdictSeconds");
    expect(paths(PANELS.verdict)).toContain("autoJudge.showBadge");
    expect(paths(PANELS.timers)).toContain("eventKinds");
    expect(paths(PANELS.timers)).toContain("leadMinutes");
    expect(paths(OVERLAY_SPEC)).toContain("overlay.opacity");
    expect(paths(MAP_PINS_SPEC)).toEqual(expect.arrayContaining(["mapPins.enabled", "pinPresets", "pinGroups"]));
  });

  it("reads a control's value out of the settings the overlay receives", () => {
    const s = fresh();
    s.overlay.opacity = 0.5;
    expect(optionValue(panelSettings(s), "overlay.opacity")).toBe(0.5);
    expect(optionValue(panelSettings(s), "autoRuns")).toBe(true);
    expect(optionValue(panelSettings(s), "nope.nope")).toBeUndefined();
  });
});

describe("hide and restore", () => {
  it("lists what is switched off, in the order the panels are listed", () => {
    const s = fresh();
    expect(hiddenPanels(s.overlay.widgets)).toEqual(["farm", "build"]);
    s.overlay.widgets.timers.on = false;
    expect(hiddenPanels(s.overlay.widgets)).toEqual(["timers", "farm", "build"]);
  });

  it("hides a panel and brings it back through the same setting", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, showPanel("timers", false))).toBe(true);
    expect(s.overlay.widgets.timers.on).toBe(false);
    expect(hiddenPanels(s.overlay.widgets)).toContain("timers");
    expect(applyOverlayPatch(s, showPanel("timers", true))).toBe(true);
    expect(s.overlay.widgets.timers.on).toBe(true);
    expect(hiddenPanels(s.overlay.widgets)).not.toContain("timers");
  });

  it("can hide every panel and show every one again", () => {
    const s = fresh();
    for (const id of PANEL_IDS) applyOverlayPatch(s, showPanel(id, false));
    expect(hiddenPanels(s.overlay.widgets)).toEqual([...PANEL_IDS]);
    for (const id of hiddenPanels(s.overlay.widgets)) applyOverlayPatch(s, showPanel(id, true));
    expect(hiddenPanels(s.overlay.widgets)).toEqual([]);
  });
});

describe("settings patches from the overlay", () => {
  it("writes an allowed path and clamps a slider to its range", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, { set: "overlay.opacity", value: 0.44 })).toBe(true);
    expect(s.overlay.opacity).toBe(0.44);
    expect(applyOverlayPatch(s, { set: "overlay.opacity", value: 9 })).toBe(true);
    expect(s.overlay.opacity).toBe(1);
    expect(applyOverlayPatch(s, { set: "overlay.verdictSeconds", value: 0 })).toBe(true);
    expect(s.overlay.verdictSeconds).toBe(2);
  });

  it("refuses a path no gear offers, a wrong type and a value that isn't a choice", () => {
    const s = fresh();
    const before = structuredClone(s);
    for (const p of [
      { set: "llm.apiKey", value: "nope" },
      { set: "share.enabled", value: true },
      { set: "gamePath", value: "C:/" },
      { set: "overlay.opacity", value: true },
      { set: "overlay.opacity", value: Number.NaN },
      { set: "alerts.sound", value: 1 },
      { set: "hordes.style", value: "reckless" },
      { set: "mapPins.preset", value: "lots" },
      { set: "overlay.widgets.nope.on", value: false },
    ] as OverlayPatch[]) {
      expect(applyOverlayPatch(s, p), JSON.stringify(p)).toBe(false);
    }
    expect(s).toEqual(before);
    // every path a popover can write is on the list, and the overlay can't switch itself off
    for (const id of PANEL_IDS) expect(SETTABLE_PATHS.has(PANELS[id].hide)).toBe(true);
    expect(SETTABLE_PATHS.has("overlay.enabled")).toBe(false);
  });

  it("ticks one world event kind without touching the others", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, { set: "alerts.enabled.helltide", value: false })).toBe(true);
    expect(s.alerts.enabled).toEqual({ worldBoss: true, helltide: false, legion: true, other: true });
  });

  it("adds and drops alert lead times, longest warning first", () => {
    expect(setLead([5, 1], 15, true)).toEqual([15, 5, 1]);
    expect(setLead([15, 5, 1], 5, false)).toEqual([15, 1]);
    expect(setLead([5, 1], 5, true)).toEqual([5, 1]);
    const s = fresh();
    expect(applyOverlayPatch(s, { lead: 10, on: true })).toBe(true);
    expect(s.alerts.leadMinutes).toEqual([10, 5, 1]);
    expect(applyOverlayPatch(s, { lead: 7, on: true })).toBe(false);
    expect(applyOverlayPatch(s, { lead: LEAD_CHOICES[0], on: "yes" as unknown as boolean })).toBe(false);
    expect(s.alerts.leadMinutes).toEqual([10, 5, 1]);
  });

  it("switches the map pins off, and says when the pins have to be redrawn", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, { set: "mapPins.enabled", value: false })).toBe(true);
    expect(s.mapPins.enabled).toBe(false);
    expect(applyOverlayPatch(s, { set: "mapPins.preset", value: "off" })).toBe(true);
    expect(s.mapPins.preset).toBe("off");
    expect(touchesMapPins({ set: "mapPins.preset", value: "off" })).toBe(true);
    expect(touchesMapPins({ pinGroup: "cellar", on: false })).toBe(true);
    expect(touchesMapPins({ set: "overlay.opacity", value: 1 })).toBe(false);
  });
});

describe("picking which kinds of map pin show", () => {
  it("reports the kinds showing now, preset or custom", () => {
    const s = fresh();
    expect(pinGroupsNow(s.mapPins)).toEqual(s.mapPins.groups);
    s.mapPins.preset = "dungeons";
    const now = pinGroupsNow(s.mapPins);
    expect(now.dungeon).toBe(true);
    expect(now.cellar).toBe(true);
    expect(now.journal).toBe(false);
    expect(Object.keys(now).sort()).toEqual(PIN_GROUPS.map((g) => g.id).sort());
  });

  it("unticking a kind under a preset keeps the rest of that preset, as Custom", () => {
    const s = fresh();
    s.mapPins.preset = "everything";
    expect(applyOverlayPatch(s, { pinGroup: "cellar", on: false })).toBe(true);
    expect(s.mapPins.preset).toBe("custom");
    expect(s.mapPins.groups.cellar).toBe(false);
    // everything else that preset drew is still ticked
    const was = presetGroups("everything", s.mapPins.groups);
    for (const g of PIN_GROUPS.map((x) => x.id).filter((g) => g !== "cellar")) expect(s.mapPins.groups[g], g).toBe(!!was[g]);
  });

  it("ticking a kind adds it to the Custom preset", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, { pinGroup: "helltide_chest", on: true })).toBe(true);
    expect(s.mapPins.preset).toBe("custom");
    expect(s.mapPins.groups.helltide_chest).toBe(true);
    expect(s.mapPins.groups.journal).toBe(true);
  });

  it("refuses a kind that isn't one of ours", () => {
    const s = fresh();
    expect(applyOverlayPatch(s, { pinGroup: "treasure" as MapPinGroup, on: true })).toBe(false);
    expect(s.mapPins.preset).toBe("custom");
    expect(setPinGroup(s.mapPins, "dungeon", false).groups.dungeon).toBe(false);
  });
});

describe("the panel ids match the settings", () => {
  it("every panel has a widget entry, and every widget entry is a panel", () => {
    const s = fresh();
    expect(Object.keys(s.overlay.widgets).sort()).toEqual([...PANEL_IDS].sort());
    // the ids line up with the bar layout too, status aside (it sits in no bar)
    const inBars = [...s.overlay.bars.left, ...s.overlay.bars.right].filter((x) => x !== "gap").sort();
    expect(inBars).toEqual(PANEL_IDS.filter((id: PanelId) => id !== "status").sort());
  });
});
