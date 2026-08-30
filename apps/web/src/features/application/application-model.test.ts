import { describe, expect, it } from "vitest";

import type { ApplicationWorkspace } from "@jobbbler/contracts";

import {
  applicationAgentState,
  applicationDisclosure,
  applicationReadiness,
  applicationStage,
  visibleApplicationProgress,
} from "./application-model";

const base: ApplicationWorkspace = {
  draft: {
    id: "draft_550e8400-e29b-41d4-a716-446655440000",
    ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
    jobId: "job_550e8400-e29b-41d4-a716-446655440000",
    state: "draft",
    version: 1,
    answers: [
      {
        fieldKey: "full_name",
        value: "Ada Lovelace",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
    ],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:01:00.000Z",
  },
  requirements: [
    {
      fieldKey: "full_name",
      label: "Full name",
      description: "Shared with the hiring team.",
      input: "text",
      required: true,
      sensitive: true,
      category: "identity",
      options: [],
    },
    {
      fieldKey: "motivation",
      label: "Why this role",
      description: "A short note for the hiring team.",
      input: "textarea",
      required: true,
      sensitive: false,
      category: "application_answers",
      options: [],
    },
  ],
  recipient: {
    id: "org_550e8400-e29b-41d4-a716-446655440000",
    name: "Northstar Systems",
  },
  purpose: "Submit this reviewed application to Northstar Systems.",
  noticeVersion: "privacy-2026-08-29",
  legalBasis: "consent",
  review: null,
  dataGrant: null,
  delegationRequests: [],
  receipt: null,
};

describe("application presentation model", () => {
  it("keeps profile, review, permission, confirmation, and completion visibly separate", () => {
    expect(applicationStage(base)).toBe("profile");
    expect(applicationStage({ ...base, draft: { ...base.draft, state: "valid" } })).toBe("review");
    const reviewed = {
      ...base,
      draft: { ...base.draft, state: "reviewed" as const },
      review: {
        id: "review_550e8400-e29b-41d4-a716-446655440000",
        draftId: base.draft.id,
        draftVersion: base.draft.version,
        payloadHash: "a".repeat(64),
        status: "active" as const,
        createdAt: "2026-08-29T10:02:00.000Z",
      },
    };
    expect(applicationStage(reviewed)).toBe("permission");
    expect(
      applicationStage({
        ...reviewed,
        dataGrant: {
          id: "grant_550e8400-e29b-41d4-a716-446655440000",
          status: "active",
          expiresAt: "2026-08-29T10:32:00.000Z",
        },
      }),
    ).toBe("confirmation");
    expect(
      applicationStage({
        ...reviewed,
        receipt: {
          id: "receipt_550e8400-e29b-41d4-a716-446655440000",
          status: "submitted",
          externalUrl: null,
          createdAt: "2026-08-29T10:03:00.000Z",
        },
      }),
    ).toBe("complete");
  });

  it("derives an exact, minimal disclosure from accepted non-empty answers", () => {
    const disclosure = applicationDisclosure(base);
    expect(disclosure).toEqual({
      fieldKeys: ["full_name"],
      categories: ["identity"],
      sensitiveFieldKeys: ["full_name"],
    });
  });

  it("treats a non-empty agent suggestion as ready for one final human review", () => {
    const workspace: ApplicationWorkspace = {
      ...base,
      draft: {
        ...base.draft,
        answers: [
          ...base.draft.answers,
          {
            fieldKey: "motivation",
            value: "Suggested text",
            provenance: "agent_suggestion",
            sensitive: false,
            acceptedByHuman: false,
          },
        ],
      },
    };

    expect(visibleApplicationProgress(workspace)).toEqual({ completed: 2, required: 2 });
    expect(applicationReadiness(workspace)).toEqual({
      completed: 2,
      required: 2,
      missingFieldKeys: [],
      readyForReview: true,
    });
  });

  it("reports only genuinely missing required fields", () => {
    expect(applicationReadiness(base)).toEqual({
      completed: 1,
      required: 2,
      missingFieldKeys: ["motivation"],
      readyForReview: false,
    });
  });

  it("gives agents only workflow state, never answers or owner identity", () => {
    const state = applicationAgentState(base, false);
    expect(state).toMatchObject({
      draftId: base.draft.id,
      stage: "profile",
      requiredFields: 2,
      completedRequiredFields: 1,
      finalConfirmationReady: false,
    });
    expect(JSON.stringify(state)).not.toContain("Ada Lovelace");
    expect(JSON.stringify(state)).not.toContain(base.draft.ownerId);
  });
});
