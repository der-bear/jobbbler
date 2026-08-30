import { describe, expect, it, vi } from "vitest";

import type { ApplicationWorkspace } from "@jobbbler/contracts";
import type { AgentDelegationRecord } from "@jobbbler/storage";

import {
  confirmationCookie,
  handleListApplications,
  handleRequestConfirmation,
  handleStartApplication,
  handleSubmitApplication,
  type ApplicationRouteDependencies,
} from "./application-route-handlers.js";

const draftId = "application_550e8400-e29b-41d4-a716-446655440000";
const reviewId = "review_550e8400-e29b-41d4-a716-446655440000";
const confirmationId = "confirmation_550e8400-e29b-41d4-a716-446655440000";

function storedDelegation(status: "requested" | "active"): AgentDelegationRecord {
  return {
    id: "delegation_550e8400-e29b-41d4-a716-446655440000",
    ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
    agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
    resourceType: "application_draft",
    resourceId: draftId,
    operations: ["request_confirmation"],
    purpose: "Prepare this application.",
    status,
    expiresAt: "2026-08-29T10:15:00.000Z",
    createdAt: "2026-08-29T09:55:00.000Z",
    approvedAt: status === "active" ? "2026-08-29T09:56:00.000Z" : null,
    revokedAt: null,
  };
}

function workspace(
  input: Readonly<{
    delegationStatus?: "requested" | "active";
    agentSuggestion?: boolean;
  }> = {},
): ApplicationWorkspace {
  return {
    applyMode: "internal",
    draft: {
      id: draftId,
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      state: "reviewed",
      version: 3,
      answers:
        input.agentSuggestion === true
          ? [
              {
                fieldKey: "motivation",
                value: "Agent-prepared note",
                provenance: "agent_suggestion",
                sensitive: false,
                acceptedByHuman: false,
              },
            ]
          : [],
      createdAt: "2026-08-29T09:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    },
    requirements: [],
    recipient: {
      id: "organization_550e8400-e29b-41d4-a716-446655440000",
      name: "Northstar Systems",
    },
    purpose: "Submit this reviewed application to Northstar Systems.",
    noticeVersion: "privacy-2026-08-29",
    legalBasis: "consent",
    review: null,
    dataGrant: null,
    delegationRequests:
      input.delegationStatus === undefined
        ? []
        : [
            {
              id: "delegation_550e8400-e29b-41d4-a716-446655440000",
              agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
              operations: ["request_confirmation"],
              purpose: "Prepare this application.",
              status: input.delegationStatus,
              expiresAt: "2026-08-29T10:15:00.000Z",
              approvedAt: input.delegationStatus === "active" ? "2026-08-29T09:56:00.000Z" : null,
            },
          ],
    receipt: null,
  };
}

function dependencies(nodeEnv: "test" | "production" = "test"): ApplicationRouteDependencies {
  const ownerId = "owner_550e8400-e29b-41d4-a716-446655440000";
  return {
    identity: {
      environment: { NODE_ENV: nodeEnv },
      now: () => "2026-08-29T10:00:00.000Z",
      identity: {
        resolveSession: vi.fn(async () => ({
          owner: { id: "owner_550e8400-e29b-41d4-a716-446655440000" },
        })),
      },
    } as never,
    authorization: {
      identity: {
        environment: { NODE_ENV: nodeEnv, PUBLIC_BASE_URL: "https://jobbbler.test" },
        now: () => "2026-08-29T10:00:00.000Z",
        nowMs: () => Date.parse("2026-08-29T10:00:00.000Z"),
        rateLimiter: {
          check: vi.fn(async () => ({
            allowed: true,
            remaining: 4,
            retryAfterSeconds: 0,
            resetAtMs: Date.parse("2026-08-29T10:01:00.000Z"),
          })),
        },
      },
      applications: {
        getById: vi.fn(async () => ({
          id: draftId,
          ownerId,
          jobId: "job_550e8400-e29b-41d4-a716-446655440000",
          state: "reviewed",
          version: 3,
          answers: [],
          createdAt: "2026-08-29T09:00:00.000Z",
          updatedAt: "2026-08-29T10:00:00.000Z",
        })),
      },
      agentTokens: { hash: vi.fn(() => "a".repeat(64)) },
      agentSessions: {
        resolve: vi.fn(async () => ({
          id: "agent_session_550e8400-e29b-41d4-a716-446655440000",
          ownerId,
          draftId,
          tokenHash: "a".repeat(64),
          expiresAt: "2026-08-29T10:15:00.000Z",
          revokedAt: null,
          createdAt: "2026-08-29T09:55:00.000Z",
        })),
      },
      delegations: {
        listByResource: vi.fn(async () => []),
        getActiveMatch: vi.fn(async () => ({
          id: "delegation_550e8400-e29b-41d4-a716-446655440000",
          ownerId,
          agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
          resourceType: "application_draft",
          resourceId: draftId,
          operations: ["request_confirmation"],
          purpose: "Finish the reviewed application.",
          status: "active",
          expiresAt: "2026-08-29T10:15:00.000Z",
          createdAt: "2026-08-29T09:55:00.000Z",
          approvedAt: "2026-08-29T09:56:00.000Z",
          revokedAt: null,
        })),
      },
    } as never,
    operations: {
      start: vi.fn(),
      get: vi.fn(async () => workspace()),
      requestConfirmation: vi.fn(async () => ({
        id: confirmationId,
        expiresAt: "2026-08-29T10:05:00.000Z",
      })),
      submit: vi.fn(async () => ({
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "submitted" as const,
        externalUrl: null,
        createdAt: "2026-08-29T10:00:00.000Z",
      })),
    } as never,
    confirmation: { create: () => "not-returned-secret", hash: () => "a".repeat(64) },
  };
}

function request(headers: HeadersInit = {}): Request {
  return new Request(
    `https://jobbbler.test/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
    {
      method: "POST",
      headers: {
        origin: "https://jobbbler.test",
        cookie: "jobbbler_owner_session=owner",
        ...headers,
      },
    },
  );
}

function submissionRequest(): Request {
  return new Request(`https://jobbbler.test/api/v1/applications/${draftId}`, {
    method: "POST",
    headers: {
      origin: "https://jobbbler.test",
      cookie: "jobbbler_owner_session=owner; jobbbler_confirmation=confirmed",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      reviewId,
      confirmationId,
      idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
    }),
  });
}

