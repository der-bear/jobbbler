import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
    },
    exclude: [
      "**/.next/**",
      "**/.worktrees/**",
      "**/dist/**",
      "**/node_modules/**",
      "**/tests/e2e/**",
    ],
    passWithNoTests: true,
  },
});
