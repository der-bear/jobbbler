import { describe, expect, it } from "vitest";

import { toolExecutionResultSchema } from "./webmcp.js";

describe("toolExecutionResultSchema", () => {
  it("represents requestable authority without exposing a credential", () => {
    const result = toolExecutionResultSchema.parse({
      status: "requires_user_action",
      summary: "Approval is required to edit this application draft.",
      requestId: "apr_550e8400-e29b-41d4-a716-446655440000",
      userAction: {
        kind: "agent_authorization",
        surface: "application_authorization",
      },
    });

    expect(result.status).toBe("requires_user_action");
    expect(JSON.stringify(result)).not.toMatch(/token|secret|credential/i);
  });

  it("bounds model-visible summaries", () => {
    expect(() =>
      toolExecutionResultSchema.parse({
        status: "completed",
        summary: "x".repeat(1_501),
      }),
    ).toThrow();
  });

  it("rejects untyped model-visible data and error details", () => {
    expect(
      toolExecutionResultSchema.safeParse({
        status: "completed",
        summary: "Draft loaded.",
        data: { sessionToken: "secret" },
      }).success,
    ).toBe(false);

    expect(
      toolExecutionResultSchema.safeParse({
        status: "failed",
        summary: "The operation failed.",
        error: {
          code: "INTERNAL",
          message: "The operation failed.",
          requestId: "req_550e8400-e29b-41d4-a716-446655440000",
          retryable: false,
          details: { rawApplicationAnswer: "private" },
        },
      }).success,
    ).toBe(false);
  });

  it("accepts only the bounded safe reasons an agent can act on", () => {
    expect(
      toolExecutionResultSchema.parse({
        status: "failed",
        summary: "The mailbox code is incorrect.",
        error: {
          code: "VALIDATION",
          message: "The mailbox code is incorrect.",
          requestId: "req_550e8400-e29b-41d4-a716-446655440000",
          retryable: true,
          reason: "invalid_code",
        },
      }),
    ).toMatchObject({ error: { reason: "invalid_code" } });

    expect(
      toolExecutionResultSchema.safeParse({
        status: "failed",
        summary: "The operation failed.",
        error: {
          code: "INTERNAL",
          message: "The operation failed.",
          requestId: "req_550e8400-e29b-41d4-a716-446655440000",
          retryable: false,
          reason: "database_connection_string",
        },
      }).success,
    ).toBe(false);
  });
});
