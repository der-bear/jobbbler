import { describe, expect, it, vi } from "vitest";

import type { ApplicationDraft } from "@jobbbler/contracts";
import type {
  AgentDelegationRecord,
  AgentSessionRecord,
  IdempotencyRecord,
  RichDataGrantRecord,
} from "@jobbbler/storage";
import { DomainError } from "@jobbbler/core-domain";

import {
  createAgentSessionTokenSecrets,
  handleApproveDataGrantRequest,
  handleApproveDelegationRequest,
  handleCreateAgentSessionRequest,
  handleCreateDataGrantRequest,
  handleCreateDelegationRequest,
  handleCreateSubmissionReviewRequest,
  handleDecideSubmissionReviewRequest,
  handleRevokeAgentSessionRequest,
  handleRevokeDelegationRequest,
  handleWithdrawApplicationConsentRequest,
  handleWithdrawDataGrantRequest,
  requireAgentOperation,
  requireCurrentDataGrant,
  type ApplicationAuthorizationRouteDependencies,
} from "./application-authorization-route-handlers";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_72000000-0000-7000-8000-000000000001";
const draftId = "application_72000000-0000-7000-8000-000000000001";
const jobId = "job_72000000-0000-7000-8000-000000000001";
const sessionId = "agent_session_72000000-0000-7000-8000-000000000001";
const delegationId = "delegation_72000000-0000-7000-8000-000000000001";
const grantId = "grant_72000000-0000-7000-8000-000000000001";
const recipientId = "organization_72000000-0000-7000-8000-000000000001";
const rawAgentToken = "A".repeat(43);
const tokenHash = "b".repeat(64);
const consentValuesHash = "e".repeat(64);
const ownerCookie = "jobbbler_owner=owner-session-token-with-at-least-thirty-two-characters";

const draft: ApplicationDraft = {
  id: draftId,
  ownerId,
  jobId,
  state: "draft",
  version: 0,
  answers: [],
  createdAt: now,
  updatedAt: now,
};

const agentSession: AgentSessionRecord = {
  id: sessionId,
  ownerId,
  draftId,
  tokenHash,
  expiresAt: "2026-08-29T10:30:00.000Z",
  revokedAt: null,
  createdAt: now,
};

const delegation: AgentDelegationRecord = {
  id: delegationId,
  ownerId,
  agentSessionId: sessionId,
  resourceType: "application_draft",
  resourceId: draftId,
  operations: ["read_application", "request_data_consent"],
  purpose: "Prepare this application with the candidate.",
  status: "requested",
  expiresAt: "2026-08-29T10:15:00.000Z",
  createdAt: now,
  approvedAt: null,
  revokedAt: null,
};

const grant: RichDataGrantRecord = {
  id: grantId,
  ownerId,
  draftId,
  recipientId,
  purpose: "Disclose the approved application fields to the employer.",
  payloadHash: "d".repeat(64),
  categories: ["identity", "application_answers"],
  fieldKeys: ["full_name", "work_authorization"],
  documentIds: ["document_72000000-0000-7000-8000-000000000001"],
  noticeVersion: "privacy-2026-08",
  legalBasis: "consent",
  status: "requested",
  expiresAt: "2026-08-29T10:10:00.000Z",
  createdAt: now,
  approvedAt: null,
  withdrawnAt: null,
};

const approvalGuard = {
  expectedGrantVersion: 0,
  expectedDraftVersion: draft.version,
  reviewId: "review_72000000-0000-7000-8000-000000000001",
  reviewPayloadHash: grant.payloadHash,
  jobId,
  jobOrganizationId: recipientId,
  jobOrganizationName: "Northstar Systems",
  jobApplyMode: "internal" as const,
};

