import type { Page, Response } from "@playwright/test";

export interface ExpectedHttpError {
  readonly method?: string;
  readonly pathname: string | RegExp;
  readonly status: number;
}

export interface PageErrorOptions {
  readonly expectedHttpErrors?: readonly ExpectedHttpError[];
}

const httpFailureConsolePattern =
  /^Failed to load resource: the server responded with a status of \d{3}\b/u;

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
      (typeof candidate.pathname === "string"
        ? candidate.pathname === pathname
        : candidate.pathname.test(pathname)),
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
    errors.push(
      `requestfailed: ${request.method()} ${request.url()}: ${request.failure()?.errorText ?? "unknown error"}`,
    );
  });
  page.on("pageerror", (error) => errors.push(`pageerror: ${error.message}`));
  return () => errors;
}