describe("application confirmation route", () => {
  it("uses a development-safe cookie name and never returns its secret", async () => {
    const response = await handleRequestConfirmation(
      request(),
      { params: Promise.resolve({ draftId, reviewId }) },
      dependencies(),
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("jobbbler_confirmation=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    expect(JSON.stringify(await response.json())).not.toContain("not-returned-secret");
  });

  it("uses the __Host prefix only with Secure in production", async () => {
    const response = await handleRequestConfirmation(
      request(),
      { params: Promise.resolve({ draftId, reviewId }) },
      dependencies("production"),
    );
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-jobbbler_confirmation=not-returned-secret",
    );
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(
      confirmationCookie(request({ cookie: "__Host-jobbbler_confirmation=production-secret" }), {
        NODE_ENV: "production",
      }),
    ).toBe("production-secret");
  });

  it("lets an authorized agent mint the bounded server confirmation", async () => {
    const current = dependencies();
    const response = await handleRequestConfirmation(
      request({ authorization: `Bearer ${"A".repeat(43)}` }),
      { params: Promise.resolve({ draftId, reviewId }) },
      current,
    );
    expect(response.status, JSON.stringify(await response.clone().json())).toBe(201);
    expect(current.authorization.delegations.getActiveMatch).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: draftId,
        operation: "request_confirmation",
      }),
    );
    expect(current.operations.requestConfirmation).toHaveBeenCalledWith(
      "owner_550e8400-e29b-41d4-a716-446655440000",
      draftId,
      reviewId,
      "a".repeat(64),
      "2026-08-29T10:00:00.000Z",
    );
  });

  it.each([
    ["requested assistance", workspace(), [storedDelegation("requested")]],
    ["active assistance", workspace(), [storedDelegation("active")]],
    ["an agent-suggested answer", workspace({ agentSuggestion: true }), []],
  ])(
    "rejects first-party confirmation and submission after %s",
    async (_state, assisted, storedDelegations) => {
      const confirmationDependencies = dependencies();
      vi.mocked(confirmationDependencies.operations.get).mockResolvedValue(assisted);
      vi.mocked(
        confirmationDependencies.authorization.delegations.listByResource,
      ).mockResolvedValue(storedDelegations);
      const confirmation = await handleRequestConfirmation(
        request(),
        { params: Promise.resolve({ draftId, reviewId }) },
        confirmationDependencies,
      );
      expect(confirmation.status).toBe(403);
      expect(confirmationDependencies.operations.requestConfirmation).not.toHaveBeenCalled();

      const submissionDependencies = dependencies();
      vi.mocked(submissionDependencies.operations.get).mockResolvedValue(assisted);
      vi.mocked(submissionDependencies.authorization.delegations.listByResource).mockResolvedValue(
        storedDelegations,
      );
      const submission = await handleSubmitApplication(
        submissionRequest(),
        { params: Promise.resolve({ draftId }) },
        submissionDependencies,
      );
      expect(submission.status).toBe(403);
      expect(submissionDependencies.operations.submit).not.toHaveBeenCalled();
    },
  );

  it("keeps first-party confirmation and submission for a purely manual draft", async () => {
    const confirmationDependencies = dependencies();
    const confirmation = await handleRequestConfirmation(
      request(),
      { params: Promise.resolve({ draftId, reviewId }) },
      confirmationDependencies,
    );
    expect(confirmation.status).toBe(201);

    const submissionDependencies = dependencies();
    const submission = await handleSubmitApplication(
      submissionRequest(),
      { params: Promise.resolve({ draftId }) },
      submissionDependencies,
    );
    expect(submission.status).toBe(200);
    expect(submissionDependencies.operations.submit).toHaveBeenCalled();
  });
});