function dependencies(): ApplicationAuthorizationRouteDependencies {
  const idempotencyRecords = new Map<string, IdempotencyRecord>();
  return {
    identity: {
      identity: {
        createEphemeralSession: vi.fn(),
        resolveSession: vi.fn(async (raw: string | null) =>
          raw === null
            ? null
            : {
                owner: {
                  id: ownerId,
                  kind: "guest" as const,
                  verified: true,
                  version: 1,
                  createdAt: now,
                  updatedAt: now,
                },
                session: {
                  id: "session_72000000-0000-7000-8000-000000000001",
                  ownerId,
                  tokenHash: "owner-hash",
                  status: "active" as const,
                  expiresAt: "2026-08-30T10:00:00.000Z",
                  lastSeenAt: now,
                  createdAt: now,
                  updatedAt: now,
                },
              },
        ),
        startEmailVerification: vi.fn(),
        completeEmailVerification: vi.fn(),
        listVerificationEndpoints: vi.fn(),
        revokeVerificationEndpoint: vi.fn(),
        startOwnerRecovery: vi.fn(),
        completeOwnerRecovery: vi.fn(),
        startOwnerDeletion: vi.fn(),
        completeOwnerDeletion: vi.fn(),
      },
      delivery: { deliverVerification: vi.fn() },
      environment: {
        NODE_ENV: "test",
        PUBLIC_BASE_URL: "https://jobbbler.example",
      },
      now: () => now,
      nowMs: () => Date.parse(now),
      rateLimiter: {
        check: vi.fn(async () => ({
          allowed: true,
          remaining: 4,
          retryAfterSeconds: 0,
          resetAtMs: Date.parse(now) + 60_000,
        })),
      },
      activity: { append: vi.fn() },
    },
    applications: {
      getById: vi.fn(async (id: string) => (id === draftId ? draft : null)),
      getByOwner: vi.fn(async (id: string, currentOwnerId: string) =>
        id === draftId && currentOwnerId === ownerId ? draft : null,
      ),
      applyMaterialEdit: vi.fn(async (input) => input.draft),
    },
    agentSessions: {
      insert: vi.fn(async (record: AgentSessionRecord) => record),
      getById: vi.fn(async () => agentSession),
      resolve: vi.fn(async () => agentSession),
      revoke: vi.fn(async () => ({ ...agentSession, revokedAt: now })),
    },
    delegations: {
      insert: vi.fn(async (record: AgentDelegationRecord) => record),
      getById: vi.fn(async () => delegation),
      listByResource: vi.fn(async () => [delegation]),
      getActiveMatch: vi.fn(async () => ({
        ...delegation,
        status: "active" as const,
        approvedAt: now,
      })),
      approve: vi.fn(async () => ({ ...delegation, status: "active" as const, approvedAt: now })),
      revoke: vi.fn(async () => ({ ...delegation, status: "revoked" as const, revokedAt: now })),
    },
    richDataGrants: {
      insert: vi.fn(async (record: RichDataGrantRecord) => record),
      getById: vi.fn(async () => grant),
      listByDraft: vi.fn(async () => [grant]),
      getCurrent: vi.fn(async () => ({ ...grant, status: "active" as const, approvedAt: now })),
      approveCurrent: vi.fn(async () => ({
        ...grant,
        status: "active" as const,
        approvedAt: now,
        version: 1,
      })),
      approve: vi.fn(async () => ({ ...grant, status: "active" as const, approvedAt: now })),
      withdraw: vi.fn(async () => ({ ...grant, status: "withdrawn" as const, withdrawnAt: now })),
    },
    idempotency: {
      get: vi.fn(
        async (scope: string, key: string) => idempotencyRecords.get(`${scope}:${key}`) ?? null,
      ),
      putIfAbsent: vi.fn(async (record: IdempotencyRecord) => {
        const key = `${record.scope}:${record.key}`;
        const existing = idempotencyRecords.get(key);
        if (existing !== undefined) return { inserted: false, record: existing };
        idempotencyRecords.set(key, record);
        return { inserted: true, record };
      }),
    },
    dataGrantPolicy: {
      consentPresentation: vi.fn(async () => ({
        recipientId,
        recipientName: "Northstar Systems",
        purpose: grant.purpose,
        categories: grant.categories,
        fieldKeys: grant.fieldKeys,
        fieldLabels: ["Full name", "Work authorization"],
        documentIds: grant.documentIds,
        noticeVersion: grant.noticeVersion,
        legalBasis: grant.legalBasis,
        valuesHash: consentValuesHash,
      })),
      assertDataGrantRequest: vi.fn(async () => undefined),
      assertStoredDataGrantCurrent: vi.fn(async () => approvalGuard),
    },
    ids: {
      agentSession: () => sessionId,
      delegation: () => delegationId,
      dataGrant: () => grantId,
      interaction: () => "interaction_740e8400-e29b-41d4-a716-446655440000",
    },
    agentTokens: {
      create: () => rawAgentToken,
      hash: () => tokenHash,
    },
  };
}

