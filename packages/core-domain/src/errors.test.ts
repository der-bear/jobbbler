import { describe, expect, it } from "vitest";

import { DomainError } from "./errors.js";

describe("DomainError", () => {
  it("exposes safe structured details without changing Error behavior", () => {
    const cause = new Error("database detail");
    const error = new DomainError({
      code: "CONFLICT",
      message: "The resource changed.",
      retryable: false,
      details: { expectedVersion: 2 },
      cause,
    });

    expect(error).toBeInstanceOf(Error);
    expect(error.cause).toBe(cause);
    expect(error.toSafeObject()).toEqual({
      code: "CONFLICT",
      message: "The resource changed.",
      retryable: false,
      details: { expectedVersion: 2 },
    });
  });
});
