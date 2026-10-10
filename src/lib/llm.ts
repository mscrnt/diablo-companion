// OpenAI-compatible client for the local vLLM server (Qwen3.5-35B-A3B, vision).
import { httpJson } from "./http";

export type ChatContent =
  | string
  | ({ type: "text"; text: string } | { type: "image_url"; image_url: { url: string } })[];

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: ChatContent;
}

export interface LlmConfig {
  baseUrl: string; // e.g. http://192.168.69.197:8556/v1
  model: string;
  apiKey?: string;
}

export interface ChatOptions {
  maxTokens?: number;
  temperature?: number;
  /** Qwen3 thinking mode — off for fast structured answers */
  thinking?: boolean;
  jsonSchema?: { name: string; schema: object };
  signal?: AbortSignal;
  timeoutMs?: number;
}

function headers(cfg: LlmConfig) {
  const h: Record<string, string> = { "Content-Type": "application/json" };
  if (cfg.apiKey) h.Authorization = `Bearer ${cfg.apiKey}`;
  return h;
}

export async function listModels(cfg: LlmConfig): Promise<string[]> {
  const r = await httpJson<any>(cfg.baseUrl.replace(/\/$/, "") + "/models", { headers: headers(cfg), timeoutMs: 8000 });
  return (r.data ?? []).map((m: any) => m.id);
}

export async function chat(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
  const body: any = {
    model: cfg.model,
    messages,
    max_tokens: opts.maxTokens ?? 1500,
    temperature: opts.temperature ?? 0.2,
    chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
  };
  if (opts.jsonSchema) {
    body.response_format = {
      type: "json_schema",
      json_schema: { name: opts.jsonSchema.name, schema: opts.jsonSchema.schema, strict: true },
    };
  }
  const r = await httpJson<any>(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: headers(cfg),
    body: JSON.stringify(body),
    signal: opts.signal,
    timeoutMs: opts.timeoutMs ?? 120000,
  });
  const msg = r.choices?.[0]?.message;
  return (msg?.content ?? "").trim();
}

export async function chatJson<T>(cfg: LlmConfig, messages: ChatMessage[], opts: ChatOptions & { jsonSchema: { name: string; schema: object } }): Promise<T> {
  const text = await chat(cfg, messages, { temperature: 0, ...opts });
  return parseJsonLoose<T>(text);
}

/** Streams tokens (SSE) — used by the coach chat. Uses window.fetch since the vLLM server allows CORS. */
export async function chatStream(
  cfg: LlmConfig,
  messages: ChatMessage[],
  onToken: (t: string, kind: "content" | "reasoning") => void,
  opts: ChatOptions = {},
): Promise<string> {
  const res = await fetch(cfg.baseUrl.replace(/\/$/, "") + "/chat/completions", {
    method: "POST",
    headers: headers(cfg),
    signal: opts.signal,
    body: JSON.stringify({
      model: cfg.model,
      messages,
      stream: true,
      max_tokens: opts.maxTokens ?? 2500,
      temperature: opts.temperature ?? 0.6,
      chat_template_kwargs: { enable_thinking: opts.thinking ?? false },
    }),
  });
  if (!res.ok || !res.body) throw new Error(`LLM HTTP ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = "";
  let full = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += dec.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim();
      buf = buf.slice(i + 1);
      if (!line.startsWith("data:")) continue;
      const data = line.slice(5).trim();
      if (data === "[DONE]") return full;
      try {
        const d = JSON.parse(data).choices?.[0]?.delta ?? {};
        if (d.reasoning_content || d.reasoning) onToken(d.reasoning_content ?? d.reasoning, "reasoning");
        if (d.content) {
          full += d.content;
          onToken(d.content, "content");
        }
      } catch {
        /* partial line */
      }
    }
  }
  return full;
}

export function parseJsonLoose<T>(text: string): T {
  const t = text.replace(/^```(?:json)?/m, "").replace(/```\s*$/m, "").trim();
  try {
    return JSON.parse(t);
  } catch {
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a >= 0 && b > a) return JSON.parse(t.slice(a, b + 1));
    throw new Error("LLM did not return JSON: " + t.slice(0, 200));
  }
}

export const imagePart = (b64: string, mime = "image/jpeg") => ({
  type: "image_url" as const,
  image_url: { url: b64.startsWith("data:") ? b64 : `data:${mime};base64,${b64}` },
});
