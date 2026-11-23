/**
 * bun run llm:smoke — quick live check of the configured LLM provider:
 * lists Ollama models, runs chat, structured output and (Ollama) embeddings.
 */
import { z } from "zod";
import { getProvider, OllamaProvider } from "../lib/llm";
import { cosineDense } from "../lib/text/similarity";
import { main } from "./_cli";

void main(async () => {
  const provider = getProvider();
  console.log(`[smoke] provider: ${provider.name}, model: ${provider.model}`);
  const ollama = new OllamaProvider();
  if (provider.name === "ollama") {
    const models = await ollama.listModels();
    console.log(`[smoke] models in Ollama: ${models.length ? models.join(", ") : "(none, or Ollama is not running)"}`);
  }

  let t = Date.now();
  const reply = await provider.chat([{ role: "user", content: "Name the capital of Poland in one word." }], { maxTokens: 50 });
  console.log(`[smoke] chat (${Date.now() - t} ms): ${reply.trim().slice(0, 120)}`);

  t = Date.now();
  const schema = z.object({
    persona: z.string(),
    lure: z.string(),
    isScam: z.boolean(),
  });
  const obj = await provider.structured(
    [
      { role: "system", content: "You analyze ads. You answer in English." },
      { role: "user", content: "Ad: “Adam Testowy ujawnia: platforma KryptoZysk AI zarabia 4 800 zł dziennie. Zarejestruj się dziś!” Whom does the ad use, what is the lure and is it a scam?" },
    ],
    schema,
  );
  console.log(`[smoke] structured (${Date.now() - t} ms): ${JSON.stringify(obj)}`);

  try {
    t = Date.now();
    const [a, b, c] = await ollama.embed([
      "Adam Testowy zarabia 4800 zł dziennie na platformie krypto.",
      "Platforma kryptowalut przynosi Adamowi Testowemu 4800 zł dziennie.",
      "Rowery miejskie z darmową dostawą.",
    ]);
    console.log(`[smoke] embed ${ollama.embedModel} (${Date.now() - t} ms): dimension ${a.length}, cos(similar)=${cosineDense(a, b).toFixed(3)}, cos(different)=${cosineDense(a, c).toFixed(3)}`);
  } catch (e) {
    console.warn(`[smoke] embeddings unavailable: ${(e as Error).message}`);
  }
});
