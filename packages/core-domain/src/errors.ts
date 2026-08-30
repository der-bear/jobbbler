import type { ApiErrorCode } from "@jobbbler/contracts";

const domainErrorBrand = Symbol.for("@jobbbler/core-domain/DomainError");
const apiErrorCodes = new Set<string>([
  "VALIDATION",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "RATE_LIMITED",
  "DEPENDENCY",
  "CANCELLED",
  "INTERNAL",
]);

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
  readonly [domainErrorBrand] = true;
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
  if (value instanceof DomainError) return true;
  if (typeof value !== "object" || value === null) return false;

  const candidate = value as {
    readonly [domainErrorBrand]?: unknown;
    readonly code?: unknown;
    readonly details?: unknown;
    readonly message?: unknown;
    readonly name?: unknown;
    readonly retryable?: unknown;
    readonly toSafeObject?: unknown;
  };
  const detailsAreSafe =
    candidate.details === undefined ||
    (typeof candidate.details === "object" &&
      candidate.details !== null &&
      !Array.isArray(candidate.details));

  return (
    (candidate[domainErrorBrand] === true || candidate.name === "DomainError") &&
    typeof candidate.code === "string" &&
    apiErrorCodes.has(candidate.code) &&
    typeof candidate.message === "string" &&
    typeof candidate.retryable === "boolean" &&
    detailsAreSafe &&
    typeof candidate.toSafeObject === "function"
  );
}
