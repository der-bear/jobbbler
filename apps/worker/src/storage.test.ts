import { describe, expect, it } from "vitest";

import { createConfiguredWorkerStorage } from "./storage.js";

describe("worker storage configuration", () => {
  it("selects PostgreSQL from the server-only database URL", async () => {
    const configured = createConfiguredWorkerStorage({
      DATABASE_URL: "postgres://jobbbler:secret@localhost:5432/jobbbler",
    });

    expect(configured.driver).toBe("postgres");
    expect(configured.databasePath).toBeNull();
    expect(configured.storage).toHaveProperty("sql");
    await configured.storage.close();
  });

  it("fails closed when the production worker is not bound to PostgreSQL", () => {
    expect(() => createConfiguredWorkerStorage({ NODE_ENV: "production" })).toThrow("PostgreSQL");
  });
});
