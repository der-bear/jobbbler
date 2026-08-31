import { describe, expect, it, vi } from "vitest";

import type { JobSearchCriteria, SavedSearch } from "@jobbbler/contracts";

import { ApiClientError } from "@/lib/query-client";

import { saveJobSearchForAgent, saveSearchWithoutDelivery } from "./saved-search-client";

const criteria = {
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
} satisfies JobSearchCriteria;

describe("saveSearchWithoutDelivery", () => {
  it("saves criteria without requiring an email destination or schedule", async () => {
    const saved = { id: "saved_search_00000001-0000-7000-8000-000000000001" } as SavedSearch;
    const request = vi.fn().mockResolvedValue(saved);

    await expect(
      saveSearchWithoutDelivery({ name: "Platform roles", criteria }, request),
    ).resolves.toBe(saved);

    expect(request).toHaveBeenCalledWith("/api/v1/saved-searches", expect.anything(), {
      method: "POST",
      body: { name: "Platform roles", criteria },
    });
  });

  it("retries one agent-attributed save after creating the private workspace", async () => {
    const saved = { id: "saved_search_00000001-0000-7000-8000-000000000001" } as SavedSearch;
    const signal = new AbortController().signal;
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: "UNAUTHORIZED",
          message: "Private workspace required.",
          retryable: false,
        }),
      )
      .mockResolvedValueOnce({
        owner: { id: "owner_00000001-0000-7000-8000-000000000001" },
        expiresAt: "2026-09-07T12:00:00.000Z",
      })
      .mockResolvedValueOnce(saved);

    await expect(
      saveJobSearchForAgent(
        { name: "Platform roles", criteria },
        { signal },
        { request, createIdempotencyKey: () => "stable-save-key" },
      ),
    ).resolves.toBe(saved);

    expect(request).toHaveBeenNthCalledWith(1, "/api/v1/agent/saved-searches", expect.anything(), {
      method: "POST",
      body: { name: "Platform roles", criteria },
      headers: { "Idempotency-Key": "stable-save-key" },
      signal,
    });
    expect(request).toHaveBeenNthCalledWith(2, "/api/v1/owners/session", expect.anything(), {
      method: "POST",
      signal,
    });
    expect(request).toHaveBeenNthCalledWith(3, "/api/v1/agent/saved-searches", expect.anything(), {
      method: "POST",
      body: { name: "Platform roles", criteria },
      headers: { "Idempotency-Key": "stable-save-key" },
      signal,
    });
  });
});