describe("application request bodies", () => {
  it("publishes one sanitized durable activity after creating a draft", async () => {
    const publish = vi.fn(async () => true);
    const routeDependencies: ApplicationRouteDependencies = {
      ...dependencies(),
      activity: { publish },
    };
    vi.mocked(routeDependencies.operations.start).mockResolvedValue({
      disposition: "created",
      draft: {
        id: draftId,
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        jobId: "job_550e8400-e29b-41d4-a716-446655440000",
        state: "draft",
        version: 0,
        answers: [],
        createdAt: "2026-08-29T10:00:00.000Z",
        updatedAt: "2026-08-29T10:00:00.000Z",
      },
    });

    const response = await handleStartApplication(
      new Request("https://jobbbler.test/api/v1/applications", {
        method: "POST",
        headers: {
          origin: "https://jobbbler.test",
          cookie: "jobbbler_owner_session=owner",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: "job_550e8400-e29b-41d4-a716-446655440000" }),
      }),
      routeDependencies,
    );

    expect(response.status).toBe(201);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "application",
        key: "prepare_application",
        safeSummary: "Application draft created.",
        actorKind: "human",
        aggregate: { type: "application_draft", version: 0 },
      }),
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain(draftId);
    await expect(response.json()).resolves.toMatchObject({
      ok: true,
      data: { disposition: "created", draft: { id: draftId } },
    });
  });

  it("reports an idempotent reopen without claiming another draft was created", async () => {
    const publish = vi.fn(async () => true);
    const routeDependencies: ApplicationRouteDependencies = {
      ...dependencies(),
      activity: { publish },
    };
    vi.mocked(routeDependencies.operations.start).mockResolvedValue({
      disposition: "reopened",
      draft: {
        id: draftId,
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
        jobId: "job_550e8400-e29b-41d4-a716-446655440000",
        state: "draft",
        version: 2,
        answers: [],
        createdAt: "2026-08-29T09:00:00.000Z",
        updatedAt: "2026-08-29T09:30:00.000Z",
      },
    });

    const response = await handleStartApplication(
      new Request("https://jobbbler.test/api/v1/applications", {
        method: "POST",
        headers: {
          origin: "https://jobbbler.test",
          cookie: "jobbbler_owner_session=owner",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: "job_550e8400-e29b-41d4-a716-446655440000" }),
      }),
      routeDependencies,
    );

    expect(response.status).toBe(200);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        key: "prepare_application",
        safeSummary: "Application draft reopened.",
        aggregate: { type: "application_draft", version: 2 },
      }),
    );
  });

  it("stops reading a chunked body once the physical byte cap is exceeded", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode("x".repeat(7_000)));
        if (pulls === 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const routeDependencies = dependencies();
    const response = await handleStartApplication(
      new Request("https://jobbbler.test/api/v1/applications", {
        method: "POST",
        headers: {
          origin: "https://jobbbler.test",
          cookie: "jobbbler_owner_session=owner",
          "content-type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      routeDependencies,
    );

    expect(response.status).toBe(400);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: false,
      error: { code: "VALIDATION", message: "The request body is too large." },
    });
    expect(routeDependencies.operations.start).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });
});

describe("application history route", () => {
  it("returns only the owner's safe application summaries", async () => {
    const routeDependencies = dependencies();
    const list = vi.fn(async () => [
      {
        draftId,
        state: "submitted" as const,
        updatedAt: "2026-08-29T10:00:00.000Z",
        job: {
          id: "job_550e8400-e29b-41d4-a716-446655440000",
          title: "Senior Product Engineer",
          organizationName: "Northstar Labs",
        },
      },
    ]);
    Object.assign(routeDependencies.operations, { list });

    const response = await handleListApplications(
      new Request("https://jobbbler.test/api/v1/applications", {
        headers: { cookie: "jobbbler_owner_session=owner" },
      }),
      routeDependencies,
    );

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload).toMatchObject({
      ok: true,
      data: [
        {
          draftId,
          state: "submitted",
          job: { title: "Senior Product Engineer", organizationName: "Northstar Labs" },
        },
      ],
    });
    expect(list).toHaveBeenCalledWith(
      "owner_550e8400-e29b-41d4-a716-446655440000",
      "2026-08-29T10:00:00.000Z",
    );
    expect(JSON.stringify(payload)).not.toContain("ownerId");
    expect(JSON.stringify(payload)).not.toContain("answers");
  });
});
