import Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { AnthropicProvider } from "./anthropic";
import { getProvider, providerName } from "./index";
import { OllamaProvider, PLLUM_MODEL } from "./ollama";
import { LlmError } from "./types";

type Call = { url: string; body: Record<string, unknown>; headers: Headers };

function fakeFetch(responses: Array<{ status?: number; json: unknown }>, calls: Call[]): typeof fetch {
  let i = 0;
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : {}, headers: new Headers(init?.headers) });
    const r = responses[Math.min(i++, responses.length - 1)];
    return new Response(JSON.stringify(r.json), { status: r.status ?? 200, headers: { "content-type": "application/json" } });
  }) as typeof fetch;
}

const Summary = z.object({ persona: z.string(), lure: z.string() });

describe("OllamaProvider", () => {
  it("defaults to the PLLuM tag and sends chat requests", async () => {
    const calls: Call[] = [];
    const p = new OllamaProvider({ host: "http://ollama.test:11434", fetchImpl: fakeFetch([{ json: { message: { role: "assistant", content: "Cześć" } } }], calls) });
    expect(p.model).toBe(PLLUM_MODEL);
    expect(await p.chat([{ role: "user", content: "hej" }])).toBe("Cześć");
    expect(calls[0].url).toBe("http://ollama.test:11434/api/chat");
    expect(calls[0].body).toMatchObject({ model: PLLUM_MODEL, stream: false });
  });

  it("structured() passes a JSON schema as `format`, validates, and retries once on bad output", async () => {
    const calls: Call[] = [];
    const p = new OllamaProvider({
      host: "http://o.test",
      fetchImpl: fakeFetch(
        [
          { json: { message: { content: '{"persona": 1}' } } },
          { json: { message: { content: '{"persona": "Adam Testowy", "lure": "krypto"}' } } },
        ],
        calls,
      ),
    });
    const out = await p.structured([{ role: "user", content: "x" }], Summary);
    expect(out).toEqual({ persona: "Adam Testowy", lure: "krypto" });
    expect(calls).toHaveLength(2);
    const format = calls[0].body.format as Record<string, unknown>;
    expect(format.type).toBe("object");
    expect(Object.keys(format.properties as object)).toEqual(["persona", "lure"]);
  });

  it("gives actionable errors for missing models and a stopped server", async () => {
    const missing = new OllamaProvider({ host: "http://o.test", model: "nope:1b", fetchImpl: fakeFetch([{ status: 404, json: { error: "model 'nope:1b' not found" } }], []) });
    await expect(missing.chat([{ role: "user", content: "x" }])).rejects.toThrow(/ollama pull nope:1b/);

    const down = new OllamaProvider({
      host: "http://127.0.0.1:9",
      fetchImpl: (async () => {
        throw new TypeError("fetch failed");
      }) as typeof fetch,
    });
    await expect(down.chat([{ role: "user", content: "x" }])).rejects.toBeInstanceOf(LlmError);
  });

  it("embeds in batches via /api/embed", async () => {
    const calls: Call[] = [];
    const p = new OllamaProvider({
      host: "http://o.test",
      fetchImpl: fakeFetch([{ json: { embeddings: [[1, 0], [0, 1]] } }, { json: { embeddings: [[1, 1]] } }], calls),
    });
    const v = await p.embed(["a", "b", "c"], { batchSize: 2 });
    expect(v).toEqual([[1, 0], [0, 1], [1, 1]]);
    expect(calls.map((c) => c.url)).toEqual(["http://o.test/api/embed", "http://o.test/api/embed"]);
    expect(calls[0].body).toMatchObject({ model: "bge-m3", input: ["a", "b"] });
  });
});

describe("AnthropicProvider (SDK with injected fetch, no network)", () => {
  const message = (text: string) => ({
    id: "msg_test",
    type: "message",
    role: "assistant",
    model: "claude-opus-5-5",
    content: [{ type: "text", text }],
    stop_reason: "end_turn",
    stop_sequence: null,
    usage: { input_tokens: 10, output_tokens: 5 },
  });

  it("structured() uses claude-opus-5-5, an output format and server-side fallbacks", async () => {
    const calls: Call[] = [];
    const client = new Anthropic({ apiKey: "test-key", fetch: fakeFetch([{ json: message('{"persona":"Ewa Przykładowa","lure":"energia"}') }], calls), maxRetries: 0 });
    const p = new AnthropicProvider({ client });
    const out = await p.structured([{ role: "system", content: "sys" }, { role: "user", content: "x" }], Summary);
    expect(out).toEqual({ persona: "Ewa Przykładowa", lure: "energia" });
    expect(calls[0].body).toMatchObject({ model: "claude-opus-5-5", fallbacks: "default", system: "sys" });
    const oc = calls[0].body.output_config as { effort: string; format: { type: string } };
    expect(oc.effort).toBe("medium");
    expect(oc.format.type).toBe("json_schema");
    expect(calls[0].headers.get("anthropic-beta")).toContain("server-side-fallback-2026-07-01");
  });

  it("maps refusals and auth errors to LlmError", async () => {
    const refusal = { ...message(""), stop_reason: "refusal", stop_details: { type: "refusal", category: "cyber", explanation: null } };
    const client = new Anthropic({ apiKey: "k", fetch: fakeFetch([{ json: refusal }], []), maxRetries: 0 });
    await expect(new AnthropicProvider({ client }).chat([{ role: "user", content: "x" }])).rejects.toThrow(/refused/);

    const authClient = new Anthropic({
      apiKey: "bad",
      fetch: fakeFetch([{ status: 401, json: { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } } }], []),
      maxRetries: 0,
    });
    await expect(new AnthropicProvider({ client: authClient }).chat([{ role: "user", content: "x" }])).rejects.toThrow(/ANTHROPIC_API_KEY/);
  });
});

describe("provider selection", () => {
  it("reads LLM_PROVIDER", () => {
    const prev = process.env.LLM_PROVIDER;
    process.env.LLM_PROVIDER = "ollama";
    expect(providerName()).toBe("ollama");
    expect(getProvider().name).toBe("ollama");
    process.env.LLM_PROVIDER = "gpt";
    expect(() => providerName()).toThrow(/LLM_PROVIDER/);
    process.env.LLM_PROVIDER = prev;
  });
});
