// Pure parts of the debug system (no Tauri, no DOM): the in-memory event ring, the event file
// names and their pruning, truncation for readable JSON, secret redaction and the issue link.
// The runtime side (timers, files, marks) is in debug.ts.

export interface DebugEvent {
  /** unix ms */
  ts: number;
  /** subsystem: autojudge, activity, hordes, mappins, skillbar, overlay, input, game, llm, error, debug */
  src: string;
  type: string;
  data?: unknown;
}

// ---- ring buffer ----------------------------------------------------------------------------

/** The last `windowMs` of events (and at most `maxCount`), kept in memory even with test mode off. */
export class EventRing {
  private buf: DebugEvent[] = [];
  private head = 0;
  constructor(
    readonly windowMs = 90_000,
    readonly maxCount = 3000,
  ) {}

  push(e: DebugEvent) {
    this.buf.push(e);
    this.trim(e.ts);
  }

  private trim(now: number) {
    const cutoff = now - this.windowMs;
    while (this.head < this.buf.length && (this.buf[this.head].ts < cutoff || this.buf.length - this.head > this.maxCount)) this.head++;
    // compact now and then instead of shifting on every push
    if (this.head > 512 && this.head * 2 > this.buf.length) {
      this.buf = this.buf.slice(this.head);
      this.head = 0;
    }
  }

  /** Events at or after `ts`, oldest first. */
  since(ts: number): DebugEvent[] {
    const out: DebugEvent[] = [];
    for (let i = this.head; i < this.buf.length; i++) if (this.buf[i].ts >= ts) out.push(this.buf[i]);
    return out;
  }

  /** Everything still in the window, oldest first (`now` drops what has aged out). */
  all(now = Date.now()): DebugEvent[] {
    this.trim(now);
    return this.buf.slice(this.head);
  }

  get size() {
    return this.buf.length - this.head;
  }
}

// ---- event files ----------------------------------------------------------------------------

const pad2 = (n: number) => String(n).padStart(2, "0");

/** Local calendar day, YYYY-MM-DD. */
export const dayKey = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

/** events-YYYY-MM-DD.jsonl, then events-YYYY-MM-DD.1.jsonl … once a day's file gets big. */
export const eventsFileName = (d: Date, part = 0) => `events-${dayKey(d)}${part ? `.${part}` : ""}.jsonl`;

const EVENTS_RE = /^events-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.jsonl$/;

/** Sort key of an events file name (day, then part), or null if it isn't one. */
export function eventsFileKey(name: string): [string, number] | null {
  const m = name.match(EVENTS_RE);
  return m ? [m[1], Number(m[2] ?? 0)] : null;
}

/** One file grows to this size before the next part starts. */
export const EVENTS_PART_BYTES = 8 * 1024 * 1024;

/**
 * Test mode's size budget is shared: a tenth (at least 10 MB, at most 100 MB) for the event log,
 * the rest for the test-mode frames.
 */
export function splitBudget(maxMB: number) {
  const events = Math.min(100, Math.max(10, Math.round(maxMB * 0.1)));
  return { eventsMB: events, framesMB: Math.max(10, maxMB - events) };
}

/** The part to write to today: the highest existing part for the day, or the next one if it is full. */
export function currentPart(files: { name: string; size: number }[], day: string, partBytes = EVENTS_PART_BYTES): { part: number; size: number } {
  let best = { part: 0, size: 0 };
  for (const f of files) {
    const k = eventsFileKey(f.name);
    if (k && k[0] === day && k[1] >= best.part) best = { part: k[1], size: f.size };
  }
  return best.size >= partBytes ? { part: best.part + 1, size: 0 } : best;
}

/** Event files to delete (oldest first) so the rest fit in `budgetBytes`. The newest file is always kept. */
export function planEventsPrune(files: { name: string; size: number }[], budgetBytes: number): string[] {
  const ev = files
    .map((f) => ({ ...f, key: eventsFileKey(f.name) }))
    .filter((f): f is typeof f & { key: [string, number] } => !!f.key)
    .sort((a, b) => (a.key[0] === b.key[0] ? a.key[1] - b.key[1] : a.key[0] < b.key[0] ? -1 : 1));
  let total = ev.reduce((n, f) => n + f.size, 0);
  const out: string[] = [];
  for (const f of ev.slice(0, -1)) {
    if (total <= budgetBytes) break;
    out.push(f.name);
    total -= f.size;
  }
  return out;
}

/** Folder name for a mark: local time, sortable, safe on Windows. */
export const markStamp = (d: Date) =>
  `${dayKey(d)}T${pad2(d.getHours())}-${pad2(d.getMinutes())}-${pad2(d.getSeconds())}-${String(d.getMilliseconds()).padStart(3, "0")}`;

/** Marks to delete so only the newest `keep` remain (names sort by time). */
export function planMarksPrune(names: string[], keep = 30): string[] {
  const sorted = [...names].sort();
  return sorted.slice(0, Math.max(0, sorted.length - keep));
}

// ---- truncation -----------------------------------------------------------------------------

