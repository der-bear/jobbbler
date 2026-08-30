import { describe, expect, it } from "vitest";

import { DomainError, isDomainError } from "./errors.js";

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

  it("recognizes the same branded domain error across duplicated module instances", () => {
    const foreignError = Object.assign(new Error("Job was not found."), {
      name: "DomainError",
      code: "NOT_FOUND" as const,
      retryable: false,
      details: undefined,
      [Symbol.for("@jobbbler/core-domain/DomainError")]: true,
      toSafeObject: () => ({
        code: "NOT_FOUND" as const,
        message: "Job was not found.",
        retryable: false,
      }),
    });

    expect(foreignError).not.toBeInstanceOf(DomainError);
    expect(isDomainError(foreignError)).toBe(true);
  });

  it("recognizes a strict legacy error shape left alive across a development reload", () => {
    const legacyError = Object.assign(new Error("Job was not found."), {
      name: "DomainError",
      code: "NOT_FOUND" as const,
      retryable: false,
      details: undefined,
      toSafeObject: () => ({
        code: "NOT_FOUND" as const,
        message: "Job was not found.",
        retryable: false,
      }),
    });

    expect(legacyError).not.toBeInstanceOf(DomainError);
    expect(isDomainError(legacyError)).toBe(true);
  });
});
