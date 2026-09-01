import type { Page, Request, Response } from "@playwright/test";

export interface ExpectedHttpError {
  readonly method?: string;
  readonly pathname: string | RegExp;
  readonly status: number;
}

export interface PageErrorOptions {
  readonly expectedHttpErrors?: readonly ExpectedHttpError[];
  readonly expectedRequestFailures?: readonly ExpectedRequestFailure[];
}

export interface ExpectedRequestFailure {
  readonly errorText: string | RegExp;
  readonly method?: string;
  readonly pathname: string | RegExp;
}

const httpFailureConsolePattern =
  /^Failed to load resource: the server responded with a status of \d{3}\b/u;

function matches(value: string, candidate: string | RegExp): boolean {
  return typeof candidate === "string" ? candidate === value : candidate.test(value);
}

export function isExpectedHttpError(
  response: Response,
  expected: readonly ExpectedHttpError[],
): boolean {
  const request = response.request();
  const pathname = new URL(response.url()).pathname;
  return expected.some(
    (candidate) =>
      candidate.status === response.status() &&
      (candidate.method === undefined || candidate.method === request.method()) &&
      matches(pathname, candidate.pathname),
  );
}

export function isExpectedRequestFailure(
  request: Request,
  expected: readonly ExpectedRequestFailure[],
): boolean {
  const pathname = new URL(request.url()).pathname;
  const errorText = request.failure()?.errorText ?? "unknown error";
  return expected.some(
    (candidate) =>
      (candidate.method === undefined || candidate.method === request.method()) &&
      matches(pathname, candidate.pathname) &&
      matches(errorText, candidate.errorText),
  );
}

function isCancelledNextNavigation(request: Request): boolean {
  return (
    request.method() === "GET" &&
    request.failure()?.errorText === "net::ERR_ABORTED" &&
    new URL(request.url()).searchParams.has("_rsc")
  );
}

export function collectPageErrors(
  page: Page,
  options: PageErrorOptions = {},
): () => readonly string[] {
  const errors: string[] = [];
  page.on("console", (message) => {
    if (message.type() !== "error") return;
    // HTTP failures are evaluated with their exact response below. Network,
    // CSP/CORS, and chunk-load failures do not match this pattern and remain errors.
    if (httpFailureConsolePattern.test(message.text())) return;
    errors.push(`console: ${message.text()}`);
  });
  page.on("response", (response) => {
    if (
      response.status() >= 400 &&
      !isExpectedHttpError(response, options.expectedHttpErrors ?? [])
    ) {
      errors.push(
        `http ${String(response.status())}: ${response.request().method()} ${response.url()}`,
      );
    }
  });
  page.on("requestfailed", (request) => {
    // Next prefetches several React Server Component routes, then cancels the
    // speculative requests when navigation chooses one destination. Chromium
    // reports that expected cancellation as a failed request in production.
    if (isCancelledNextNavigation(request)) return;
    if (isExpectedRequestFailure(request, options.expectedRequestFailures ?? [])) return;
    errors.push(
      `requestfailed: ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`,
    );
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return () => errors;
}
