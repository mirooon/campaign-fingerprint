/**
 * Ollama provider (local, offline): /api/chat for chat and structured output
 * (`format` = JSON schema generated from the zod schema), /api/embed for embeddings.
 */
import { z } from "zod";
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider } from "./types";

export const PLLUM_MODEL = "hf.co/mradermacher/PLLuM-12B-instruct-2512-GGUF:Q5_K_M";
export const BIELIK_MODEL = "SpeakLeash/bielik-11b-v3.0-instruct:Q5_K_M";
export const DEFAULT_EMBED_MODEL = "bge-m3";

export interface OllamaConfig {
  host?: string;
  model?: string;
  embedModel?: string;
  timeoutMs?: number;
  /** For tests. */
  fetchImpl?: typeof fetch;
}

interface OllamaChatResponse {
  message?: { role: string; content: string };
  error?: string;
}

interface OllamaEmbedResponse {
  embeddings?: number[][];
  error?: string;
}

export function ollamaHost(): string {
  return (process.env.OLLAMA_HOST || "http://localhost:11434").replace(/\/+$/, "");
}

export class OllamaProvider implements LlmProvider {
  readonly name = "ollama" as const;
  readonly model: string;
  readonly embedModel: string;
  private host: string;
  private timeoutMs: number;
  private fetchImpl: typeof fetch;

  constructor(cfg: OllamaConfig = {}) {
    this.host = (cfg.host ?? ollamaHost()).replace(/\/+$/, "");
    this.model = cfg.model ?? process.env.OLLAMA_MODEL ?? PLLUM_MODEL;
    this.embedModel = cfg.embedModel ?? process.env.OLLAMA_EMBED_MODEL ?? DEFAULT_EMBED_MODEL;
    this.timeoutMs = cfg.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 180_000);
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private async post<T extends { error?: string }>(endpoint: string, body: unknown, timeoutMs: number, model: string): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.host}${endpoint}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      const name = (e as Error)?.name;
      if (name === "TimeoutError" || name === "AbortError") {
        throw new LlmError(`Ollama: timed out after ${timeoutMs} ms (${endpoint})`, "ollama", "raise LLM_TIMEOUT_MS or use a smaller model", e);
      }
      throw new LlmError(`Ollama does not respond at ${this.host}`, "ollama", "run `brew services start ollama` or `ollama serve`, or set OLLAMA_HOST", e);
    }
    const text = await res.text();
    let json: T;
    try {
      json = JSON.parse(text) as T;
    } catch {
      throw new LlmError(`Ollama: invalid answer HTTP ${res.status}: ${text.slice(0, 200)}`, "ollama");
    }
    if (!res.ok || json.error) {
      const msg = json.error ?? `HTTP ${res.status}`;
      if (res.status === 404 || /not found/i.test(msg)) {
        throw new LlmError(`Ollama: model "${model}" is not available (${msg})`, "ollama", `pull it: ollama pull ${model}`);
      }
      throw new LlmError(`Ollama: ${msg}`, "ollama");
    }
    return json;
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const model = opts.model ?? this.model;
    const res = await this.post<OllamaChatResponse>(
      "/api/chat",
      {
        model,
        messages,
        stream: false,
        options: { temperature: opts.temperature ?? 0.2, ...(opts.maxTokens ? { num_predict: opts.maxTokens } : {}) },
      },
      opts.timeoutMs ?? this.timeoutMs,
      model,
    );
    return res.message?.content ?? "";
  }

  async structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: ChatOptions = {}): Promise<T> {
    const model = opts.model ?? this.model;
    const jsonSchema = z.toJSONSchema(schema) as Record<string, unknown>;
    delete jsonSchema.$schema;
    const schemaHint: ChatMessage = {
      role: "system",
      content: `Respond only with valid JSON that matches this schema:\n${JSON.stringify(jsonSchema)}`,
    };
    let lastError = "";
    for (let attempt = 0; attempt < 2; attempt++) {
      const convo: ChatMessage[] = [schemaHint, ...messages];
      if (lastError) convo.push({ role: "user", content: `The previous answer was invalid (${lastError}). Return valid JSON.` });
      const res = await this.post<OllamaChatResponse>(
        "/api/chat",
        { model, messages: convo, stream: false, format: jsonSchema, options: { temperature: opts.temperature ?? 0 } },
        opts.timeoutMs ?? this.timeoutMs,
        model,
      );
      const content = res.message?.content ?? "";
      try {
        const parsed = schema.safeParse(JSON.parse(content));
        if (parsed.success) return parsed.data;
        lastError = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ").slice(0, 300);
      } catch {
        lastError = "not JSON";
      }
    }
    throw new LlmError(`Ollama: the answer of model ${model} does not match the schema (${lastError})`, "ollama");
  }

  /** Embeddings via /api/embed (bge-m3 by default), batched. */
  async embed(texts: string[], opts: { model?: string; batchSize?: number; timeoutMs?: number } = {}): Promise<number[][]> {
    const model = opts.model ?? this.embedModel;
    const out: number[][] = [];
    const batch = opts.batchSize ?? 32;
    for (let i = 0; i < texts.length; i += batch) {
      const chunk = texts.slice(i, i + batch);
      const res = await this.post<OllamaEmbedResponse>(
        "/api/embed",
        { model, input: chunk, truncate: true },
        opts.timeoutMs ?? 120_000,
        model,
      );
      if (!res.embeddings || res.embeddings.length !== chunk.length) {
        throw new LlmError(`Ollama: /api/embed returned ${res.embeddings?.length ?? 0} vectors instead of ${chunk.length}`, "ollama");
      }
      out.push(...res.embeddings);
    }
    return out;
  }

  /** Names of locally available models (GET /api/tags). */
  async listModels(): Promise<string[]> {
    try {
      const res = await this.fetchImpl(`${this.host}/api/tags`, { signal: AbortSignal.timeout(5_000) });
      const json = (await res.json()) as { models?: Array<{ name: string }> };
      return (json.models ?? []).map((m) => m.name);
    } catch {
      return [];
    }
  }
}
