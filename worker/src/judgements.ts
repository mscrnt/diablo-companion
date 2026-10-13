// Shared judgements (opt-in in the app): batches of loot-judge results, with the tooltip text and crops,
// to build a test set across classes, builds and resolutions. Pure checks here, so they're unit tested.
// Nothing identifies a player: a random install id the app makes on opt-in, never a BattleTag, character
// name or IP. Stored under the report prefix (the MinIO user's only write scope) and deleted after 30 days.
import { OS_ALLOW, type Check, type Os } from "./validate";

export const MAX_ITEMS = 50;
export const MAX_DATA_BYTES = 64 * 1024;
export const MAX_IMAGE_BYTES = 400 * 1024; // base64 characters, about 300 KB of jpeg
export const SIGNALS = ["wrong", "right", "worn"] as const;
export type Signal = (typeof SIGNALS)[number];

export interface JudgementItem {
  kind: "judgement";
  id: string;
  at: number;
  data: Record<string, unknown>;
  images?: { tooltip?: string; equipped?: string };
}
export interface FeedbackItem {
  kind: "feedback";
  /** the judgement it's about */
  id: string;
  at: number;
  signal: Signal;
  note?: string;
}
export type Item = JudgementItem | FeedbackItem;

export interface Batch {
  install: string;
  version: string;
  os: Os;
  items: Item[];
}

const bad = (status: number, error: string): Check<never> => ({ ok: false, status, error });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERSION = /^\d+\.\d+\.\d+(-(alpha|beta|rc)\.\d+)?$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
/** a base64 jpeg: starts FF D8 FF, so "/9j/" */
const isJpeg = (s: unknown) => typeof s === "string" && s.length <= MAX_IMAGE_BYTES && /^\/9j\/[A-Za-z0-9+/]+={0,2}$/.test(s);

/** Whether an install id is one the app makes (crypto.randomUUID, lowercase). */
export const isInstallId = (s: unknown): s is string => typeof s === "string" && UUID.test(s);

/** A batch the app sends: `{ v: 1, install, version, os, items: [...] }`. */
export function parseBatch(raw: unknown, now = Date.now()): Check<Batch> {
  if (!isObj(raw) || raw.v !== 1) return bad(400, "not a judgement batch");
  if (!isInstallId(raw.install)) return bad(400, "bad install id");
  if (typeof raw.version !== "string" || !VERSION.test(raw.version)) return bad(400, "bad version");
  if (typeof raw.os !== "string" || !(OS_ALLOW as readonly string[]).includes(raw.os)) return bad(400, "bad os");
  if (!Array.isArray(raw.items) || !raw.items.length || raw.items.length > MAX_ITEMS) return bad(400, `send 1 to ${MAX_ITEMS} items`);
  const items: Item[] = [];
  for (const it of raw.items) {
    if (!isObj(it) || !isInstallId(it.id)) return bad(400, "bad item id");
    // queued at most a week ago (the app keeps unsent items across restarts), never from the future
    if (typeof it.at !== "number" || it.at > now + 86_400_000 || it.at < now - 7 * 86_400_000) return bad(400, "bad item time");
    if (it.kind === "judgement") {
      if (!isObj(it.data) || JSON.stringify(it.data).length > MAX_DATA_BYTES) return bad(400, "bad judgement data");
      let images: JudgementItem["images"];
      if (it.images !== undefined) {
        if (!isObj(it.images)) return bad(400, "bad images");
        for (const [k, v] of Object.entries(it.images)) if ((k !== "tooltip" && k !== "equipped") || !isJpeg(v)) return bad(400, "bad image");
        images = it.images as JudgementItem["images"];
      }
      items.push({ kind: "judgement", id: it.id, at: it.at, data: it.data, ...(images ? { images } : {}) });
    } else if (it.kind === "feedback") {
      if (typeof it.signal !== "string" || !(SIGNALS as readonly string[]).includes(it.signal)) return bad(400, "bad feedback");
      if (it.note !== undefined && (typeof it.note !== "string" || it.note.length > 300)) return bad(400, "bad note");
      items.push({ kind: "feedback", id: it.id, at: it.at, signal: it.signal as Signal, ...(it.note ? { note: it.note } : {}) });
    } else return bad(400, "bad item kind");
  }
  return { ok: true, value: { install: raw.install, version: raw.version, os: raw.os as Os, items } };
}

/** Where a batch goes: `debug/judgements/2026-10-13/<install>/<id>.json`, so one player's data is one folder a day. */
export function batchKey(prefix: string, install: string, id: string, now = new Date()): string {
  return `${prefix.replace(/\/?$/, "/")}judgements/${now.toISOString().slice(0, 10)}/${install}/${id}.json`;
}

/** The marker a "delete my data" request leaves: `debug/judgements-deleted/<install>.json`. */
export function deleteKey(prefix: string, install: string): string {
  return `${prefix.replace(/\/?$/, "/")}judgements-deleted/${install}.json`;
}

/**
 * The private issue for a "delete my data" request: the storage key can't delete (upload-only), so it
 * lists the commands that remove every batch from that install. Everything expires after 30 days anyway.
 */
export function deleteIssue(install: string, prefix: string, bucket: string, at = new Date()): { title: string; body: string } {
  const root = `${bucket}/${prefix.replace(/\/?$/, "/")}judgements`;
  return {
    title: `Delete shared judgements ${install}`,
    body: [
      `A player asked to delete their shared judgements (${at.toISOString()}). Their app has stopped sending and made a new install id.`,
      "",
      "Delete every batch from this install (replace `s3` with your mc alias):",
      "",
      "```sh",
      `mc find s3/${root} --path "*/${install}/*" --exec "mc rm {}"`,
      "```",
      "",
      `Then check nothing is left: \`mc find s3/${root} --path "*/${install}/*"\` should print nothing. Close this issue when done.`,
    ].join("\n"),
  };
}
