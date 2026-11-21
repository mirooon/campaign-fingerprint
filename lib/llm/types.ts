import type { z } from "zod";

export type LlmProviderName = "ollama" | "anthropic";

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ChatOptions {
  /** Override the configured model id/tag. */
  model?: string;
  temperature?: number;
  timeoutMs?: number;
  maxTokens?: number;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  chat(messages: ChatMessage[], opts?: ChatOptions): Promise<string>;
  /** Returns an object validated against the zod schema. */
  structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts?: ChatOptions): Promise<T>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    readonly provider: LlmProviderName,
    readonly hint?: string,
    readonly cause?: unknown,
  ) {
    super(hint ? `${message} — ${hint}` : message);
    this.name = "LlmError";
  }
}
