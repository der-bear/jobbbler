import { DomainError } from "@jobbbler/core-domain";

import type { SourcePolicy } from "./policy.js";

export type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export interface FetchBoundedJsonOptions {
  readonly policy: SourcePolicy;
  readonly fetch: FetchLike;
  readonly signal: AbortSignal;
  readonly etag: string | null;
  readonly lastModified: string | null;
}

export interface BoundedJsonResponse {
  readonly notModified: boolean;
  readonly body: unknown | null;
  readonly etag: string | null;
  readonly lastModified: string | null;
  readonly bytes: number;
}

function dependencyError(message: string, retryable: boolean): DomainError {
  return new DomainError({ code: "DEPENDENCY", message, retryable });
}

async function readBoundedBody(response: Response, maximumBytes: number): Promise<Uint8Array> {
  if (response.body === null) return new Uint8Array();
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  while (true) {
    const next = await reader.read();
    if (next.done) break;
    total += next.value.byteLength;
    if (total > maximumBytes) {
      await reader.cancel("Response exceeded source policy size limit.");
      throw dependencyError("Source response exceeded its configured size limit.", false);
    }
    chunks.push(next.value);
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

export async function fetchBoundedJson(
  url: string,
  options: FetchBoundedJsonOptions,
): Promise<BoundedJsonResponse> {
  const controller = new AbortController();
  const propagateCancellation = () => controller.abort(options.signal.reason);
  if (options.signal.aborted) propagateCancellation();
  else options.signal.addEventListener("abort", propagateCancellation, { once: true });
  const timeout = setTimeout(
    () => controller.abort(new DOMException("Source request timed out.", "TimeoutError")),
    options.policy.requestTimeoutMs,
  );

  try {
    const headers = new Headers({
      accept: "application/json",
      "user-agent": options.policy.userAgent,
    });
    if (options.etag !== null) headers.set("if-none-match", options.etag);
    if (options.lastModified !== null) {
      headers.set("if-modified-since", options.lastModified);
    }

    const response = await options.fetch(url, {
      headers,
      redirect: "manual",
      signal: controller.signal,
    });
    const etag = response.headers.get("etag");
    const lastModified = response.headers.get("last-modified");
    if (response.status === 304) {
      return { notModified: true, body: null, etag, lastModified, bytes: 0 };
    }
    if (response.status >= 300 && response.status < 400) {
      throw dependencyError("Source redirects are not allowed.", false);
    }
    if (response.status === 429) {
      throw new DomainError({
        code: "RATE_LIMITED",
        message: "Source rate limit was reached.",
        retryable: true,
        details: { retryAfter: response.headers.get("retry-after") },
      });
    }
    if (response.status === 401 || response.status === 403) {
      throw dependencyError("Source rejected the configured access policy.", false);
    }
    if (!response.ok) {
      throw dependencyError(
        `Source returned HTTP ${String(response.status)}.`,
        response.status >= 500,
      );
    }

    const declaredLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > options.policy.maxResponseBytes) {
      throw dependencyError("Source response exceeded its configured size limit.", false);
    }
    const bodyBytes = await readBoundedBody(response, options.policy.maxResponseBytes);
    let body: unknown;
    try {
      body = JSON.parse(new TextDecoder().decode(bodyBytes)) as unknown;
    } catch (error) {
      throw new DomainError({
        code: "DEPENDENCY",
        message: "Source returned invalid JSON.",
        retryable: false,
        cause: error,
      });
    }

    return {
      notModified: false,
      body,
      etag,
      lastModified,
      bytes: bodyBytes.byteLength,
    };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    if (options.signal.aborted) {
      throw new DomainError({ code: "CANCELLED", message: "Source fetch was cancelled." });
    }
    if (controller.signal.aborted) {
      throw dependencyError("Source request timed out.", true);
    }
    throw new DomainError({
      code: "DEPENDENCY",
      message: "Source request failed.",
      retryable: true,
      cause: error,
    });
  } finally {
    clearTimeout(timeout);
    options.signal.removeEventListener("abort", propagateCancellation);
  }
}
