import { describe, expect, it, vi } from "vitest";

import type {
  DecideSearchAlertInput,
  RequestSearchAlertInput,
  RequestSearchAlertResult,
} from "@jobbbler/contracts";

import { ApiClientError } from "@/lib/query-client";

import { decideSearchAlert, requestSearchAlert } from "./search-alert-client";

const requestInput: RequestSearchAlertInput = {
  name: "Senior platform roles",
  criteria: {
    query: "platform",
    categories: [],
    workModels: ["remote"],
    seniorities: ["senior"],
    locations: ["Europe"],
    skills: [],
    excludeKeywords: [],
    salary: null,
    postedWithinDays: null,
    sort: "relevance",
    cursor: null,
    limit: 20,
    unresolvedAssumptions: [],
  },
  recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
  delivery: { channel: "email", email: "ada@example.com" },
};

const review: RequestSearchAlertResult = {
  status: "requires_user_action",
  requestId: "req_00000001-0000-7000-8000-000000000001",
  reviewToken: "signed-review",
  expiresAt: "2026-08-30T09:10:00.000Z",
  review: {
    savedSearchId: "saved_search_00000001-0000-7000-8000-000000000001",
    savedSearchVersion: 0,
    maskedDestination: "a***@example.com",
    criteria: requestInput.criteria,
    recurrence: requestInput.recurrence,
    firstRunAt: "2026-08-31T06:00:00.000Z",
    purpose: "Send an email when matching roles change.",
    dataCategories: ["saved_search_criteria", "delivery_email"],
    retention: "Until the alert or workspace is deleted.",
    withdrawal: "Pause the alert or delete the workspace at any time.",
    privacyNoticeVersion: "2026-08-29",
  },
};

