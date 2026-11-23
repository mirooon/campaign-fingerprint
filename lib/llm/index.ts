/**
 * Provider selection: LLM_PROVIDER=ollama (default, local PLLuM; Bielik as the
 * alternative via OLLAMA_MODEL) or LLM_PROVIDER=anthropic.
 * Embeddings always come from Ollama (bge-m3); Anthropic has no embeddings endpoint.
 */
import type { z } from "zod";
import { AnthropicProvider } from "./anthropic";
import { OllamaProvider } from "./ollama";
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider, type LlmProviderName } from "./types";

export { BIELIK_MODEL, DEFAULT_EMBED_MODEL, OllamaProvider, PLLUM_MODEL } from "./ollama";
export { AnthropicProvider, DEFAULT_ANTHROPIC_MODEL } from "./anthropic";
export { LlmError } from "./types";
export type { ChatMessage, ChatOptions, LlmProvider, LlmProviderName } from "./types";

export function providerName(): LlmProviderName {
  const v = (process.env.LLM_PROVIDER || "ollama").toLowerCase();
  if (v !== "ollama" && v !== "anthropic") {
    throw new LlmError(`Unknown LLM_PROVIDER="${v}"`, "ollama", "allowed: ollama | anthropic");
  }
  return v;
}

let cached: LlmProvider | null = null;

export function getProvider(name: LlmProviderName = providerName()): LlmProvider {
  if (cached && cached.name === name) return cached;
  cached = name === "anthropic" ? new AnthropicProvider() : new OllamaProvider();
  return cached;
}

export function chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string> {
  return getProvider().chat(messages, opts);
}

export function structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts?: ChatOptions): Promise<T> {
  return getProvider().structured(messages, schema, opts);
}

let embedder: OllamaProvider | null = null;

export function embed(texts: string[], opts?: { model?: string; batchSize?: number; timeoutMs?: number }): Promise<number[][]> {
  embedder ??= new OllamaProvider();
  return embedder.embed(texts, opts);
}
