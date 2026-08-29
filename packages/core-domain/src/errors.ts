import type { ApiErrorCode } from "@jobbbler/contracts";

export interface DomainErrorOptions {
  code: ApiErrorCode;
  message: string;
  retryable?: boolean;
  details?: Readonly<Record<string, unknown>>;
  cause?: unknown;
}

export interface SafeDomainError {
  code: ApiErrorCode;
  message: string;
  retryable: boolean;
  details?: Readonly<Record<string, unknown>>;
}

export class DomainError extends Error {
  readonly code: ApiErrorCode;
  readonly retryable: boolean;
  readonly details: Readonly<Record<string, unknown>> | undefined;

  constructor(options: DomainErrorOptions) {
    super(options.message, { cause: options.cause });
    this.name = "DomainError";
    this.code = options.code;
    this.retryable = options.retryable ?? false;
    this.details = options.details;
  }

  toSafeObject(): SafeDomainError {
    const safe: SafeDomainError = {
      code: this.code,
      message: this.message,
      retryable: this.retryable,
    };

    return this.details === undefined ? safe : { ...safe, details: this.details };
  }
}

export function isDomainError(value: unknown): value is DomainError {
  return value instanceof DomainError;
}
