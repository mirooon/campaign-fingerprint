import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)) },
  },
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".cache/**", "dane/**"],
    testTimeout: 20_000,
    // Tests must never touch the network or the user's cache.
    env: { CACHE: "off", LLM_PROVIDER: "ollama" },
  },
});
