import { describe, expect, it } from "vitest";

import { DomainError } from "@jobbbler/core-domain";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";

const requestId = "req_550e8400-e29b-41d4-a716-446655440000";

describe("API response envelope", () => {
  it("returns typed success data with request metadata and explicit cache policy", async () => {
    const response = apiSuccessResponse(
      { jobs: 3 },
      { requestId, cacheControl: "public, max-age=30", status: 200 },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("public, max-age=30");
    expect(response.headers.get("x-request-id")).toBe(requestId);
    await expect(response.json()).resolves.toEqual({
      ok: true,
      data: { jobs: 3 },
      meta: { requestId },
    });
  });

  it("maps safe domain errors without exposing causes or stack traces", async () => {
    const error = new DomainError({
      code: "NOT_FOUND",
      message: "Job was not found.",
      cause: new Error("secret database details"),
    });
    const response = apiErrorResponse(error, { requestId });
    const body = await response.text();

    expect(response.status).toBe(404);
    expect(body).toContain("Job was not found.");
    expect(body).not.toContain("secret database details");
    expect(body).not.toContain("stack");
  });

  it("keeps a branded NOT_FOUND response safe across a duplicated domain module", async () => {
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
    const response = apiErrorResponse(foreignError, { requestId });

    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "Job was not found.", retryable: false },
    });
  });

  it("returns generic internal errors and rate-limit retry headers", async () => {
    const internal = apiErrorResponse(new Error("SQLITE_SECRET"), { requestId });
    expect(internal.status).toBe(500);
    expect(await internal.json()).toMatchObject({
      ok: false,
      error: { code: "INTERNAL", message: "An unexpected error occurred.", retryable: true },
    });

    const limited = apiErrorResponse(
      new DomainError({
        code: "RATE_LIMITED",
        message: "Too many requests. Try again shortly.",
        retryable: true,
      }),
      { requestId, retryAfterSeconds: 12 },
    );
    expect(limited.status).toBe(429);
    expect(limited.headers.get("retry-after")).toBe("12");
  });
});
