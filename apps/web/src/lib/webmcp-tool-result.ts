import { ZodError } from "zod";

import type { ApiErrorCode } from "@jobbbler/contracts";
import type { JsonValue } from "@jobbbler/webmcp";
import { ApiClientError } from "./query-client";

export const MAX_WEBMCP_RESULT_BYTES = 1_500;

interface ResourceReference {
  readonly type: string;
  readonly id: string;
  readonly label: string;
}

interface ResultFact {
  readonly key: string;
  readonly value: boolean | number | string | null;
}

export interface CompletedWebMcpResult<TData extends JsonValue> {
  readonly [key: string]: unknown;
  readonly status: "completed";
  readonly summary: string;
  readonly data: TData;
  readonly resources?: readonly ResourceReference[];
  readonly facts?: readonly ResultFact[];
}

export interface FailedWebMcpResult {
  readonly [key: string]: unknown;
  readonly status: "failed";
  readonly summary: string;
  readonly error: {
    readonly code: ApiErrorCode;
    readonly message: string;
    readonly requestId: string;
    readonly retryable: boolean;
  };
}

export interface CancelledWebMcpResult {
  readonly [key: string]: unknown;
  readonly status: "cancelled";
  readonly summary: string;
}

export type SafeWebMcpErrorResult = FailedWebMcpResult | CancelledWebMcpResult;

export function webMcpResultSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("WebMCP tool results must be JSON-serializable.");
  return new TextEncoder().encode(serialized).byteLength;
}

function assertBounded<TValue>(value: TValue): TValue {
  if (webMcpResultSize(value) > MAX_WEBMCP_RESULT_BYTES) {
    throw new Error("WebMCP tool results must not exceed 1,500 bytes.");
  }
  return value;
}

export function completedWebMcpResult<TData extends JsonValue>(
  options: Readonly<{
    summary: string;
    data: TData;
    resources?: readonly ResourceReference[];
    facts?: readonly ResultFact[];
  }>,
): CompletedWebMcpResult<TData> {
  const result: CompletedWebMcpResult<TData> = {
    status: "completed",
    summary: options.summary,
    data: options.data,
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    ...(options.facts === undefined ? {} : { facts: options.facts }),
  };
  return assertBounded(result);
}

function requestId(): string {
  return `req_${crypto.randomUUID()}`;
}

function failedResult(options: {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId?: string | null;
  readonly retryable: boolean;
}): FailedWebMcpResult {
  return assertBounded({
    status: "failed",
    summary: options.message,
    error: {
      code: options.code,
      message: options.message,
      requestId: options.requestId ?? requestId(),
      retryable: options.retryable,
    },
  } satisfies FailedWebMcpResult);
}

export function safeWebMcpErrorResult(
  error: unknown,
  signal: AbortSignal,
  validationMessage: string,
): SafeWebMcpErrorResult {
  if (signal.aborted || (error instanceof DOMException && error.name === "AbortError")) {
    return { status: "cancelled", summary: "The tool call was cancelled." };
  }

  if (error instanceof ZodError) {
    return failedResult({
      code: "VALIDATION",
      message: validationMessage,
      retryable: false,
    });
  }

  if (error instanceof ApiClientError) {
    return failedResult({
      code: error.code,
      message: error.message.slice(0, 500),
      requestId: error.requestId,
      retryable: error.retryable,
    });
  }

  return failedResult({
    code: "INTERNAL",
    message: "The tool could not complete safely.",
    retryable: true,
  });
}
