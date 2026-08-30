import { describe, expect, it } from "vitest";

import { ApplicationWorkspace } from "@/features/application/application-workspace";

import ApplicationPage from "./page";

const firstDraftId = "draft_550e8400-e29b-41d4-a716-446655440000";
const secondDraftId = "draft_650e8400-e29b-41d4-a716-446655440000";

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
});
