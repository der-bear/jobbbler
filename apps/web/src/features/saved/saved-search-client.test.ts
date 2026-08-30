import { describe, expect, it, vi } from "vitest";

import type { JobSearchCriteria, SavedSearch } from "@jobbbler/contracts";

import { saveSearchWithoutDelivery } from "./saved-search-client";

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
});
