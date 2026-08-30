import { beforeEach, describe, expect, it, vi } from "vitest";

import { DomainError } from "@jobbbler/core-domain";

const runtime = vi.hoisted(() => ({
  loadInitialApplication: vi.fn(),
  notFound: vi.fn(() => {
    throw new Error("NEXT_NOT_FOUND");
  }),
}));

vi.mock("next/headers", () => ({
  headers: vi.fn(async () => new Headers()),
}));

vi.mock("next/navigation", () => ({ notFound: runtime.notFound }));

vi.mock("@/server/initial-application", () => ({
  loadInitialApplication: runtime.loadInitialApplication,
}));

import { ApplicationWorkspace } from "@/features/application/application-workspace";

import ApplicationPage from "./page";

const firstDraftId = "draft_550e8400-e29b-41d4-a716-446655440000";
const secondDraftId = "draft_650e8400-e29b-41d4-a716-446655440000";

beforeEach(() => {
  runtime.loadInitialApplication.mockReset().mockResolvedValue(null);
  runtime.notFound.mockClear();
});

describe("application route draft boundary", () => {
  it("changes the route reconciliation key when client navigation changes drafts", async () => {
    const first = await ApplicationPage({ params: Promise.resolve({ draftId: firstDraftId }) });
    const second = await ApplicationPage({ params: Promise.resolve({ draftId: secondDraftId }) });

    expect(first.key).toBe(firstDraftId);
    expect(second.key).toBe(secondDraftId);
  });

  it("keeps the hook-owning workspace behind its own draft-keyed boundary", () => {
    const first = ApplicationWorkspace({ draftId: firstDraftId });
    const second = ApplicationWorkspace({ draftId: secondDraftId });

    expect(first.key).toBe(firstDraftId);
    expect(second.key).toBe(secondDraftId);
  });

  it("renders a missing draft through the named not-found route outcome", async () => {
    runtime.loadInitialApplication.mockRejectedValue(
      new DomainError({ code: "NOT_FOUND", message: "Application was not found." }),
    );

    await expect(
      ApplicationPage({ params: Promise.resolve({ draftId: firstDraftId }) }),
    ).rejects.toThrow("NEXT_NOT_FOUND");
    expect(runtime.notFound).toHaveBeenCalledOnce();
  });
});
