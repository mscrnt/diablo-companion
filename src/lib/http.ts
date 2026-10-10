// fetch() that bypasses webview CORS by routing through the Tauri HTTP plugin.
// Falls back to window.fetch when running in a plain browser (vite dev).
import { fetch as tauriFetch } from "@tauri-apps/plugin-http";

export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export async function http(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<Response> {
  const { timeoutMs = 60000, ...rest } = init ?? {};
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const f = isTauri ? tauriFetch : globalThis.fetch.bind(globalThis);
    return await f(input, { ...rest, signal: rest.signal ?? ctl.signal });
  } finally {
    clearTimeout(t);
  }
}

export async function httpJson<T = unknown>(input: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const r = await http(input, init);
  const text = await r.text();
  if (!r.ok) throw new Error(`HTTP ${r.status} from ${new URL(input).host}: ${text.slice(0, 300)}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Invalid JSON from ${new URL(input).host}: ${text.slice(0, 200)}`);
  }
}

export const BROWSER_UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36";
