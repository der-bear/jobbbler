import { describe, expect, it } from "vitest";

import { createEntityId, isEntityId } from "./ids.js";

describe("entity IDs", () => {
  it("creates portable prefixed IDs with an injected UUID source", () => {
    const id = createEntityId("job", () => "550e8400-e29b-41d4-a716-446655440000");

    expect(id).toBe("job_550e8400-e29b-41d4-a716-446655440000");
    expect(isEntityId(id, "job")).toBe(true);
    expect(isEntityId(id, "org")).toBe(false);
  });

  it("rejects unsafe prefixes", () => {
    expect(() => createEntityId("Job Draft")).toThrow(/prefix/i);
  });
});
