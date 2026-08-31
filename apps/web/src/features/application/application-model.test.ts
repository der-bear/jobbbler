import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ApplicationWorkspace } from "@jobbbler/contracts";

import {
  applicationAgentState,
  applicationDisclosure,
  applicationDisclosureForValues,
  applicationNextAction,
  applicationReadiness,
  applicationReadinessForValues,
  applicationStage,
  bindApplicationServerClock,
  createApplicationAgentAuthorization,
  createServerDerivedApplicationClock,
  isAgentAssistedApplication,
  mountApplicationExpiryClock,
  visibleApplicationProgress,
} from "./application-model";

const base: ApplicationWorkspace = {
  serverNow: "2026-08-29T10:02:00.000Z",
  applyMode: "internal",
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
      fieldKey: "cover_letter",
      label: "Cover letter",
      description: "A short note for the hiring team.",
      input: "textarea",
      required: true,
      sensitive: true,
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
    expect(applicationStage(base, base.serverNow)).toBe("profile");
    expect(
      applicationStage({ ...base, draft: { ...base.draft, state: "valid" } }, base.serverNow),
    ).toBe("review");
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
    expect(applicationStage(reviewed, base.serverNow)).toBe("permission");
    expect(
      applicationStage(
        {
          ...reviewed,
          dataGrant: {
            id: "grant_550e8400-e29b-41d4-a716-446655440000",
            status: "active",
            expiresAt: "2026-08-29T10:32:00.000Z",
          },
        },
        base.serverNow,
      ),
    ).toBe("confirmation");
    expect(
      applicationStage(
        {
          ...reviewed,
          receipt: {
            id: "receipt_550e8400-e29b-41d4-a716-446655440000",
            status: "submitted",
            externalUrl: null,
            createdAt: "2026-08-29T10:03:00.000Z",
            submission: {
              provider: "jobbbler_demo",
              providerReferenceId: "demo_submission_550e8400-e29b-41d4-a716-446655440000",
              role: { id: base.draft.jobId, title: "Senior Platform Engineer" },
              recipient: base.recipient,
              submittedAt: "2026-08-29T10:03:00.000Z",
              fields: [{ fieldKey: "full_name", label: "Full name", value: "Ada Lovelace" }],
            },
          },
        },
        base.serverNow,
      ),
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
            fieldKey: "cover_letter",
            value: "Suggested text",
            provenance: "agent_suggestion",
            sensitive: true,
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
      missingFieldKeys: ["cover_letter"],
      readyForReview: false,
    });
  });

  it("updates readiness from the values currently visible in the application", () => {
    expect(
      applicationReadinessForValues(base, {
        full_name: "Ada Lovelace",
        cover_letter: "A role-specific answer",
      }),
    ).toEqual({
      completed: 2,
      required: 2,
      missingFieldKeys: [],
      readyForReview: true,
    });

    expect(
      applicationReadinessForValues(base, {
        full_name: "   ",
        cover_letter: "A role-specific answer",
      }).missingFieldKeys,
    ).toEqual(["full_name"]);
  });

  it("describes the exact non-empty values currently visible before submission", () => {
    expect(
      applicationDisclosureForValues(base, {
        full_name: "Ada Lovelace",
        cover_letter: "A role-specific answer",
      }),
    ).toEqual({
      fieldKeys: ["full_name", "cover_letter"],
      categories: ["identity", "application_answers"],
      sensitiveFieldKeys: ["full_name", "cover_letter"],
    });
  });

  it("gives agents only workflow state, never answers or owner identity", () => {
    const state = applicationAgentState(base, false, base.serverNow);
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

  it.each(["requested", "active"] as const)(
    "treats an expired %s delegation as manual in the UI model",
    (status) => {
      const expiredWorkspace: ApplicationWorkspace = {
        ...base,
        delegationRequests: [
          {
            id: "delegation_550e8400-e29b-41d4-a716-446655440000",
            agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
            operations: ["edit_application"],
            purpose: "Prepare this application.",
            status,
            expiresAt: "2026-08-29T10:01:59.999Z",
            approvedAt: status === "active" ? "2026-08-29T10:01:00.000Z" : null,
          },
        ],
      };

      expect(isAgentAssistedApplication(expiredWorkspace, expiredWorkspace.serverNow)).toBe(false);
      expect(
        applicationAgentState(expiredWorkspace, false, expiredWorkspace.serverNow)
          .agentAuthorityStatus,
      ).toBe("none");
    },
  );

  it.each([
    { status: "revoked" as const, expiresAt: "2026-08-29T10:15:00.000Z" },
    { status: "requested" as const, expiresAt: "2026-08-29T10:01:59.999Z" },
    { status: "active" as const, expiresAt: "2026-08-29T10:01:59.999Z" },
  ])("allows human takeover of agent suggestions after $status assistance ends", (delegation) => {
    const endedWorkspace: ApplicationWorkspace = {
      ...base,
      draft: {
        ...base.draft,
        answers: [
          {
            ...base.draft.answers[0]!,
            provenance: "agent_suggestion",
            acceptedByHuman: false,
          },
        ],
      },
      delegationRequests: [
        {
          id: "delegation_550e8400-e29b-41d4-a716-446655440000",
          agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
          operations: ["edit_application"],
          purpose: "Prepare this application.",
          approvedAt: delegation.status === "active" ? "2026-08-29T10:01:00.000Z" : null,
          ...delegation,
        },
      ],
    };

    expect(isAgentAssistedApplication(endedWorkspace, endedWorkspace.serverNow)).toBe(false);
  });

  it("makes a legacy external draft read-only and recommends only active consent withdrawal", () => {
    const external: ApplicationWorkspace = { ...base, applyMode: "external" };
    expect(applicationStage(external, external.serverNow)).toBe("legacy_external");
    expect(applicationAgentState(external, false, external.serverNow).applyMode).toBe("external");
    expect(applicationNextAction(external, external.serverNow)).toBe("read_only");
    expect(
      applicationNextAction(
        {
          ...external,
          dataGrant: {
            id: "grant_550e8400-e29b-41d4-a716-446655440000",
            status: "active",
            expiresAt: "2026-08-29T10:34:00.000Z",
          },
        },
        external.serverNow,
      ),
    ).toBe("withdraw");
  });

  it("makes a closed nonterminal role read-only while preserving only consent withdrawal", () => {
    expect(applicationStage(base, base.serverNow, "closed")).toBe("closed");
    expect(applicationAgentState(base, false, base.serverNow, "closed").stage).toBe("closed");
    expect(applicationNextAction(base, base.serverNow, false, "closed")).toBe("read_only");
    expect(
      applicationNextAction(
        {
          ...base,
          dataGrant: {
            id: "grant_550e8400-e29b-41d4-a716-446655440000",
            status: "active",
            expiresAt: "2026-08-29T10:34:00.000Z",
          },
        },
        base.serverNow,
        false,
        "closed",
      ),
    ).toBe("withdraw");

    const submitted = {
      ...base,
      draft: { ...base.draft, state: "submitted" as const },
    };
    expect(applicationStage(submitted, submitted.serverNow, "closed")).toBe("complete");
    expect(applicationNextAction(submitted, submitted.serverNow, false, "closed")).toBe("complete");
  });

  it("keeps a terminal legacy external handoff complete without hiding independent withdrawal", () => {
    const completedExternal: ApplicationWorkspace = {
      ...base,
      applyMode: "external",
      draft: { ...base.draft, state: "handed_off" },
      dataGrant: {
        id: "grant_550e8400-e29b-41d4-a716-446655440000",
        status: "active",
        expiresAt: "2026-08-29T10:34:00.000Z",
      },
      receipt: {
        id: "receipt_550e8400-e29b-41d4-a716-446655440000",
        status: "handed_off",
        externalUrl: "https://jobs.example.test/opening/42",
        createdAt: "2026-08-29T10:03:00.000Z",
      },
    };

    expect(applicationStage(completedExternal, completedExternal.serverNow)).toBe("complete");
    expect(applicationNextAction(completedExternal, completedExternal.serverNow)).toBe("complete");
  });
});

