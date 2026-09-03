import { describe, expect, it } from "vitest";

import { toolExecutionResultSchemaFor } from "@jobbbler/contracts";
import { z } from "zod";

import { DomainError } from "@jobbbler/core-domain";

import { ApiClientError } from "./query-client";

import {
  MAX_WEBMCP_RESULT_BYTES,
  completedWebMcpResult,
  safeWebMcpErrorResult,
  webMcpResultSize,
} from "./webmcp-tool-result";

describe("WebMCP tool results", () => {
  it("creates a contract-valid, bounded completed envelope", () => {
    const result = completedWebMcpResult({
      summary: "Found one matching technology role.",
      data: { total: 1, jobIds: ["job_00000001-0000-7000-8000-000000000001"] },
      facts: [{ key: "total", value: 1 }],
    });

    expect(toolExecutionResultSchemaFor(z.unknown()).parse(result)).toEqual(result);
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("rejects a result that exceeds the WebMCP output budget", () => {
    expect(() =>
      completedWebMcpResult({
        summary: "Oversized result.",
        data: { text: "x".repeat(MAX_WEBMCP_RESULT_BYTES) },
      }),
    ).toThrow(/1,500 bytes/i);
  });

  it("returns safe validation and cancellation envelopes without leaking errors", () => {
    const validation = safeWebMcpErrorResult(
      new z.ZodError([]),
      new AbortController().signal,
      "The search criteria are invalid.",
    );
    expect(validation).toMatchObject({
      status: "failed",
      error: { code: "VALIDATION", retryable: false },
    });

    const controller = new AbortController();
    controller.abort();
    const cancelled = safeWebMcpErrorResult(
      new Error("private connector failure"),
      controller.signal,
      "The comparison input is invalid.",
    );
    expect(cancelled).toEqual({ status: "cancelled", summary: "The tool call was cancelled." });
    expect(JSON.stringify(validation)).not.toContain("private connector failure");
  });

  it("forwards only an allow-listed reason from API error details", () => {
    const invalidCode = safeWebMcpErrorResult(
      new ApiClientError({
        code: "VALIDATION",
        message: "The mailbox code is incorrect.",
        retryable: true,
        details: { reason: "invalid_code", attemptedCode: "123456" },
      }),
      new AbortController().signal,
      "The decision is invalid.",
    );
    expect(invalidCode).toMatchObject({
      status: "failed",
      error: { reason: "invalid_code", retryable: true },
    });
    expect(JSON.stringify(invalidCode)).not.toContain("123456");

    const privateReason = safeWebMcpErrorResult(
      new ApiClientError({
        code: "INTERNAL",
        message: "The operation failed.",
        retryable: false,
        details: { reason: "database_connection_string", secret: "private" },
      }),
      new AbortController().signal,
      "The decision is invalid.",
    );
    expect(privateReason).toMatchObject({ status: "failed", error: { code: "INTERNAL" } });
    expect(JSON.stringify(privateReason)).not.toContain("reason");
    expect(JSON.stringify(privateReason)).not.toContain("private");
  });
});

describe("safeWebMcpErrorResult with domain rules", () => {
  it("passes a domain rule's own message through instead of the generic failure", () => {
    const error = new DomainError({
      code: "VALIDATION",
      message:
        "remoteOrLocations requires at least one city, country, or region; use workModels=['remote'] for remote-only searches.",
    });

    const result = safeWebMcpErrorResult(
      error,
      new AbortController().signal,
      "Criteria are invalid.",
    );

    expect(result).toMatchObject({
      status: "failed",
      error: {
        code: "VALIDATION",
        retryable: false,
        message: expect.stringContaining("remoteOrLocations requires at least one city"),
      },
    });
  });
});
