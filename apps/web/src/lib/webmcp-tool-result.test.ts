import { describe, expect, it } from "vitest";

import { toolExecutionResultSchemaFor } from "@jobbbler/contracts";
import { z } from "zod";

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
});
