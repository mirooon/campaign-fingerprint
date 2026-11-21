/**
 * Anthropic provider (Claude), used only when LLM_PROVIDER=anthropic and the task
 * rules allow external APIs. Follows the claude-api skill: model claude-opus-5-5,
 * effort set explicitly (default medium), structured output via messages.parse with
 * a zod output format, refusal handling and server-side fallbacks ("default").
 */
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import type { z } from "zod";
import { LlmError, type ChatMessage, type ChatOptions, type LlmProvider } from "./types";

export const DEFAULT_ANTHROPIC_MODEL = "claude-opus-5-5";
const FALLBACK_BETA = "server-side-fallback-2026-07-01";
type Effort = "low" | "medium" | "high" | "xhigh" | "max";

export interface AnthropicConfig {
  model?: string;
  effort?: Effort;
  timeoutMs?: number;
  client?: Anthropic;
}

function splitSystem(messages: ChatMessage[]): { system: string | undefined; rest: Anthropic.Beta.BetaMessageParam[] } {
  const system = messages
    .filter((m) => m.role === "system")
    .map((m) => m.content)
    .join("\n\n");
  const rest = messages
    .filter((m) => m.role !== "system")
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content }));
  return { system: system || undefined, rest };
}

function mapError(e: unknown): LlmError {
  if (e instanceof Anthropic.AuthenticationError) {
    return new LlmError("Anthropic: brak lub nieprawidłowy klucz API", "anthropic", "ustaw ANTHROPIC_API_KEY", e);
  }
  if (e instanceof Anthropic.PermissionDeniedError) {
    return new LlmError("Anthropic: brak uprawnień do modelu", "anthropic", "sprawdź ANTHROPIC_MODEL i uprawnienia klucza", e);
  }
  if (e instanceof Anthropic.NotFoundError) {
    return new LlmError("Anthropic: nie znaleziono modelu", "anthropic", "sprawdź ANTHROPIC_MODEL", e);
  }
  if (e instanceof Anthropic.RateLimitError) {
    return new LlmError("Anthropic: limit zapytań (429)", "anthropic", "spróbuj ponownie później", e);
  }
  if (e instanceof Anthropic.BadRequestError) {
    return new LlmError(`Anthropic: błędne zapytanie: ${e.message}`, "anthropic", undefined, e);
  }
  if (e instanceof Anthropic.APIConnectionTimeoutError) {
    return new LlmError("Anthropic: przekroczono limit czasu", "anthropic", "zwiększ LLM_TIMEOUT_MS", e);
  }
  if (e instanceof Anthropic.APIConnectionError) {
    return new LlmError("Anthropic: brak połączenia z API", "anthropic", "sprawdź sieć", e);
  }
  if (e instanceof Anthropic.APIError) {
    return new LlmError(`Anthropic: błąd API ${e.status ?? ""}: ${e.message}`, "anthropic", undefined, e);
  }
  return e instanceof LlmError ? e : new LlmError(`Anthropic: ${(e as Error)?.message ?? String(e)}`, "anthropic", undefined, e);
}

export class AnthropicProvider implements LlmProvider {
  readonly name = "anthropic" as const;
  readonly model: string;
  private effort: Effort;
  private client: Anthropic;

  constructor(cfg: AnthropicConfig = {}) {
    this.model = cfg.model ?? process.env.ANTHROPIC_MODEL ?? DEFAULT_ANTHROPIC_MODEL;
    this.effort = cfg.effort ?? (process.env.ANTHROPIC_EFFORT as Effort | undefined) ?? "medium";
    // Credentials resolve from the environment (ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN or an `ant auth login` profile).
    this.client =
      cfg.client ??
      new Anthropic({ timeout: cfg.timeoutMs ?? Number(process.env.LLM_TIMEOUT_MS || 180_000), maxRetries: 2 });
  }

  async chat(messages: ChatMessage[], opts: ChatOptions = {}): Promise<string> {
    const { system, rest } = splitSystem(messages);
    try {
      const response = await this.client.beta.messages.create(
        {
          model: opts.model ?? this.model,
          max_tokens: opts.maxTokens ?? 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: this.effort },
          ...(system ? { system } : {}),
          messages: rest,
        },
        opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
      );
      if (response.stop_reason === "refusal") {
        throw new LlmError(`Anthropic: model odmówił odpowiedzi (${response.stop_details?.category ?? "brak kategorii"})`, "anthropic");
      }
      return response.content
        .filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text")
        .map((b) => b.text)
        .join("");
    } catch (e) {
      throw mapError(e);
    }
  }

  async structured<T>(messages: ChatMessage[], schema: z.ZodType<T>, opts: ChatOptions = {}): Promise<T> {
    const { system, rest } = splitSystem(messages);
    try {
      const response = await this.client.beta.messages.parse(
        {
          model: opts.model ?? this.model,
          max_tokens: opts.maxTokens ?? 16000,
          betas: [FALLBACK_BETA],
          fallbacks: "default",
          output_config: { effort: this.effort, format: betaZodOutputFormat(schema) },
          ...(system ? { system } : {}),
          messages: rest,
        },
        opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined,
      );
      if (response.stop_reason === "refusal") {
        throw new LlmError(`Anthropic: model odmówił odpowiedzi (${response.stop_details?.category ?? "brak kategorii"})`, "anthropic");
      }
      if (response.parsed_output == null) {
        throw new LlmError(`Anthropic: brak poprawnego JSON w odpowiedzi (stop_reason=${response.stop_reason})`, "anthropic");
      }
      return response.parsed_output as T;
    } catch (e) {
      throw mapError(e);
    }
  }
}
