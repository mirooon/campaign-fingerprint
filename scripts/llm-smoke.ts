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
  console.log(`[smoke] dostawca: ${provider.name}, model: ${provider.model}`);
  const ollama = new OllamaProvider();
  if (provider.name === "ollama") {
    const models = await ollama.listModels();
    console.log(`[smoke] modele w Ollama: ${models.length ? models.join(", ") : "(brak lub Ollama nie działa)"}`);
  }

  let t = Date.now();
  const reply = await provider.chat([{ role: "user", content: "Podaj jednym słowem stolicę Polski." }], { maxTokens: 50 });
  console.log(`[smoke] chat (${Date.now() - t} ms): ${reply.trim().slice(0, 120)}`);

  t = Date.now();
  const schema = z.object({
    persona: z.string(),
    lure: z.string(),
    isScam: z.boolean(),
  });
  const obj = await provider.structured(
    [
      { role: "system", content: "Analizujesz reklamy. Odpowiadasz po polsku." },
      { role: "user", content: "Reklama: „Adam Testowy ujawnia: platforma KryptoZysk AI zarabia 4 800 zł dziennie. Zarejestruj się dziś!” Kogo wykorzystuje reklama, jaka jest przynęta i czy to oszustwo?" },
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
    console.log(`[smoke] embed ${ollama.embedModel} (${Date.now() - t} ms): wymiar ${a.length}, cos(podobne)=${cosineDense(a, b).toFixed(3)}, cos(różne)=${cosineDense(a, c).toFixed(3)}`);
  } catch (e) {
    console.warn(`[smoke] embeddingi niedostępne: ${(e as Error).message}`);
  }
});
