import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/query-client";

import { createSavedWebMcpReadAdapter } from "./saved-webmcp-read-adapter";

describe("createSavedWebMcpReadAdapter", () => {
  it("returns an empty private workspace to a fresh headless read without creating a session", async () => {
    const unauthorized = new ApiClientError({
      code: "UNAUTHORIZED",
      message: "Start a private Jobbbler session to continue.",
      retryable: false,
    });
    const request = vi.fn().mockRejectedValue(unauthorized);
    const reads = createSavedWebMcpReadAdapter({ request: request as never });
    const signal = new AbortController().signal;

    await expect(reads.listSavedSearches({ signal })).resolves.toEqual([]);
    await expect(reads.listSchedules({ signal })).resolves.toEqual([]);

    expect(request).toHaveBeenCalledTimes(2);
    expect(request).not.toHaveBeenCalledWith(
      "/api/v1/owners/session",
      expect.anything(),
      expect.anything(),
    );
  });

  it("preserves non-session failures", async () => {
    const failure = new ApiClientError({
      code: "DEPENDENCY",
      message: "Saved searches are temporarily unavailable.",
      retryable: true,
    });
    const reads = createSavedWebMcpReadAdapter({
      request: vi.fn().mockRejectedValue(failure) as never,
    });

    await expect(reads.listSavedSearches({ signal: new AbortController().signal })).rejects.toBe(
      failure,
    );
  });
});