describe("agent-native search alert API client", () => {
  it("creates an owner session once and retries the exact idempotent request", async () => {
    const unauthorized = new ApiClientError({
      code: "UNAUTHORIZED",
      message: "Owner session required.",
      retryable: false,
    });
    const request = vi
      .fn()
      .mockRejectedValueOnce(unauthorized)
      .mockResolvedValueOnce({
        owner: { id: "owner_00000001-0000-7000-8000-000000000001" },
        expiresAt: "2026-09-30T09:00:00.000Z",
      })
      .mockResolvedValueOnce(review);
    const signal = new AbortController().signal;

    const result = await requestSearchAlert(
      requestInput,
      { signal },
      {
        request,
        createIdempotencyKey: () => "alert-request-key",
      },
    );

    expect(result).toBe(review);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      {
        method: "POST",
        body: requestInput,
        headers: { "Idempotency-Key": "alert-request-key" },
        signal,
      },
    );
    expect(request).toHaveBeenNthCalledWith(2, "/api/v1/owners/session", expect.anything(), {
      method: "POST",
      signal,
    });
    expect(request).toHaveBeenNthCalledWith(
      3,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      {
        method: "POST",
        body: requestInput,
        headers: { "Idempotency-Key": "alert-request-key" },
        signal,
      },
    );
  });

  it("reuses one request key when the first tool invocation has an ambiguous retryable failure", async () => {
    const dependencyFailure = new ApiClientError({
      code: "DEPENDENCY",
      message: "The response may have been committed.",
      retryable: true,
    });
    const request = vi.fn().mockRejectedValueOnce(dependencyFailure).mockResolvedValueOnce(review);
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce("stable-alert-request-key")
      .mockReturnValueOnce("wrong-second-key");
    const requestKeys = new Map();
    const dependencies = {
      request,
      createIdempotencyKey,
      requestKeys,
      nowMs: () => Date.parse("2026-08-30T09:00:00.000Z"),
    };
    const signal = new AbortController().signal;

    await expect(requestSearchAlert(requestInput, { signal }, dependencies)).rejects.toBe(
      dependencyFailure,
    );
    await expect(requestSearchAlert(requestInput, { signal }, dependencies)).resolves.toBe(review);

    expect(createIdempotencyKey).toHaveBeenCalledOnce();
    expect([...requestKeys.keys()].join(" ")).not.toContain("ada@example.com");
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      expect.objectContaining({ headers: { "Idempotency-Key": "stable-alert-request-key" } }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      expect.objectContaining({ headers: { "Idempotency-Key": "stable-alert-request-key" } }),
    );
  });

  it("reuses the request key after a page reload in the same browser session", async () => {
    const dependencyFailure = new ApiClientError({
      code: "DEPENDENCY",
      message: "The response may have been committed.",
      retryable: true,
    });
    const stored = new Map<string, string>();
    const requestKeyStorage = {
      getItem: (key: string) => stored.get(key) ?? null,
      setItem: (key: string, value: string) => stored.set(key, value),
    };
    const request = vi.fn().mockRejectedValueOnce(dependencyFailure).mockResolvedValueOnce(review);
    const firstKeyFactory = vi.fn().mockReturnValue("stable-across-reload");
    const secondKeyFactory = vi.fn().mockReturnValue("duplicate-after-reload");
    const signal = new AbortController().signal;

    await expect(
      requestSearchAlert(
        requestInput,
        { signal },
        {
          request,
          createIdempotencyKey: firstKeyFactory,
          requestKeys: new Map(),
          requestKeyStorage,
          nowMs: () => Date.parse("2026-08-30T09:00:00.000Z"),
        },
      ),
    ).rejects.toBe(dependencyFailure);

    await expect(
      requestSearchAlert(
        requestInput,
        { signal },
        {
          request,
          createIdempotencyKey: secondKeyFactory,
          requestKeys: new Map(),
          requestKeyStorage,
          nowMs: () => Date.parse("2026-08-30T09:01:00.000Z"),
        },
      ),
    ).resolves.toBe(review);

    expect(firstKeyFactory).toHaveBeenCalledOnce();
    expect(secondKeyFactory).not.toHaveBeenCalled();
    expect([...stored.values()].join(" ")).not.toContain("ada@example.com");
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      expect.objectContaining({ headers: { "Idempotency-Key": "stable-across-reload" } }),
    );
  });

  it("rotates the cached request key after the exact review window expires", async () => {
    let nowMs = Date.parse("2026-08-30T09:00:00.000Z");
    const request = vi.fn().mockResolvedValue(review);
    const createIdempotencyKey = vi
      .fn()
      .mockReturnValueOnce("first-alert-request-key")
      .mockReturnValueOnce("second-alert-request-key");
    const dependencies = {
      request,
      createIdempotencyKey,
      requestKeys: new Map(),
      nowMs: () => nowMs,
    };
    const signal = new AbortController().signal;

    await requestSearchAlert(requestInput, { signal }, dependencies);
    nowMs = Date.parse("2026-08-30T09:11:00.000Z");
    await requestSearchAlert(requestInput, { signal }, dependencies);

    expect(createIdempotencyKey).toHaveBeenCalledTimes(2);
    expect(request).toHaveBeenNthCalledWith(
      1,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      expect.objectContaining({ headers: { "Idempotency-Key": "first-alert-request-key" } }),
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "/api/v1/agent/search-alerts/request",
      expect.anything(),
      expect.objectContaining({ headers: { "Idempotency-Key": "second-alert-request-key" } }),
    );
  });

  it("sends the exact request-bound decision with its own idempotency key", async () => {
    const input: DecideSearchAlertInput = {
      requestId: review.requestId,
      reviewToken: review.reviewToken,
      decision: "approved",
      code: "421973",
      channel: "agent_client",
    };
    const response = {
      status: "completed" as const,
      requestId: review.requestId,
      decision: "approved" as const,
      channel: "agent_client" as const,
      savedSearchId: review.review.savedSearchId,
      scheduleId: "schedule_00000001-0000-7000-8000-000000000001",
      nextRunAt: review.review.firstRunAt,
      decidedAt: "2026-08-30T09:02:00.000Z",
      summary: "Job alert activated for the reviewed search and destination.",
    };
    const request = vi.fn().mockResolvedValue(response);
    const signal = new AbortController().signal;

    const result = await decideSearchAlert(
      input,
      { signal },
      {
        request,
        createIdempotencyKey: () => "alert-decision-key",
      },
    );

    expect(result).toBe(response);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/agent/search-alerts/decision",
      expect.anything(),
      {
        method: "POST",
        body: input,
        headers: { "Idempotency-Key": "alert-decision-key" },
        signal,
      },
    );
  });
});
