import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("PostgreSQL migration command", () => {
  it("fails closed before connecting when DATABASE_URL is absent", () => {
    const environment = { ...process.env };
    delete environment["DATABASE_URL"];
    const result = spawnSync(
      process.execPath,
      ["--disable-warning=DEP0205", "--import", "tsx", "scripts/migrate-postgres.ts"],
      {
        cwd: resolve(import.meta.dirname, ".."),
        env: environment,
        encoding: "utf8",
      },
    );

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("DATABASE_URL is required for PostgreSQL migrations.");
    expect(result.stdout).toBe("");
  });
});
