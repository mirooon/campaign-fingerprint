import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // local Python venvs (setup-speaker.sh, setup-face.sh) carry JavaScript of their packages
    ".venv*/**",
    // evaluator material and bases (./dane, gitignored): captured pages carry foreign JS, HLS segments end in .ts
    "dane/**",
  ]),
]);

export default eslintConfig;
