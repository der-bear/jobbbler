import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import nextConfig from "./next.config.js";

describe("Next standalone tracing", () => {
  it("does not generate repository instruction files during local preview", () => {
    expect(nextConfig.agentRules).toBe(false);
  });

  it("keeps the normal build output isolated from test-only overrides", () => {
    expect(nextConfig.distDir).toBe(process.env["NEXT_DIST_DIR"] ?? ".next");
  });

  it("includes SQLite migrations from the monorepo in every server trace", () => {
    expect(nextConfig.outputFileTracingRoot).toBe(
      fileURLToPath(new URL("../../", import.meta.url)),
    );
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/*": ["../../migrations/sqlite/*.sql", "../../migrations/postgres/*.sql"],
    });
  });
});
