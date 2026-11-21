import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  // Self-contained server bundle for the Docker image.
  output: "standalone",
  // The viewer and API routes read pipeline outputs and the sample dataset from data/.
  outputFileTracingIncludes: {
    "/": ["./data/graph.json", "./data/campaigns.json", "./data/summaries.json"],
    "/api/analyze": ["./data/*.json", "./data/sample/**/*"],
    "/api/image": ["./data/*.json", "./data/sample/images/**/*"],
  },
  // sharp is a native dependency: keep it out of the server bundle.
  serverExternalPackages: ["sharp"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
