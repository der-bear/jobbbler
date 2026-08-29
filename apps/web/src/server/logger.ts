import pino from "pino";

import { isDomainError } from "@jobbbler/core-domain";

export const logger = pino({
  name: "jobbbler-web",
  redact: {
    paths: [
      "req.headers.cookie",
      "authorization",
      "cookie",
      "email",
      "address",
      "ciphertext",
      "token",
      "*.authorization",
      "*.cookie",
      "*.email",
      "*.address",
      "*.ciphertext",
      "*.token",
      "*.payload",
    ],
    censor: "[REDACTED]",
  },
});

export function safeLogError(error: unknown): {
  readonly errorKind: string;
  readonly errorCode?: string;
  readonly retryable?: boolean;
} {
  if (isDomainError(error)) {
    return {
      errorKind: "DomainError",
      errorCode: error.code,
      retryable: error.retryable,
    };
  }
  return { errorKind: error instanceof Error ? error.name : typeof error };
}

export function requestLog(
  requestId: string,
  correlationId = requestId,
): { readonly requestId: string; readonly correlationId: string } {
  return { requestId, correlationId };
}
