import { ZodError } from "zod";

import type { ApiErrorCode, ApiResponse } from "@jobbbler/contracts";
import { DomainError, isDomainError } from "@jobbbler/core-domain";
import { logger, requestLog, safeLogError } from "./logger";

export interface ApiResponseOptions {
  readonly requestId: string;
  readonly status?: number;
  readonly cacheControl?: string;
  readonly retryAfterSeconds?: number;
  readonly headers?: HeadersInit;
}

const statusByCode: Readonly<Record<ApiErrorCode, number>> = {
  VALIDATION: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  DEPENDENCY: 502,
  CANCELLED: 408,
  INTERNAL: 500,
};

function responseHeaders(options: ApiResponseOptions, cacheControl: string): Headers {
  const headers = new Headers(options.headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", cacheControl);
  headers.set("x-content-type-options", "nosniff");
  headers.set("x-request-id", options.requestId);
  if (options.retryAfterSeconds !== undefined) {
    headers.set("retry-after", String(Math.max(1, Math.ceil(options.retryAfterSeconds))));
  }
  return headers;
}

export function apiSuccessResponse<T>(data: T, options: ApiResponseOptions): Response {
  const body: ApiResponse<T> = {
    ok: true,
    data,
    meta: { requestId: options.requestId },
  };
  return new Response(JSON.stringify(body), {
    status: options.status ?? 200,
    headers: responseHeaders(options, options.cacheControl ?? "no-store"),
  });
}

function safeError(error: unknown): DomainError {
  if (isDomainError(error)) return error;
  if (error instanceof ZodError) {
    return new DomainError({
      code: "VALIDATION",
      message: "The request contains invalid or unsupported values.",
    });
  }
  return new DomainError({
    code: "INTERNAL",
    message: "An unexpected error occurred.",
    retryable: true,
  });
}

export function apiErrorResponse(error: unknown, options: ApiResponseOptions): Response {
  if (
    process.env["NODE_ENV"] !== "test" &&
    !(error instanceof ZodError) &&
    (!isDomainError(error) || error.code === "INTERNAL")
  ) {
    logger.error(
      { ...safeLogError(error), ...requestLog(options.requestId) },
      "API request failed unexpectedly",
    );
  }
  const safe = safeError(error);
  const body: ApiResponse<never> = {
    ok: false,
    error: {
      ...safe.toSafeObject(),
      requestId: options.requestId,
    },
  };
  return new Response(JSON.stringify(body), {
    status: options.status ?? statusByCode[safe.code],
    headers: responseHeaders(options, "no-store"),
  });
}
