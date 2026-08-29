import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary", "html"],
    },
    exclude: ["**/.next/**", "**/.worktrees/**", "**/dist/**", "**/node_modules/**"],
    passWithNoTests: true,
  },
});
