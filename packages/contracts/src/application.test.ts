import { describe, expect, it } from "vitest";

import {
  applicationAgentStateSchema,
  applicationConsentWithdrawalSchema,
  applicationListItemSchema,
  applicationSubmissionDecisionReceiptSchema,
  applicationSubmissionReviewRequestSchema,
  applicationWorkspaceSchema,
  requestAgentDelegationSchema,
  requestDataGrantSchema,
  setApplicationAnswersInputSchema,
  submitApplicationInputSchema,
} from "./application.js";

const draftId = "draft_550e8400-e29b-41d4-a716-446655440000";
const agentSessionId = "agent_550e8400-e29b-41d4-a716-446655440000";

describe("application authorization contracts", () => {
  it("exposes a minimal private application-list item without answers or owner identity", () => {
    const item = applicationListItemSchema.parse({
      draftId,
      state: "reviewed",
      updatedAt: "2026-08-29T10:04:00.000Z",
      job: {
        id: "job_550e8400-e29b-41d4-a716-446655440000",
        title: "Senior Product Engineer",
        organizationName: "Northstar Systems",
      },
    });

    expect(item.job.title).toBe("Senior Product Engineer");
    expect(applicationListItemSchema.safeParse({ ...item, answers: [] }).success).toBe(false);
    expect(applicationListItemSchema.safeParse({ ...item, ownerId: "owner_private" }).success).toBe(
      false,
    );
  });

  it("bounds a delegation to explicit operations, resource, purpose, and expiry", () => {
    const request = requestAgentDelegationSchema.parse({
      agentSessionId,
      draftId,
      operations: ["read_application", "edit_application"],
      purpose: "Prepare this application with the candidate.",
      requestedTtlSeconds: 900,
    });

    expect(request.operations).toEqual(["read_application", "edit_application"]);
    expect(() =>
      requestAgentDelegationSchema.parse({ ...request, requestedTtlSeconds: 86_400 }),
    ).toThrow();
  });

  it("binds a data grant to recipient, payload, notice, and legal basis", () => {
    const grant = requestDataGrantSchema.parse({
      draftId,
      recipientId: "org_550e8400-e29b-41d4-a716-446655440000",
      purpose: "Submit the reviewed application to Northstar Systems.",
      categories: ["identity", "contact", "application_answers"],
      fieldKeys: ["full_name", "email", "motivation"],
      documentIds: [],
      payloadHash: "a".repeat(64),
      noticeVersion: "privacy-2026-08-29",
      legalBasis: "consent",
    });

    expect(grant.payloadHash).toHaveLength(64);
    expect(grant.legalBasis).toBe("consent");
  });

  it("returns a bounded receipt when consent is withdrawn", () => {
    const receipt = applicationConsentWithdrawalSchema.parse({
      draftId,
      withdrawnGrantIds: ["grant_550e8400-e29b-41d4-a716-446655440000"],
      withdrawnAt: "2026-08-29T10:05:00.000Z",
      futureConsentProcessingStopped: true,
      pastSubmissionUnaffected: false,
    });

    expect(receipt.futureConsentProcessingStopped).toBe(true);
    expect(applicationConsentWithdrawalSchema.safeParse({ ...receipt, erased: true }).success).toBe(
      false,
    );
  });

  it("binds an agent-client submission decision to a server interaction request", () => {
    const requestId = "interaction_550e8400-e29b-41d4-a716-446655440000";
    const parsedRequest = applicationSubmissionReviewRequestSchema.safeParse({
      id: requestId,
      draftId,
      draftVersion: 4,
      recipient: "Northstar Systems",
      purpose: "Submit this reviewed application to Northstar Systems.",
      fields: [
        {
          fieldKey: "full_name",
          label: "Full name",
          value: "Ada Lovelace",
          sensitive: true,
        },
        {
          fieldKey: "motivation",
          label: "Why this role",
          value: "I build reliable data platforms.",
          sensitive: false,
        },
      ],
      noticeVersion: "privacy-2026-08-29",
      expiresAt: "2026-08-29T10:05:00.000Z",
    });
    expect(parsedRequest.success).toBe(true);
    if (!parsedRequest.success) return;
    const request = parsedRequest.data;
    const receipt = applicationSubmissionDecisionReceiptSchema.parse({
      requestId,
      draftId,
      decision: "approved",
      acceptedDraftVersion: 5,
      decidedAt: "2026-08-29T10:02:00.000Z",
      channel: "agent_client",
      evidenceVersion: "agent-interaction-v1",
    });

    expect(request.id).toBe(receipt.requestId);
    expect(request.fields).toEqual([
      {
        fieldKey: "full_name",
        label: "Full name",
        value: "Ada Lovelace",
        sensitive: true,
      },
      {
        fieldKey: "motivation",
        label: "Why this role",
        value: "I build reliable data platforms.",
        sensitive: false,
      },
    ]);
    expect(receipt.channel).toBe("agent_client");
  });

  it("uses a non-secret confirmation reference for submission", () => {
    const input = {
      draftId,
      reviewId: "review_550e8400-e29b-41d4-a716-446655440000",
      confirmationId: "confirm_550e8400-e29b-41d4-a716-446655440000",
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    };

    expect(submitApplicationInputSchema.parse(input)).toEqual(input);
    expect(
      submitApplicationInputSchema.safeParse({ ...input, token: "model-visible-secret" }).success,
    ).toBe(false);
  });

  it("accepts a bounded application-answer batch and rejects duplicate fields", () => {
    const answer = {
      fieldKey: "full_name",
      value: "Ada Lovelace",
      provenance: "agent_suggestion" as const,
      sensitive: true,
      acceptedByHuman: false,
    };
    const input = {
      draftId,
      expectedVersion: 3,
      answers: [answer, { ...answer, fieldKey: "email", value: "ada@example.test" }],
    };

    expect(setApplicationAnswersInputSchema.parse(input)).toEqual(input);
    expect(
      setApplicationAnswersInputSchema.safeParse({ ...input, answers: [answer, answer] }).success,
    ).toBe(false);
  });

  it("describes the visible application, exact disclosure, and current authorization state without secrets", () => {
    const workspace = {
      serverNow: "2026-08-29T10:05:00.000Z",
      applyMode: "internal",
      draft: {
        id: draftId,
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        jobId: "job_550e8400-e29b-41d4-a716-446655440000",
        state: "reviewed",
        version: 3,
        answers: [],
        createdAt: "2026-08-29T10:00:00.000Z",
        updatedAt: "2026-08-29T10:04:00.000Z",
      },
      requirements: [
        {
          fieldKey: "full_name",
          label: "Full name",
          description: "The name shared with the hiring team.",
          input: "text",
          required: true,
          sensitive: true,
          category: "identity",
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
      review: {
        id: "review_550e8400-e29b-41d4-a716-446655440000",
        draftId,
        draftVersion: 3,
        payloadHash: "b".repeat(64),
        status: "active",
        createdAt: "2026-08-29T10:04:00.000Z",
      },
      dataGrant: {
        id: "grant_550e8400-e29b-41d4-a716-446655440000",
        status: "active",
        expiresAt: "2026-08-29T10:34:00.000Z",
      },
      delegationRequests: [],
      receipt: null,
    };

    expect(applicationWorkspaceSchema.parse(workspace)).toEqual(workspace);
    expect(
      applicationWorkspaceSchema.safeParse({ ...workspace, rawConfirmationToken: "secret" })
        .success,
    ).toBe(false);
  });

  it("exposes a bounded agent state without answers or owner identity", () => {
    const state = applicationAgentStateSchema.parse({
      draftId,
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      applyMode: "internal",
      state: "reviewed",
      stage: "permission",
      version: 3,
      requiredFields: 5,
      completedRequiredFields: 5,
      reviewStatus: "active",
      dataPermissionStatus: "requested",
      agentAuthorityStatus: "active",
      finalConfirmationReady: false,
      receiptStatus: "none",
    });

    expect(state.stage).toBe("permission");
    expect(
      applicationAgentStateSchema.safeParse({ ...state, answers: [{ fieldKey: "email" }] }).success,
    ).toBe(false);
  });
});
