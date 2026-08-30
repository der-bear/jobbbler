import { describe, expect, it, vi } from "vitest";

import type { ApplicationWorkspace } from "@jobbbler/contracts";

import { finalizeApplication } from "./application-finalization";

const draftId = "application_550e8400-e29b-41d4-a716-446655440000";
const reviewId = "review_550e8400-e29b-41d4-a716-446655440000";
const grantId = "grant_550e8400-e29b-41d4-a716-446655440000";
const replacementGrantId = "grant_650e8400-e29b-41d4-a716-446655440000";
const confirmationId = "confirmation_550e8400-e29b-41d4-a716-446655440000";
const interactionRequestId = "interaction_550e8400-e29b-41d4-a716-446655440000";
const staleInteractionRequestId = "interaction_650e8400-e29b-41d4-a716-446655440000";
const agentAuthorization = `Bearer ${"A".repeat(43)}`;

const workspace: ApplicationWorkspace = {
  applyMode: "internal",
  draft: {
    id: draftId,
    ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
    jobId: "job_550e8400-e29b-41d4-a716-446655440000",
    state: "draft",
    version: 0,
    answers: [
      {
        fieldKey: "motivation",
        value: "Agent draft",
        provenance: "agent_suggestion",
        sensitive: false,
        acceptedByHuman: false,
      },
    ],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:00:00.000Z",
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
      description: "A short note.",
      input: "textarea",
      required: true,
      sensitive: false,
      category: "application_answers",
      options: [],
    },
  ],
  recipient: {
    id: "organization_550e8400-e29b-41d4-a716-446655440000",
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

function reviewedWorkspace(
  dataGrant: NonNullable<ApplicationWorkspace["dataGrant"]>,
): ApplicationWorkspace {
  return {
    ...workspace,
    draft: {
      ...workspace.draft,
      state: "reviewed",
      version: 4,
      answers: [
        {
          fieldKey: "full_name",
          value: "Ada Lovelace",
          provenance: "user_entered",
          sensitive: true,
          acceptedByHuman: true,
        },
        {
          fieldKey: "motivation",
          value: "Candidate-authored note",
          provenance: "user_entered",
          sensitive: false,
          acceptedByHuman: true,
        },
      ],
    },
    review: {
      id: reviewId,
      draftId,
      draftVersion: 4,
      payloadHash: "a".repeat(64),
      status: "active",
      createdAt: "2026-08-29T10:01:00.000Z",
    },
    dataGrant,
  };
}

describe("finalizeApplication", () => {
  it("requires the exact agent-client review request before making any mutation", async () => {
    const request = vi.fn();

    await expect(
      finalizeApplication({
        workspace,
        values: { full_name: "Ada Lovelace", motivation: "Agent draft" },
        request,
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        interactionChannel: "agent_client",
      }),
    ).rejects.toThrow("agent-client review request");
    expect(request).not.toHaveBeenCalled();
  });

  it("requires the scoped agent credential before an agent-client submission mutation", async () => {
    const request = vi.fn();

    await expect(
      finalizeApplication({
        workspace,
        values: { full_name: "Ada Lovelace", motivation: "Agent draft" },
        request,
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
        interactionChannel: "agent_client",
        interactionRequestId,
      }),
    ).rejects.toThrow("agent credential");
    expect(request).not.toHaveBeenCalled();
  });

  it("replaces an agent-client pending grant bound to a different review request", async () => {
    const pending = reviewedWorkspace({
      id: grantId,
      status: "requested",
      expiresAt: "2026-08-29T10:31:00.000Z",
      decisionChannel: "agent_client",
      decisionRequestId: staleInteractionRequestId,
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ...pending.dataGrant,
        status: "withdrawn",
      })
      .mockResolvedValueOnce({
        id: replacementGrantId,
        status: "requested",
        expiresAt: "2026-08-29T10:31:00.000Z",
        decisionChannel: "agent_client",
        decisionRequestId: interactionRequestId,
      })
      .mockResolvedValueOnce({
        id: replacementGrantId,
        status: "active",
        expiresAt: "2026-08-29T10:31:00.000Z",
        decisionChannel: "agent_client",
        decisionRequestId: interactionRequestId,
      })
      .mockResolvedValueOnce({ confirmationId, expiresAt: "2026-08-29T10:06:00.000Z" })
      .mockResolvedValueOnce({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted",
        externalUrl: null,
        createdAt: "2026-08-29T10:02:00.000Z",
      });

    await finalizeApplication({
      workspace: pending,
      values: { full_name: "Ada Lovelace", motivation: "Candidate-authored note" },
      request,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      interactionChannel: "agent_client",
      interactionRequestId,
      agentAuthorization,
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/applications/${draftId}/data-grants/${grantId}`,
      `/api/v1/applications/${draftId}/data-grants`,
      `/api/v1/applications/${draftId}/data-grants/${replacementGrantId}/approve`,
      `/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
      `/api/v1/applications/${draftId}`,
    ]);
    expect(request.mock.calls[0]?.[2]).toMatchObject({ method: "DELETE" });
    expect(request.mock.calls[1]?.[2]).toMatchObject({
      body: { consentRequestId: interactionRequestId },
      headers: { authorization: agentAuthorization },
    });
  });

  it("replaces an agent-client pending grant before a manual decision can reuse it", async () => {
    const pending = reviewedWorkspace({
      id: grantId,
      status: "requested",
      expiresAt: "2026-08-29T10:31:00.000Z",
      decisionChannel: "agent_client",
      decisionRequestId: interactionRequestId,
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...pending.dataGrant, status: "withdrawn" })
      .mockResolvedValueOnce({
        id: replacementGrantId,
        status: "requested",
        expiresAt: "2026-08-29T10:31:00.000Z",
        decisionChannel: "first_party_ui",
        decisionRequestId: replacementGrantId,
      })
      .mockResolvedValueOnce({
        id: replacementGrantId,
        status: "active",
        expiresAt: "2026-08-29T10:31:00.000Z",
        decisionChannel: "first_party_ui",
        decisionRequestId: replacementGrantId,
      })
      .mockResolvedValueOnce({ confirmationId, expiresAt: "2026-08-29T10:06:00.000Z" })
      .mockResolvedValueOnce({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted",
        externalUrl: null,
        createdAt: "2026-08-29T10:02:00.000Z",
      });

    await finalizeApplication({
      workspace: pending,
      values: { full_name: "Ada Lovelace", motivation: "Candidate-authored note" },
      request,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/applications/${draftId}/data-grants/${grantId}`,
      `/api/v1/applications/${draftId}/data-grants`,
      `/api/v1/applications/${draftId}/data-grants/${replacementGrantId}/approve`,
      `/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
      `/api/v1/applications/${draftId}`,
    ]);
    expect(request.mock.calls[1]?.[2]).not.toHaveProperty("body.consentRequestId");
    expect(request.mock.calls[2]?.[2]).toMatchObject({
      body: { interaction: { channel: "first_party_ui", requestId: replacementGrantId } },
    });
  });

  it("reuses only the pending grant bound to the current agent-client request", async () => {
    const pending = reviewedWorkspace({
      id: grantId,
      status: "requested",
      expiresAt: "2026-08-29T10:31:00.000Z",
      decisionChannel: "agent_client",
      decisionRequestId: interactionRequestId,
    });
    const request = vi
      .fn()
      .mockResolvedValueOnce({ ...pending.dataGrant, status: "active" })
      .mockResolvedValueOnce({ confirmationId, expiresAt: "2026-08-29T10:06:00.000Z" })
      .mockResolvedValueOnce({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted",
        externalUrl: null,
        createdAt: "2026-08-29T10:02:00.000Z",
      });

    await finalizeApplication({
      workspace: pending,
      values: { full_name: "Ada Lovelace", motivation: "Candidate-authored note" },
      request,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      interactionChannel: "agent_client",
      interactionRequestId,
      agentAuthorization,
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/applications/${draftId}/data-grants/${grantId}/approve`,
      `/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
      `/api/v1/applications/${draftId}`,
    ]);
  });

  it("turns one human decision into accepted values, exact permission, confirmation, and submission", async () => {
    const request = vi
      .fn()
      .mockResolvedValueOnce({
        ...workspace.draft,
        version: 1,
        answers: [
          {
            fieldKey: "full_name",
            value: "Ada Lovelace",
            provenance: "user_entered",
            sensitive: true,
            acceptedByHuman: true,
          },
          {
            fieldKey: "motivation",
            value: "Agent draft",
            provenance: "agent_suggestion",
            sensitive: false,
            acceptedByHuman: true,
          },
        ],
      })
      .mockResolvedValueOnce({ ...workspace.draft, version: 2, state: "valid", answers: [] })
      .mockResolvedValueOnce({
        id: reviewId,
        draftId,
        draftVersion: 3,
        payloadHash: "a".repeat(64),
        status: "active",
        createdAt: "2026-08-29T10:01:00.000Z",
      })
      .mockResolvedValueOnce({
        id: grantId,
        status: "requested",
        expiresAt: "2026-08-29T10:31:00.000Z",
      })
      .mockResolvedValueOnce({
        id: grantId,
        status: "active",
        expiresAt: "2026-08-29T10:31:00.000Z",
      })
      .mockResolvedValueOnce({
        confirmationId,
        expiresAt: "2026-08-29T10:06:00.000Z",
      })
      .mockResolvedValueOnce({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted",
        externalUrl: null,
        createdAt: "2026-08-29T10:02:00.000Z",
      });

    const receipt = await finalizeApplication({
      workspace,
      values: { full_name: "Ada Lovelace", motivation: "Agent draft" },
      request,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      interactionChannel: "agent_client",
      interactionRequestId,
      agentAuthorization,
    });

    expect(receipt.status).toBe("submitted");
    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/applications/${draftId}/answer`,
      `/api/v1/applications/${draftId}/validate`,
      `/api/v1/applications/${draftId}/review`,
      `/api/v1/applications/${draftId}/data-grants`,
      `/api/v1/applications/${draftId}/data-grants/${grantId}/approve`,
      `/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
      `/api/v1/applications/${draftId}`,
    ]);
    expect(request.mock.calls[0]?.[2]).toMatchObject({
      body: {
        expectedVersion: 0,
        answers: expect.arrayContaining([
          expect.objectContaining({
            fieldKey: "motivation",
            provenance: "agent_suggestion",
            acceptedByHuman: true,
          }),
        ]),
      },
    });
    expect(request.mock.calls[4]?.[2]).toMatchObject({
      body: {
        interaction: {
          channel: "agent_client",
          requestId: interactionRequestId,
          affirmation: "confirmed",
          evidenceVersion: "agent-interaction-v1",
        },
      },
    });
    for (const callIndex of [0, 1, 2, 3, 5, 6]) {
      expect(request.mock.calls[callIndex]?.[2]).toMatchObject({
        headers: { authorization: agentAuthorization },
      });
    }
    expect(request.mock.calls[4]?.[2]).not.toHaveProperty("headers.authorization");
    expect(request.mock.calls[3]?.[2]).toMatchObject({
      body: { consentRequestId: interactionRequestId },
    });
    expect(request.mock.calls.at(-1)?.[2]).toMatchObject({
      body: {
        reviewId,
        confirmationId,
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      },
    });
  });

  it("resumes from an already-reviewed draft without duplicating review or permission", async () => {
    const reviewed: ApplicationWorkspace = {
      ...workspace,
      draft: {
        ...workspace.draft,
        state: "reviewed",
        version: 4,
        answers: [
          {
            fieldKey: "full_name",
            value: "Ada Lovelace",
            provenance: "user_entered",
            sensitive: true,
            acceptedByHuman: true,
          },
          {
            fieldKey: "motivation",
            value: "Agent draft",
            provenance: "agent_suggestion",
            sensitive: false,
            acceptedByHuman: true,
          },
        ],
      },
      review: {
        id: reviewId,
        draftId,
        draftVersion: 4,
        payloadHash: "a".repeat(64),
        status: "active",
        createdAt: "2026-08-29T10:01:00.000Z",
      },
      dataGrant: {
        id: grantId,
        status: "active",
        expiresAt: "2026-08-29T10:31:00.000Z",
      },
    };
    const request = vi
      .fn()
      .mockResolvedValueOnce({ confirmationId, expiresAt: "2026-08-29T10:06:00.000Z" })
      .mockResolvedValueOnce({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted",
        externalUrl: null,
        createdAt: "2026-08-29T10:02:00.000Z",
      });

    await finalizeApplication({
      workspace: reviewed,
      values: { full_name: "Ada Lovelace", motivation: "Agent draft" },
      request,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    });

    expect(request.mock.calls.map(([url]) => url)).toEqual([
      `/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
      `/api/v1/applications/${draftId}`,
    ]);
  });
});
