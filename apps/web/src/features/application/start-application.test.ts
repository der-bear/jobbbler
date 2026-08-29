import { describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/query-client";

import { startApplication } from "./start-application";

const draft = {
  id: "application_550e8400-e29b-41d4-a716-446655440000",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  jobId: "job_550e8400-e29b-41d4-a716-446655440000",
  state: "draft" as const,
  version: 0,
  answers: [],
  createdAt: "2026-08-29T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
};

describe("startApplication", () => {
  it("opens an existing owner-bound draft", async () => {
    const request = vi.fn().mockResolvedValue(draft);
    const navigate = vi.fn();
    await startApplication(draft.jobId, { request, navigate });
    expect(request).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(`/apply/${draft.id}`);
  });

  it("creates a private owner session on demand and retries once", async () => {
    const request = vi
      .fn()
      .mockRejectedValueOnce(
        new ApiClientError({
          code: "UNAUTHORIZED",
          message: "Start a private session.",
          requestId: "request-1",
          retryable: false,
        }),
      )
      .mockResolvedValueOnce({ owner: { id: "owner", kind: "ephemeral" }, expiresAt: "later" })
      .mockResolvedValueOnce(draft);
    const navigate = vi.fn();
    await startApplication(draft.jobId, { request, navigate });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/applications",
      "/api/v1/owners/session",
      "/api/v1/applications",
    ]);
    expect(navigate).toHaveBeenCalledWith(`/apply/${draft.id}`);
  });
});