export interface TruncateOpts {
  /** longest string kept (longer: cut, with the original length noted) */
  str?: number;
  /** longest array kept (longer: first items plus a "+N more" marker) */
  arr?: number;
  /** nesting depth kept */
  depth?: number;
  /** most keys kept per object */
  keys?: number;
}

const round = (n: number) => (Number.isInteger(n) ? n : Math.round(n * 1000) / 1000);

/** Make a value small and readable for a JSON file: short strings, short arrays, no images, no functions. */
export function truncate(v: unknown, o: TruncateOpts = {}, depth = 0): unknown {
  const str = o.str ?? 240,
    arr = o.arr ?? 24,
    maxDepth = o.depth ?? 6,
    keys = o.keys ?? 60;
  if (v == null || typeof v === "boolean") return v;
  if (typeof v === "number") return Number.isFinite(v) ? round(v) : String(v);
  if (typeof v === "string") {
    // base64 images and data URLs never go into debug files
    // (a frame is thousands of base64 chars with no spaces; OCR text always has some)
    if (/^data:image\//.test(v) || (v.length > 1000 && /^[A-Za-z0-9+/]+={0,2}$/.test(v))) return `[image ${v.length} chars]`;
    return v.length > str ? `${v.slice(0, str)}… [${v.length} chars]` : v;
  }
  if (typeof v === "function" || typeof v === "symbol") return undefined;
  if (typeof v === "bigint") return String(v);
  if (v instanceof Error) return truncate({ name: v.name, message: v.message, stack: v.stack?.split("\n").slice(0, 6).join("\n") }, o, depth);
  if (depth >= maxDepth) return Array.isArray(v) ? `[array ${v.length}]` : "[object]";
  if (Array.isArray(v)) {
    const out = v.slice(0, arr).map((x) => truncate(x, o, depth + 1));
    if (v.length > arr) out.push(`… +${v.length - arr} more`);
    return out;
  }
  const out: Record<string, unknown> = {};
  const entries = Object.entries(v as Record<string, unknown>);
  for (const [k, x] of entries.slice(0, keys)) {
    const t = truncate(x, o, depth + 1);
    if (t !== undefined) out[k] = t;
  }
  if (entries.length > keys) out["…"] = `+${entries.length - keys} more keys`;
  return out;
}

// ---- secrets --------------------------------------------------------------------------------

export const REDACTED = "[redacted]";

/** Settings fields that hold secrets (or private URLs). Never written to any debug file. */
const SECRET_PATHS = [
  ["llm", "apiKey"],
  ["llm", "baseUrl"],
  ["alerts", "discordWebhook"],
  ["obs", "password"],
  ["flaresolverr"],
] as const;
const SECRET_KEY_RE = /(api[-_]?key|password|passwd|secret|token|webhook|auth)/i;

/** A copy of the settings with every secret replaced by "[redacted]" (empty ones stay empty, so you can tell they're unset). */
export function redactSettings<T>(settings: T): T {
  const s = structuredClone(settings) as any;
  for (const path of SECRET_PATHS) {
    let o = s;
    for (const k of path.slice(0, -1)) o = o?.[k];
    const last = path[path.length - 1];
    if (o && typeof o[last] === "string" && o[last]) o[last] = REDACTED;
  }
  // and anything else that looks like a secret, anywhere
  const walk = (o: any) => {
    if (!o || typeof o !== "object") return;
    for (const k of Object.keys(o)) {
      if (typeof o[k] === "string" && o[k] && SECRET_KEY_RE.test(k)) o[k] = REDACTED;
      else walk(o[k]);
    }
  };
  walk(s);
  return s;
}

/** The secret values in the settings, to scrub from free text (error messages, URLs in logs). */
export function secretValues(settings: { llm?: { apiKey?: string; baseUrl?: string }; alerts?: { discordWebhook?: string }; obs?: { password?: string } }): string[] {
  return [settings.llm?.apiKey, settings.alerts?.discordWebhook, settings.obs?.password].filter((x): x is string => !!x && x.length >= 4);
}

const WEBHOOK_RE = /https?:\/\/(?:[\w-]+\.)?discord(?:app)?\.com\/api\/webhooks\/[^\s"'\\]+/gi;
const BEARER_RE = /(Bearer\s+)[A-Za-z0-9._~+/-]{8,}=*/g;

/** Remove secrets from serialized text: the given values, Discord webhook URLs and bearer tokens. */
export function scrub(text: string, secrets: string[]): string {
  let out = text.replace(WEBHOOK_RE, "[discord-webhook]").replace(BEARER_RE, `$1${REDACTED}`);
  for (const s of secrets) if (s && out.includes(s)) out = out.split(s).join(REDACTED);
  // a secret inside JSON is escaped: catch that form too
  for (const s of secrets) {
    const esc = JSON.stringify(s).slice(1, -1);
    if (esc !== s && out.includes(esc)) out = out.split(esc).join(REDACTED);
  }
  return out;
}

/** One JSON Lines row: ts (ISO), src, type, data. */
export function eventLine(e: DebugEvent, secrets: string[] = []): string {
  return scrub(JSON.stringify({ ts: new Date(e.ts).toISOString(), src: e.src, type: e.type, ...(e.data === undefined ? {} : { data: e.data }) }), secrets);
}

// ---- overlay render state -------------------------------------------------------------------

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** One thing the overlay draws: where (overlay CSS px and absolute screen px) and what it says. */
export interface RenderedElement {
  id: string;
  css: Box;
  screen: Box;
  /** visible text (short); containers list their children instead */
  text?: string;
  children?: string[];
}

/** What the overlay window is drawing, reported by the overlay itself (it is hidden from screen capture). */
export interface OverlayRender {
  at: number;
  window: { css: Box; dpr: number; origin: [number, number]; gameRect: [number, number, number, number] | null };
  visible: boolean;
  opacity: number;
  edit: boolean;
  layout: "bars" | "free";
  gameBounds: { left: number; right: number; top: number; bottom: number } | null;
  verdictCard: { state: string; quiet: boolean; verdict?: string; action?: string; tooltipBox: Box } | null;
  verdictPanel: { verdict: string; item: string; judgedAt: number } | null;
  judging: boolean;
  toasts: { title: string; body?: string }[];
  mapPins: { pins: number; clip: Box; hud: number; zoom: number; label?: string; drawn: boolean } | null;
  guide: { title: string; step: number; steps: number; instruction: string; highlights: number } | null;
  hordes: { aether: number | null; offers: { title: string; rank: number }[]; chests: { name: string; order: number }[] } | null;
  advisor: { title: string; items: { name: string; rank: number }[] } | null;
  helltide: { cinders: number | null; secondsLeft: number | null; best: string | null } | null;
  boss: string | null;
  elements: RenderedElement[];
}

/** Absolute screen px of a box measured in overlay CSS px (the overlay's origin is the game window's corner). */
export function cssToScreen(b: Box, origin: [number, number], dpr: number): Box {
  return { x: Math.round(origin[0] + b.x * dpr), y: Math.round(origin[1] + b.y * dpr), w: Math.round(b.w * dpr), h: Math.round(b.h * dpr) };
}

// ---- error hooks ----------------------------------------------------------------------------

/** Short text for anything thrown or logged. */
export function describe(x: unknown): string {
  if (x instanceof Error) return `${x.name}: ${x.message}${x.stack ? "\n" + x.stack.split("\n").slice(1, 4).join("\n") : ""}`;
  if (typeof x === "string") return x;
  try {
    return JSON.stringify(x);
  } catch {
    return String(x);
  }
}

/**
 * Send this window's uncaught errors, unhandled rejections and console.warn / console.error to
 * `sink` (the event log). Installed once per window; the sink can't loop back into itself.
 */
export function installDebugHooks(sink: (type: string, data: Record<string, unknown>) => void) {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __debugHooks?: boolean };
  if (w.__debugHooks) return;
  w.__debugHooks = true;
  let inside = false;
  const safe = (type: string, data: Record<string, unknown>) => {
    if (inside) return;
    inside = true;
    try {
      sink(type, data);
    } catch {
      /* never let logging break the app */
    } finally {
      inside = false;
    }
  };
  window.addEventListener("error", (e) =>
    safe("uncaught", { message: e.message, source: e.filename?.split("/").pop(), line: e.lineno, col: e.colno, stack: e.error?.stack?.split("\n").slice(0, 5).join("\n") }),
  );
  window.addEventListener("unhandledrejection", (e) => safe("unhandled-rejection", { reason: describe(e.reason).slice(0, 600) }));
  for (const level of ["warn", "error"] as const) {
    const orig = console[level].bind(console);
    console[level] = (...args: unknown[]) => {
      orig(...args);
      safe(`console.${level}`, { msg: args.map(describe).join(" ").slice(0, 600) });
    };
  }
}

// ---- issue link -----------------------------------------------------------------------------

export const ISSUES_NEW = "https://github.com/mscrnt/diablo-companion/issues/new";

/** A pre-filled "new issue" link. The user attaches the zip themselves: nothing is uploaded. */
export function issueUrl(o: { version: string; zipName: string; included: string[]; os?: string; title?: string }): string {
  const body = [
    "**What happened?**",
    "<!-- What did you expect, and what did the app do instead? -->",
    "",
    "**When?**",
    "<!-- Roughly what time, and what you were doing in game (a Pit run, the map open, hovering an item...). If you pressed the \"mark this moment\" key, say which mark. -->",
    "",
    "**Debug report**",
    `Please drag \`${o.zipName}\` (saved in your Downloads folder) into this box to attach it.`,
    "",
    `Contains: ${o.included.join(", ")}.`,
    "",
    "---",
    `Sanctuary Toolkit v${o.version}${o.os ? ` · ${o.os}` : ""}`,
  ].join("\n");
  const q = new URLSearchParams({ title: o.title ?? `Bug: `, body, labels: "bug" });
  return `${ISSUES_NEW}?${q.toString()}`;
}
