import { describe, expect, it } from "vitest";

import { DomainError } from "@jobbbler/core-domain";

import { safeLogError } from "./logger";

describe("structured logging", () => {
  it("projects errors without messages, stacks, secrets, or request payloads", () => {
    const secret = "postgresql://person:password@example.test/private";
    const projected = safeLogError(new Error(secret));
    const domain = safeLogError(
      new DomainError({
        code: "DEPENDENCY",
        message: secret,
        retryable: true,
        details: { token: secret },
      }),
    );

    expect(projected).toEqual({ errorKind: "Error" });
    expect(domain).toEqual({
      errorKind: "DomainError",
      errorCode: "DEPENDENCY",
      retryable: true,
    });
    expect(JSON.stringify([projected, domain])).not.toContain(secret);
  });
});
