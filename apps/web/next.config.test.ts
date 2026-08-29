import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import nextConfig from "./next.config.js";

describe("Next standalone tracing", () => {
  it("includes SQLite migrations from the monorepo in every server trace", () => {
    expect(nextConfig.outputFileTracingRoot).toBe(
      fileURLToPath(new URL("../../", import.meta.url)),
    );
    expect(nextConfig.outputFileTracingIncludes).toEqual({
      "/*": ["../../migrations/sqlite/*.sql", "../../migrations/postgres/*.sql"],
    });
  });
});
