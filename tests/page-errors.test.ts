import type { Page } from "@playwright/test";
import { describe, expect, it, vi } from "vitest";

import { collectPageErrors } from "./e2e/page-errors";

function recordingPage() {
  const listeners = new Map<string, Array<(value: unknown) => void>>();
  const page = {
    on: vi.fn((event: string, listener: (value: unknown) => void) => {
      const current = listeners.get(event) ?? [];
      current.push(listener);
      listeners.set(event, current);
    }),
  } as unknown as Page;
  return {
    page,
    emit(event: string, value: unknown) {
      for (const listener of listeners.get(event) ?? []) listener(value);
    },
  };
}

function request(url: string, method = "GET", errorText: string | null = null) {
  return {
    failure: () => (errorText === null ? null : { errorText }),
    method: () => method,
    url: () => url,
  };
}

function response(url: string, status: number, method = "GET") {
  const sourceRequest = request(url, method);
  return {
    request: () => sourceRequest,
    status: () => status,
    url: () => url,
  };
}

describe("E2E browser error collection", () => {
  it("allows only declared HTTP failures and retains network, CSP, and chunk failures", () => {
    const current = recordingPage();
    const errors = collectPageErrors(current.page, {
      expectedHttpErrors: [{ method: "GET", pathname: "/api/expected", status: 401 }],
    });

    current.emit("console", {
      text: () => "Failed to load resource: the server responded with a status of 401 ()",
      type: () => "error",
    });
    current.emit("response", response("https://jobbbler.example/api/expected", 401));
    current.emit("response", response("https://jobbbler.example/_next/chunk.js", 404));
    current.emit("console", {
      text: () => "Refused to connect because it violates the document's Content Security Policy",
      type: () => "error",
    });
    current.emit(
      "requestfailed",
      request("https://jobbbler.example/_next/app.js", "GET", "net::ERR_FAILED"),
    );

    expect(errors()).toEqual([
      "http 404: GET https://jobbbler.example/_next/chunk.js",
      "console: Refused to connect because it violates the document's Content Security Policy",
      "requestfailed: GET https://jobbbler.example/_next/app.js: net::ERR_FAILED",
    ]);
  });

  it("allows an exact declared abort while retaining unrelated request failures", () => {
    const current = recordingPage();
    const errors = collectPageErrors(current.page, {
      expectedRequestFailures: [
        {
          method: "GET",
          pathname: "/api/v1/jobs/job_missing",
          errorText: "net::ERR_ABORTED",
        },
      ],
    });

    current.emit(
      "requestfailed",
      request("https://jobbbler.example/api/v1/jobs/job_missing", "GET", "net::ERR_ABORTED"),
    );
    current.emit(
      "requestfailed",
      request("https://jobbbler.example/_next/app.js", "GET", "net::ERR_ABORTED"),
    );

    expect(errors()).toEqual([
      "requestfailed: GET https://jobbbler.example/_next/app.js: net::ERR_ABORTED",
    ]);
  });
});