function request(
  path: string,
  method: string,
  body?: unknown,
  options: { readonly human?: boolean; readonly agent?: boolean; readonly origin?: string } = {},
): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method,
    headers: {
      origin: options.origin ?? "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      ...(options.human === true ? { cookie: ownerCookie } : {}),
      ...(options.agent === true ? { authorization: `Bearer ${rawAgentToken}` } : {}),
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

const draftContext = { params: Promise.resolve({ draftId }) };
const consentRequestId = "interaction_740e8400-e29b-41d4-a716-446655440000";

async function approveSubmissionConsent(
  current: ApplicationAuthorizationRouteDependencies,
): Promise<void> {
  const reviewRequest = await handleCreateSubmissionReviewRequest(
    request(`/api/v1/applications/${draftId}/consent`, "POST", undefined, { agent: true }),
    draftContext,
    current,
  );
  expect(reviewRequest.status, JSON.stringify(await reviewRequest.clone().json())).toBe(201);
  await expect(reviewRequest.json()).resolves.toMatchObject({
    data: {
      id: consentRequestId,
      draftId,
      draftVersion: 0,
      recipient: "Northstar Systems",
      fieldLabels: ["Full name", "Work authorization"],
    },
  });
  const decision = await handleDecideSubmissionReviewRequest(
    request(
      `/api/v1/applications/${draftId}/consent/${consentRequestId}`,
      "POST",
      {
        expectedVersion: 0,
        decision: "approved",
        interaction: {
          channel: "agent_client",
          requestId: consentRequestId,
          affirmation: "approved",
          evidenceVersion: "agent-interaction-v1",
        },
      },
      { human: true },
    ),
    { params: Promise.resolve({ draftId, requestId: consentRequestId }) },
    current,
  );
  expect(decision.status).toBe(200);
}

describe("application authorization route handlers", () => {
  it("creates a 32-byte agent token once while persisting only its SHA-256 hash", async () => {
    const actualSecrets = createAgentSessionTokenSecrets();
    const actualRaw = actualSecrets.create();
    expect(Buffer.from(actualRaw, "base64url")).toHaveLength(32);
    expect(actualSecrets.hash(actualRaw)).toMatch(/^[a-f0-9]{64}$/);

    const current = dependencies();
    const response = await handleCreateAgentSessionRequest(
      request(
        `/api/v1/applications/${draftId}/agent-sessions`,
        "POST",
        { requestedTtlSeconds: 900 },
        { human: true },
      ),
      draftContext,
      current,
    );
    const payload = (await response.json()) as { readonly data: unknown };
    const body = JSON.stringify(payload);

    expect(response.status).toBe(201);
    expect(payload.data).toEqual({
      sessionId,
      token: rawAgentToken,
      expiresAt: "2026-08-29T10:15:00.000Z",
    });
    expect(body.match(new RegExp(rawAgentToken, "g"))).toHaveLength(1);
    expect(body).not.toContain(tokenHash);
    expect(current.agentSessions.insert).toHaveBeenCalledWith({
      id: sessionId,
      ownerId,
      draftId,
      tokenHash,
      expiresAt: "2026-08-29T10:15:00.000Z",
      revokedAt: null,
      createdAt: now,
    });
    expect(current.identity.rateLimiter.check).toHaveBeenCalledTimes(1);
  });

  it("rejects cross-origin creation and applies a durable rate limit before issuing a token", async () => {
    const crossOrigin = dependencies();
    const forbidden = await handleCreateAgentSessionRequest(
      request(
        `/api/v1/applications/${draftId}/agent-sessions`,
        "POST",
        {},
        { human: true, origin: "https://attacker.example" },
      ),
      draftContext,
      crossOrigin,
    );
    expect(forbidden.status).toBe(403);
    expect(crossOrigin.agentSessions.insert).not.toHaveBeenCalled();

    const limited = dependencies();
    limited.identity.rateLimiter.check = vi.fn(async () => ({
      allowed: false,
      remaining: 0,
      retryAfterSeconds: 90,
      resetAtMs: Date.parse(now) + 90_000,
    }));
    const response = await handleCreateAgentSessionRequest(
      request(`/api/v1/applications/${draftId}/agent-sessions`, "POST", {}, { human: true }),
      draftContext,
      limited,
    );
    expect(response.status).toBe(429);
    expect(response.headers.get("retry-after")).toBe("90");
    expect(limited.agentSessions.insert).not.toHaveBeenCalled();
  });

  it("resolves an agent bearer token against the exact owner and draft before requesting delegation", async () => {
    const current = dependencies();
    const response = await handleCreateDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations`,
        "POST",
        {
          operations: ["read_application", "request_data_consent"],
          purpose: delegation.purpose,
          requestedTtlSeconds: 900,
        },
        { agent: true },
      ),
      draftContext,
      current,
    );

    expect(response.status).toBe(201);
    expect(current.agentSessions.resolve).toHaveBeenCalledWith({
      tokenHash,
      ownerId,
      draftId,
      now,
    });
    expect(current.delegations.insert).toHaveBeenCalledWith(delegation);
    const payload = (await response.json()) as { readonly data: unknown };
    expect(payload.data).toEqual({
      id: delegationId,
      agentSessionId: sessionId,
      operations: delegation.operations,
      purpose: delegation.purpose,
      status: "requested",
      expiresAt: delegation.expiresAt,
      approvedAt: null,
    });
    expect(JSON.stringify(payload)).not.toContain(rawAgentToken);
  });

  it("fails closed when a persisted authorization boundary is not a valid instant", async () => {
    const current = dependencies();
    current.agentSessions.resolve = vi.fn(async () => ({
      ...agentSession,
      expiresAt: "not-an-instant",
    }));
    const response = await handleCreateDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations`,
        "POST",
        {
          operations: ["read_application"],
          purpose: "Read this application draft.",
          requestedTtlSeconds: 900,
        },
        { agent: true },
      ),
      draftContext,
      current,
    );

    expect(response.status).toBe(409);
    expect(current.delegations.insert).not.toHaveBeenCalled();
  });

  it("requires a live active delegation for the requested agent operation", async () => {
    const current = dependencies();
    await expect(
      requireAgentOperation(
        request(`/api/v1/applications/${draftId}`, "POST", {}, { agent: true }),
        draftId,
        "request_data_consent",
        current,
      ),
    ).resolves.toMatchObject({ session: { id: sessionId }, delegation: { id: delegationId } });
    expect(current.delegations.getActiveMatch).toHaveBeenCalledWith({
      ownerId,
      agentSessionId: sessionId,
      resourceType: "application_draft",
      resourceId: draftId,
      operation: "request_data_consent",
      now,
    });

    current.delegations.getActiveMatch = vi.fn(async () => null);
    await expect(
      requireAgentOperation(
        request(`/api/v1/applications/${draftId}`, "POST", {}, { agent: true }),
        draftId,
        "request_data_consent",
        current,
      ),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("persists and approves the complete exact data disclosure scope without exposing token material", async () => {
    const current = dependencies();
    await approveSubmissionConsent(current);

    const created = await handleCreateDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants`,
        "POST",
        {
          recipientId,
          purpose: grant.purpose,
          payloadHash: grant.payloadHash,
          categories: grant.categories,
          fieldKeys: grant.fieldKeys,
          documentIds: grant.documentIds,
          noticeVersion: grant.noticeVersion,
          legalBasis: grant.legalBasis,
          consentRequestId,
          requestedTtlSeconds: 600,
        },
        { agent: true },
      ),
      draftContext,
      current,
    );
    expect(created.status).toBe(201);
    expect(current.dataGrantPolicy.assertDataGrantRequest).toHaveBeenCalledWith({
      ownerId,
      draftId,
      request: {
        recipientId,
        purpose: grant.purpose,
        payloadHash: grant.payloadHash,
        categories: grant.categories,
        fieldKeys: grant.fieldKeys,
        documentIds: grant.documentIds,
        noticeVersion: grant.noticeVersion,
        legalBasis: grant.legalBasis,
      },
    });
    expect(current.richDataGrants.insert).toHaveBeenCalledWith({
      ...grant,
      approvalRequestId: consentRequestId,
    });
    const createdPayload = (await created.json()) as { readonly data: unknown };
    expect(createdPayload.data).toEqual({
      id: grantId,
      status: "requested",
      expiresAt: grant.expiresAt,
    });
    expect(JSON.stringify(createdPayload)).not.toContain(rawAgentToken);

    const approved = await handleApproveDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants/${grantId}/approve`,
        "POST",
        {
          interaction: {
            channel: "first_party_ui",
            requestId: grantId,
            affirmation: "confirmed",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, grantId }) },
      current,
    );
    expect(approved.status).toBe(200);
    expect(current.dataGrantPolicy.assertStoredDataGrantCurrent).toHaveBeenCalledWith(grant);
    expect(current.richDataGrants.approveCurrent).toHaveBeenCalledWith({
      id: grantId,
      ownerId,
      draftId,
      at: now,
      approvalEvidence: {
        channel: "first_party_ui",
        requestId: grantId,
        affirmativeAction: "confirmed",
        evidenceVersion: "agent-interaction-v1",
      },
      ...approvalGuard,
    });

    await expect(
      requireCurrentDataGrant(
        {
          ownerId,
          draftId,
          recipientId,
          purpose: grant.purpose,
          payloadHash: grant.payloadHash,
          categories: grant.categories,
          fieldKeys: grant.fieldKeys,
          documentIds: grant.documentIds,
          noticeVersion: grant.noticeVersion,
          legalBasis: grant.legalBasis,
        },
        current,
      ),
    ).resolves.toMatchObject({ id: grantId, status: "active" });
    expect(current.richDataGrants.getCurrent).toHaveBeenCalledWith({
      ownerId,
      draftId,
      recipientId,
      purpose: grant.purpose,
      payloadHash: grant.payloadHash,
      categories: grant.categories,
      fieldKeys: grant.fieldKeys,
      documentIds: grant.documentIds,
      noticeVersion: grant.noticeVersion,
      legalBasis: grant.legalBasis,
      now,
    });
  });

  it("rejects a disclosure whose recipient, purpose, notice, or fields drift after approval", async () => {
    const current = dependencies();
    await approveSubmissionConsent(current);

    const response = await handleCreateDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants`,
        "POST",
        {
          recipientId,
          purpose: "Disclose these fields for an unrelated purpose.",
          payloadHash: grant.payloadHash,
          categories: grant.categories,
          fieldKeys: grant.fieldKeys,
          documentIds: grant.documentIds,
          noticeVersion: grant.noticeVersion,
          legalBasis: grant.legalBasis,
          consentRequestId,
          requestedTtlSeconds: 600,
        },
        { agent: true },
      ),
      draftContext,
      current,
    );

    expect(response.status).toBe(409);
    expect(current.richDataGrants.insert).not.toHaveBeenCalled();
  });

  it("stores an agent-client approval as server-side consent evidence", async () => {
    const current = dependencies();
    const interactionRequestId = "interaction_750e8400-e29b-41d4-a716-446655440000";
    current.richDataGrants.getById = vi.fn(async () => ({
      ...grant,
      approvalRequestId: interactionRequestId,
    }));
    const response = await handleApproveDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants/${grantId}/approve`,
        "POST",
        {
          interaction: {
            channel: "agent_client",
            requestId: interactionRequestId,
            affirmation: "confirmed",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, grantId }) },
      current,
    );

    expect(response.status).toBe(200);
    expect(current.richDataGrants.approveCurrent).toHaveBeenCalledWith({
      id: grantId,
      ownerId,
      draftId,
      at: now,
      approvalEvidence: {
        channel: "agent_client",
        requestId: interactionRequestId,
        affirmativeAction: "confirmed",
        evidenceVersion: "agent-interaction-v1",
      },
      ...approvalGuard,
    });
  });

  it("rejects agent-client consent evidence that is not bound to an interaction request", async () => {
    const current = dependencies();
    current.richDataGrants.getById = vi.fn(async () => ({
      ...grant,
      approvalRequestId: "interaction_750e8400-e29b-41d4-a716-446655440099",
    }));
    const response = await handleApproveDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants/${grantId}/approve`,
        "POST",
        {
          interaction: {
            channel: "agent_client",
            requestId: grantId,
            affirmation: "confirmed",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, grantId }) },
      current,
    );

    expect(response.status).toBe(400);
    expect(current.richDataGrants.approveCurrent).not.toHaveBeenCalled();
  });

  it("withdraws every live consent grant in one agent-client action and stores evidence", async () => {
    const current = dependencies();
    const interactionRequestId = "interaction_760e8400-e29b-41d4-a716-446655440000";
    current.richDataGrants.listByDraft = vi.fn(async () => [
      { ...grant, status: "active" as const, approvedAt: now },
      {
        ...grant,
        id: "grant_760e8400-e29b-41d4-a716-446655440001",
        legalBasis: "user_instruction" as const,
      },
    ]);

    const response = await handleWithdrawApplicationConsentRequest(
      request(
        `/api/v1/applications/${draftId}/consent`,
        "DELETE",
        {
          interaction: {
            channel: "agent_client",
            requestId: interactionRequestId,
            affirmation: "withdrawn",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      draftContext,
      current,
    );

    expect(response.status).toBe(200);
    expect(current.richDataGrants.withdraw).toHaveBeenCalledTimes(1);
    expect(current.richDataGrants.withdraw).toHaveBeenCalledWith(grantId, ownerId, draftId, now, {
      channel: "agent_client",
      requestId: interactionRequestId,
      action: "withdrawn",
      evidenceVersion: "agent-interaction-v1",
    });
    expect(current.applications.applyMaterialEdit).toHaveBeenCalledWith({
      ownerId,
      expectedVersion: draft.version,
      draft: expect.objectContaining({
        id: draftId,
        state: "draft",
        version: draft.version + 1,
        consentRevision: 1,
      }),
      now,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: {
        draftId,
        withdrawnGrantIds: [grantId],
        futureConsentProcessingStopped: true,
      },
    });
  });

  it("blocks scope drift before storing a grant and stale review approval before activation", async () => {
    const drifted = dependencies();
    drifted.dataGrantPolicy.assertDataGrantRequest = vi.fn(async () => {
      throw new DomainError({
        code: "CONFLICT",
        message: "The request does not match the exact reviewed disclosure.",
      });
    });
    const driftedResponse = await handleCreateDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants`,
        "POST",
        {
          recipientId,
          purpose: grant.purpose,
          payloadHash: grant.payloadHash,
          categories: grant.categories,
          fieldKeys: [...grant.fieldKeys, "email"],
          documentIds: grant.documentIds,
          noticeVersion: grant.noticeVersion,
          legalBasis: grant.legalBasis,
          requestedTtlSeconds: 600,
        },
        { agent: true },
      ),
      draftContext,
      drifted,
    );

    expect(driftedResponse.status).toBe(409);
    expect(drifted.richDataGrants.insert).not.toHaveBeenCalled();
    expect(drifted.dataGrantPolicy.assertDataGrantRequest).toHaveBeenCalledWith({
      ownerId,
      draftId,
      request: expect.objectContaining({ fieldKeys: [...grant.fieldKeys, "email"] }),
    });

    const stale = dependencies();
    stale.dataGrantPolicy.assertStoredDataGrantCurrent = vi.fn(async () => {
      throw new DomainError({
        code: "CONFLICT",
        message: "The request does not match the exact reviewed disclosure.",
      });
    });
    const staleResponse = await handleApproveDataGrantRequest(
      request(`/api/v1/applications/${draftId}/data-grants/${grantId}/approve`, "POST", undefined, {
        human: true,
      }),
      { params: Promise.resolve({ draftId, grantId }) },
      stale,
    );

    expect(staleResponse.status).toBe(409);
    expect(stale.dataGrantPolicy.assertStoredDataGrantCurrent).toHaveBeenCalledWith(grant);
    expect(stale.richDataGrants.approveCurrent).not.toHaveBeenCalled();
  });

  it("keeps approval human-only and binds revocation or withdrawal to the owner and draft", async () => {
    const current = dependencies();
    const agentOnly = await handleApproveDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations/${delegationId}/approve`,
        "POST",
        undefined,
        { agent: true },
      ),
      { params: Promise.resolve({ draftId, delegationId }) },
      current,
    );
    expect(agentOnly.status).toBe(403);
    expect(current.delegations.approve).not.toHaveBeenCalled();

    const mixedCredentials = await handleApproveDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations/${delegationId}/approve`,
        "POST",
        undefined,
        { agent: true, human: true },
      ),
      { params: Promise.resolve({ draftId, delegationId }) },
      current,
    );
    expect(mixedCredentials.status).toBe(403);
    expect(current.delegations.approve).not.toHaveBeenCalled();

    const revokedSession = await handleRevokeAgentSessionRequest(
      request(`/api/v1/applications/${draftId}/agent-sessions/${sessionId}`, "DELETE", undefined, {
        human: true,
      }),
      { params: Promise.resolve({ draftId, sessionId }) },
      current,
    );
    expect(revokedSession.status).toBe(200);
    expect(current.agentSessions.revoke).toHaveBeenCalledWith(sessionId, ownerId, draftId, now);

    const withdrawn = await handleWithdrawDataGrantRequest(
      request(`/api/v1/applications/${draftId}/data-grants/${grantId}`, "DELETE", undefined, {
        human: true,
      }),
      { params: Promise.resolve({ draftId, grantId }) },
      current,
    );
    expect(withdrawn.status).toBe(200);
    expect(current.richDataGrants.withdraw).toHaveBeenCalledWith(grantId, ownerId, draftId, now);
  });

  it("persists the exact agent-client decision for a bounded assistance request", async () => {
    const current = dependencies();
    const approved = await handleApproveDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations/${delegationId}/approve`,
        "POST",
        {
          interaction: {
            channel: "agent_client",
            requestId: delegationId,
            affirmation: "approved",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, delegationId }) },
      current,
    );

    expect(approved.status).toBe(200);
    expect(current.delegations.approve).toHaveBeenCalledWith(delegationId, ownerId, now, {
      channel: "agent_client",
      requestId: delegationId,
      action: "approved",
      evidenceVersion: "agent-interaction-v1",
    });

    const declinedDependencies = dependencies();
    const declined = await handleRevokeDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations/${delegationId}`,
        "DELETE",
        {
          interaction: {
            channel: "agent_client",
            requestId: delegationId,
            affirmation: "declined",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, delegationId }) },
      declinedDependencies,
    );

    expect(declined.status).toBe(200);
    expect(declinedDependencies.delegations.revoke).toHaveBeenCalledWith(
      delegationId,
      ownerId,
      now,
      {
        channel: "agent_client",
        requestId: delegationId,
        action: "declined",
        evidenceVersion: "agent-interaction-v1",
      },
    );
  });

  it("rejects assistance decisions that are not bound to the exact request", async () => {
    const current = dependencies();
    const response = await handleApproveDelegationRequest(
      request(
        `/api/v1/applications/${draftId}/delegations/${delegationId}/approve`,
        "POST",
        {
          interaction: {
            channel: "agent_client",
            requestId: "delegation_740e8400-e29b-41d4-a716-446655440001",
            affirmation: "approved",
            evidenceVersion: "agent-interaction-v1",
          },
        },
        { human: true },
      ),
      { params: Promise.resolve({ draftId, delegationId }) },
      current,
    );

    expect(response.status).toBe(400);
    expect(current.delegations.approve).not.toHaveBeenCalled();
  });

  it("rejects malformed agent tokens and unsupported data-grant fields without echoing input", async () => {
    const current = dependencies();
    const malformed = await handleCreateDelegationRequest(
      new Request(`https://jobbbler.example/api/v1/applications/${draftId}/delegations`, {
        method: "POST",
        headers: {
          origin: "https://jobbbler.example",
          "sec-fetch-site": "same-origin",
          authorization: "Bearer short-secret",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          operations: ["read_application"],
          purpose: "Read the draft.",
          requestedTtlSeconds: 600,
        }),
      }),
      draftContext,
      current,
    );
    expect(malformed.status).toBe(401);
    expect(JSON.stringify(await malformed.json())).not.toContain("short-secret");

    const invalidGrant = await handleCreateDataGrantRequest(
      request(
        `/api/v1/applications/${draftId}/data-grants`,
        "POST",
        {
          recipientId,
          purpose: grant.purpose,
          payloadHash: grant.payloadHash,
          categories: grant.categories,
          fieldKeys: grant.fieldKeys,
          documentIds: grant.documentIds,
          noticeVersion: grant.noticeVersion,
          legalBasis: grant.legalBasis,
          requestedTtlSeconds: 600,
          unexpectedSecret: "must-not-pass-validation",
        },
        { agent: true },
      ),
      draftContext,
      current,
    );
    expect(invalidGrant.status).toBe(400);
    expect(current.richDataGrants.insert).not.toHaveBeenCalled();
  });
});
