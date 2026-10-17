// Alert outputs: synthesized sounds, Windows toasts, Discord webhooks, overlay toasts.
import { isPermissionGranted, requestPermission, sendNotification } from "@tauri-apps/plugin-notification";
import { http, isTauri } from "./http";
import { emitOverlay } from "./bus";

let ctx: AudioContext | null = null;

export type Tone = "alert" | "bis" | "good" | "bad" | "tick";

const TONES: Record<Tone, [number, number][]> = {
  // [frequency Hz, duration ms] sequences
  alert: [
    [660, 120],
    [880, 160],
    [660, 120],
  ],
  bis: [
    [523, 110],
    [659, 110],
    [784, 110],
    [1047, 260],
  ],
  good: [
    [700, 90],
    [940, 140],
  ],
  bad: [[220, 200]],
  tick: [[1200, 40]],
};

export function playTone(tone: Tone, volume = 0.5) {
  try {
    ctx ??= new AudioContext();
    let t = ctx.currentTime;
    for (const [f, ms] of TONES[tone]) {
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = tone === "bad" ? "sawtooth" : "triangle";
      o.frequency.value = f;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, volume * 0.4), t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + ms / 1000);
      o.connect(g).connect(ctx.destination);
      o.start(t);
      o.stop(t + ms / 1000 + 0.02);
      t += ms / 1000 + 0.03;
    }
  } catch {
    /* audio unavailable */
  }
}

/**
 * World event alerts (sound, toasts, Discord) fire whether or not the game runs, unless the player
 * asked for them only while Diablo IV is running. An alert skipped this way isn't sent later.
 */
export function alertsAllowed(onlyWhileGameRuns: boolean, game: { running: boolean } | null | undefined): boolean {
  return !onlyWhileGameRuns || !!game?.running;
}

let permission: boolean | null = null;
export async function toast(title: string, body: string) {
  if (!isTauri) return;
  try {
    permission ??= (await isPermissionGranted()) || (await requestPermission()) === "granted";
    if (permission) sendNotification({ title, body });
  } catch {
    /* ignore */
  }
}

export async function discord(webhook: string, content: string) {
  if (!webhook) return;
  try {
    await http(webhook, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: "Sanctuary Toolkit", content }),
      timeoutMs: 10000,
    });
  } catch (e) {
    console.warn("discord webhook failed", e);
  }
}

export interface OverlayToast {
  id: string;
  title: string;
  body?: string;
  color?: string;
  ttl: number;
}

export function overlayToast(title: string, body?: string, color?: string, ttl = 6000) {
  emitOverlay("toast", { id: crypto.randomUUID(), title, body, color, ttl } satisfies OverlayToast);
}
