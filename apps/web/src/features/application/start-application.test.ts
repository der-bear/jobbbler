import { beforeEach, describe, expect, it, vi } from "vitest";

import { ApiClientError } from "@/lib/query-client";

const marker = vi.hoisted(() => ({ markOwnerSessionStarted: vi.fn() }));
vi.mock("@/lib/owner-session-marker", () => marker);

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
  beforeEach(() => marker.markOwnerSessionStarted.mockClear());

  it("opens an existing owner-bound draft", async () => {
    const request = vi.fn().mockResolvedValue({ draft, disposition: "reopened" });
    const navigate = vi.fn();
    const signal = new AbortController().signal;
    const result = await startApplication(draft.jobId, { request, navigate }, { signal });
    expect(result).toEqual({ draft, disposition: "reopened" });
    expect(request).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledWith(
      "/api/v1/applications",
      expect.anything(),
      expect.objectContaining({ signal }),
    );
    expect(navigate).toHaveBeenCalledWith(`/apply/${draft.id}`);
    expect(marker.markOwnerSessionStarted).toHaveBeenCalledOnce();
    expect(marker.markOwnerSessionStarted).toHaveBeenCalledWith(undefined);
  });

  it("creates a draft without navigating when headless presentation is requested", async () => {
    const request = vi.fn().mockResolvedValue({ draft, disposition: "created" });
    const navigate = vi.fn();

    await expect(
      startApplication(draft.jobId, { request, navigate }, { navigate: false }),
    ).resolves.toEqual({ draft, disposition: "created" });

    expect(navigate).not.toHaveBeenCalled();
    expect(marker.markOwnerSessionStarted).toHaveBeenCalledOnce();
  });

  it("does not complete until the application workspace navigation commits", async () => {
    const request = vi.fn().mockResolvedValue({ draft, disposition: "created" });
    let releaseNavigation!: () => void;
    const navigation = new Promise<void>((resolve) => {
      releaseNavigation = resolve;
    });
    const navigate = vi.fn(() => navigation);
    let settled = false;

    const starting = startApplication(draft.jobId, { request, navigate }).then((result) => {
      settled = true;
      return result;
    });

    await vi.waitFor(() => expect(navigate).toHaveBeenCalledOnce());
    expect(settled).toBe(false);
    releaseNavigation();
    await expect(starting).resolves.toEqual({ draft, disposition: "created" });
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
      .mockResolvedValueOnce({ draft, disposition: "created" });
    const navigate = vi.fn();
    await startApplication(draft.jobId, { request, navigate });
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      "/api/v1/applications",
      "/api/v1/owners/session",
      "/api/v1/applications",
    ]);
    expect(navigate).toHaveBeenCalledWith(`/apply/${draft.id}`);
    expect(marker.markOwnerSessionStarted).toHaveBeenCalledOnce();
    expect(marker.markOwnerSessionStarted).toHaveBeenCalledWith("later");
  });
});
