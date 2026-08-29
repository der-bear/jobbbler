import { describe, expect, it } from "vitest";

import { apiErrorSchema, apiResponseSchema } from "./api.js";

describe("API envelopes", () => {
  it("parses a stable typed error", () => {
    const parsed = apiErrorSchema.parse({
      code: "CONFLICT",
      message: "The draft changed after review.",
      requestId: "req_550e8400-e29b-41d4-a716-446655440000",
      retryable: false,
      details: { expectedVersion: 4, actualVersion: 5 },
    });

    expect(parsed.code).toBe("CONFLICT");
    expect(parsed.details).toEqual({ expectedVersion: 4, actualVersion: 5 });
  });

  it("keeps success and failure responses mutually exclusive", () => {
    const schema = apiResponseSchema(apiErrorSchema);

    expect(
      schema.safeParse({
        ok: true,
        data: {
          code: "INTERNAL",
          message: "not data",
          requestId: "req_550e8400-e29b-41d4-a716-446655440000",
          retryable: false,
        },
      }).success,
    ).toBe(true);

    expect(
      schema.safeParse({
        ok: false,
        error: {
          code: "FORBIDDEN",
          message: "Agent delegation is missing.",
          requestId: "req_550e8400-e29b-41d4-a716-446655440000",
          retryable: false,
        },
        data: {},
      }).success,
    ).toBe(false);
  });
});
