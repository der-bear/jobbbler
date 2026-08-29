import { type ZodType } from "zod";

import { apiResponseSchema, type ApiErrorCode } from "@jobbbler/contracts";

export class ApiClientError extends Error {
  readonly code: ApiErrorCode;
  readonly requestId: string | null;
  readonly retryable: boolean;
  readonly retryAfterSeconds: number | null;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(options: {
    code: ApiErrorCode;
    message: string;
    requestId?: string | null;
    retryable: boolean;
    retryAfterSeconds?: number | null;
    details?: Readonly<Record<string, unknown>>;
  }) {
    super(options.message);
    this.name = "ApiClientError";
    this.code = options.code;
    this.requestId = options.requestId ?? null;
    this.retryable = options.retryable;
    this.retryAfterSeconds = options.retryAfterSeconds ?? null;
    this.details = options.details;
  }
}

export interface QueryApiOptions {
  readonly fetch?: typeof globalThis.fetch;
  readonly signal?: AbortSignal;
  readonly method?: "GET" | "POST";
  readonly body?: unknown;
  readonly headers?: HeadersInit;
}

function dependencyFailure(): ApiClientError {
  return new ApiClientError({
    code: "DEPENDENCY",
    message: "The server returned an invalid response.",
    retryable: true,
  });
}

function retryAfter(response: Response): number | null {
  const value = response.headers.get("retry-after");
  if (value === null || !/^\d+$/u.test(value)) return null;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds > 0 ? seconds : null;
}

export async function queryApi<T>(
  url: string,
  dataSchema: ZodType<T>,
  options: QueryApiOptions = {},
): Promise<T> {
  const fetchImplementation = options.fetch ?? globalThis.fetch;
  const headers = new Headers(options.headers);
  headers.set("accept", "application/json");
  if (options.body !== undefined) headers.set("content-type", "application/json");

  const response = await fetchImplementation(url, {
    method: options.method ?? "GET",
    credentials: "same-origin",
    headers,
    ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  });

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw dependencyFailure();
  }
  const parsed = apiResponseSchema(dataSchema).safeParse(payload);
  if (!parsed.success) throw dependencyFailure();
  if (parsed.data.ok) return parsed.data.data;

  throw new ApiClientError({
    code: parsed.data.error.code,
    message: parsed.data.error.message,
    requestId: parsed.data.error.requestId,
    retryable: parsed.data.error.retryable,
    retryAfterSeconds: retryAfter(response),
    ...(parsed.data.error.details === undefined ? {} : { details: parsed.data.error.details }),
  });
}
