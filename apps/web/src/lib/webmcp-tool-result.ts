import { ZodError } from "zod";

import {
  webMcpSafeErrorReasonSchema,
  type ApiErrorCode,
  type WebMcpSafeErrorReason,
} from "@jobbbler/contracts";
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

export interface UserActionPresentation {
  readonly title: string;
  readonly prompt: string;
  readonly confirmLabel: string;
  readonly declineLabel?: string;
  readonly facts?: readonly ResultFact[];
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
    readonly reason?: WebMcpSafeErrorReason;
  };
}

export interface CancelledWebMcpResult {
  readonly [key: string]: unknown;
  readonly status: "cancelled";
  readonly summary: string;
}

export interface RequiresUserActionWebMcpResult {
  readonly [key: string]: unknown;
  readonly status: "requires_user_action";
  readonly summary: string;
  readonly requestId: string;
  readonly nextTool?: string;
  readonly userAction: {
    readonly kind:
      "agent_authorization" | "data_consent" | "action_confirmation" | "identity_verification";
    readonly surface:
      | "application_authorization"
      | "data_consent"
      | "application_review"
      | "identity_verification"
      | "search_alert_consent";
  };
  readonly decisionContext?: JsonValue;
  readonly presentation?: UserActionPresentation;
}

export type SafeWebMcpErrorResult = FailedWebMcpResult | CancelledWebMcpResult;

export function webMcpResultSize(value: unknown): number {
  const serialized = JSON.stringify(value);
  if (serialized === undefined) throw new Error("WebMCP tool results must be JSON-serializable.");
  return new TextEncoder().encode(serialized).byteLength;
}

function assertBounded<TValue>(value: TValue, maximumBytes = MAX_WEBMCP_RESULT_BYTES): TValue {
  if (webMcpResultSize(value) > maximumBytes) {
    throw new Error(
      `WebMCP tool results must not exceed ${maximumBytes.toLocaleString("en-US")} bytes.`,
    );
  }
  return value;
}

export function completedWebMcpResult<TData extends JsonValue>(
  options: Readonly<{
    summary: string;
    data: TData;
    resources?: readonly ResourceReference[];
    facts?: readonly ResultFact[];
    maximumBytes?: number;
  }>,
): CompletedWebMcpResult<TData> {
  const result: CompletedWebMcpResult<TData> = {
    status: "completed",
    summary: options.summary,
    data: options.data,
    ...(options.resources === undefined ? {} : { resources: options.resources }),
    ...(options.facts === undefined ? {} : { facts: options.facts }),
  };
  return assertBounded(result, options.maximumBytes);
}

export function requiresUserActionWebMcpResult(
  options: Readonly<{
    summary: string;
    kind: RequiresUserActionWebMcpResult["userAction"]["kind"];
    surface: RequiresUserActionWebMcpResult["userAction"]["surface"];
    requestId?: string;
    nextTool?: string;
    decisionContext?: JsonValue;
    presentation?: UserActionPresentation;
    maximumBytes?: number;
  }>,
): RequiresUserActionWebMcpResult {
  return assertBounded(
    {
      status: "requires_user_action",
      summary: options.summary,
      requestId: options.requestId ?? requestId(),
      ...(options.nextTool === undefined ? {} : { nextTool: options.nextTool }),
      userAction: { kind: options.kind, surface: options.surface },
      ...(options.decisionContext === undefined
        ? {}
        : { decisionContext: options.decisionContext }),
      ...(options.presentation === undefined ? {} : { presentation: options.presentation }),
    },
    options.maximumBytes,
  );
}

function requestId(): string {
  return `req_${crypto.randomUUID()}`;
}

export function failedWebMcpResult(options: {
  readonly code: ApiErrorCode;
  readonly message: string;
  readonly requestId?: string | null;
  readonly retryable: boolean;
  readonly reason?: WebMcpSafeErrorReason;
}): FailedWebMcpResult {
  return assertBounded({
    status: "failed",
    summary: options.message,
    error: {
      code: options.code,
      message: options.message,
      requestId: options.requestId ?? requestId(),
      retryable: options.retryable,
      ...(options.reason === undefined ? {} : { reason: options.reason }),
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
    const issues = error.issues
      .slice(0, 3)
      .map((issue) => {
        const path = issue.path.map(String).join(".");
        const message = issue.message.slice(0, 120);
        return path.length === 0 ? message : `${path}: ${message}`;
      })
      .join(" · ")
      .slice(0, 360);
    return failedWebMcpResult({
      code: "VALIDATION",
      message: issues.length === 0 ? validationMessage : `${validationMessage} ${issues}`,
      retryable: false,
    });
  }

  if (error instanceof ApiClientError) {
    const reason = webMcpSafeErrorReasonSchema.safeParse(error.details?.["reason"]);
    return failedWebMcpResult({
      code: error.code,
      message: error.message.slice(0, 500),
      requestId: error.requestId,
      retryable: error.retryable,
      ...(reason.success ? { reason: reason.data } : {}),
    });
  }

  return failedWebMcpResult({
    code: "INTERNAL",
    message: "The tool could not complete safely.",
    retryable: true,
  });
}