describe("mounted application authorization clock", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("derives advancing time from the server anchor and monotonic elapsed time", () => {
    let monotonicMilliseconds = 100;
    vi.setSystemTime("2040-01-01T00:00:00.000Z");
    const clock = createServerDerivedApplicationClock(base.serverNow, () => monotonicMilliseconds);

    expect(clock.now()).toBe("2026-08-29T10:02:00.000Z");
    vi.setSystemTime("1990-01-01T00:00:00.000Z");
    monotonicMilliseconds = 1_100;
    expect(clock.now()).toBe("2026-08-29T10:02:01.000Z");
    monotonicMilliseconds = 600;
    expect(clock.now()).toBe("2026-08-29T10:02:01.000Z");
  });

  it("starts a new server anchor when the mounted draft changes", () => {
    let monotonicMilliseconds = 0;
    const first = bindApplicationServerClock(null, base, () => monotonicMilliseconds);
    monotonicMilliseconds = 60_000;
    expect(first.clock.now()).toBe("2026-08-29T10:03:00.000Z");
    const second = bindApplicationServerClock(
      first,
      {
        ...base,
        serverNow: "2026-08-29T09:00:00.000Z",
        draft: { ...base.draft, id: "draft_650e8400-e29b-41d4-a716-446655440000" },
      },
      () => monotonicMilliseconds,
    );

    expect(second.draftId).toBe("draft_650e8400-e29b-41d4-a716-446655440000");
    expect(second.clock.now()).toBe("2026-08-29T09:00:00.000Z");
  });

  it("reclassifies mounted readiness at each delegation and grant expiry", () => {
    let monotonicMilliseconds = 0;
    const expiring: ApplicationWorkspace = {
      ...base,
      draft: { ...base.draft, state: "reviewed" },
      review: {
        id: "review_550e8400-e29b-41d4-a716-446655440000",
        draftId: base.draft.id,
        draftVersion: base.draft.version,
        payloadHash: "a".repeat(64),
        status: "active",
        createdAt: base.serverNow,
      },
      dataGrant: {
        id: "grant_550e8400-e29b-41d4-a716-446655440000",
        status: "active",
        expiresAt: "2026-08-29T10:02:02.000Z",
      },
      delegationRequests: [
        {
          id: "delegation_550e8400-e29b-41d4-a716-446655440000",
          agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
          operations: ["edit_application"],
          purpose: "Prepare this application.",
          status: "requested",
          expiresAt: "2026-08-29T10:02:01.000Z",
          approvedAt: null,
        },
      ],
    };
    const clock = createServerDerivedApplicationClock(
      expiring.serverNow,
      () => monotonicMilliseconds,
    );
    const observedStates = [applicationAgentState(expiring, false, clock.now())];
    const stop = mountApplicationExpiryClock({
      workspace: expiring,
      clock,
      onTick: (now) => observedStates.push(applicationAgentState(expiring, false, now)),
    });

    monotonicMilliseconds = 999;
    vi.advanceTimersByTime(999);
    expect(observedStates).toHaveLength(1);
    monotonicMilliseconds = 1_000;
    vi.advanceTimersByTime(1);
    expect(observedStates.at(-1)).toMatchObject({
      agentAuthorityStatus: "none",
      dataPermissionStatus: "active",
      stage: "confirmation",
    });
    monotonicMilliseconds = 2_000;
    vi.advanceTimersByTime(1_000);
    expect(observedStates.at(-1)).toMatchObject({
      agentAuthorityStatus: "none",
      dataPermissionStatus: "none",
      stage: "permission",
    });
    stop();
  });

  it("reclassifies at a credential-only expiry when no grant or delegation is live", () => {
    let monotonicMilliseconds = 0;
    const clock = createServerDerivedApplicationClock(base.serverNow, () => monotonicMilliseconds);
    const observed: string[] = [];
    const stop = mountApplicationExpiryClock({
      workspace: base,
      clock,
      additionalExpiries: ["2026-08-29T10:02:01.000Z"],
      onTick: (now) => observed.push(now),
    });

    monotonicMilliseconds = 999;
    vi.advanceTimersByTime(999);
    expect(observed).toEqual([]);
    monotonicMilliseconds = 1_000;
    vi.advanceTimersByTime(1);
    expect(observed).toEqual(["2026-08-29T10:02:01.000Z"]);
    stop();
  });

  it("re-evaluates a held credential at every authorization invocation", () => {
    let now = base.serverNow;
    const sessionId = "agent_session_550e8400-e29b-41d4-a716-446655440000";
    const authorization = createApplicationAgentAuthorization({
      workspace: {
        ...base,
        delegationRequests: [
          {
            id: "delegation_550e8400-e29b-41d4-a716-446655440000",
            agentSessionId: sessionId,
            operations: ["edit_application"],
            purpose: "Prepare this application.",
            status: "active",
            expiresAt: "2026-08-29T10:12:00.000Z",
            approvedAt: base.serverNow,
          },
        ],
      },
      credential: {
        sessionId,
        token: "credential-token",
        expiresAt: "2026-08-29T10:02:01.000Z",
      },
      currentTime: () => now,
    });

    expect(authorization.currentCredential()?.token).toBe("credential-token");
    expect(authorization.isOperationAuthorized("edit_application")).toBe(true);

    now = "2026-08-29T10:02:01.000Z";
    expect(authorization.currentCredential()).toBeNull();
    expect(authorization.isOperationAuthorized("edit_application")).toBe(false);
  });
});
