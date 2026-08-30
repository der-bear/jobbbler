import { describe, expect, it, vi } from "vitest";

import type { AgentOperation, ApplicationAgentState } from "@jobbbler/contracts";

import {
  createApplicationToolManifests,
  createStableApplicationToolManifests,
  type ApplicationSubmissionReviewRequest,
  type ApplicationToolDependencies,
  type ApplicationToolReadiness,
} from "./webmcp-tools";

const base: ApplicationAgentState = {
  draftId: "application_550e8400-e29b-41d4-a716-446655440000",
  jobId: "job_550e8400-e29b-41d4-a716-446655440000",
  applyMode: "internal",
  state: "draft",
  stage: "profile",
  version: 1,
  requiredFields: 5,
  completedRequiredFields: 4,
  reviewStatus: "none",
  dataPermissionStatus: "none",
  agentAuthorityStatus: "none",
  finalConfirmationReady: false,
  receiptStatus: "none",
};

const delegationRequestId = "delegation_650e8400-e29b-41d4-a716-446655440000";
const reviewRequestId = "review_850e8400-e29b-41d4-a716-446655440000";

function readiness(state: ApplicationAgentState = base): ApplicationToolReadiness {
  return {
    state,
    missingFieldKeys:
      state.completedRequiredFields === state.requiredFields ? [] : ["work_authorization"],
    missingFieldLabels:
      state.completedRequiredFields === state.requiredFields ? [] : ["Work authorization"],
    nextAction:
      state.receiptStatus !== "none"
        ? "complete"
        : state.finalConfirmationReady
          ? "submit"
          : state.completedRequiredFields === state.requiredFields
            ? "review"
            : "prepare",
  };
}

function dependencies(
  state: ApplicationAgentState,
  operations: readonly AgentOperation[] = [],
): ApplicationToolDependencies {
  let pendingReview: ApplicationSubmissionReviewRequest | null = null;
  return {
    currentReadiness: vi.fn(() => readiness(state)),
    hasAgentCredential: vi.fn(() => operations.length > 0),
    isOperationAuthorized: vi.fn((operation: AgentOperation) => operations.includes(operation)),
    requestAgentAccess: vi.fn(async (requestedOperations: readonly AgentOperation[]) => ({
      state,
      request: {
        id: delegationRequestId,
        operations: requestedOperations,
        purpose: "Prepare this application with the candidate.",
        expiresAt: "2026-08-29T10:15:00.000Z",
      },
    })),
    decideAgentAccess: vi.fn(async (_requestId: string, decision: "approved" | "declined") => ({
      state: {
        ...state,
        agentAuthorityStatus: decision === "approved" ? ("active" as const) : ("revoked" as const),
      },
      decision,
    })),
    proposeUpdates: vi.fn(async () => readiness({ ...state, version: state.version + 2 })),
    currentSubmissionReview: vi.fn(() => pendingReview),
    requestSubmissionReview: vi.fn(() => {
      pendingReview = {
        id: reviewRequestId,
        draftId: state.draftId,
        recipient: "Northstar Systems",
        purpose: "Submit this reviewed application to Northstar Systems.",
        fieldLabels: ["Full name", "Email", "Why this role", "Work authorization"],
        noticeVersion: "privacy-2026-08",
        draftVersion: state.version,
        expiresAt: "2026-08-29T10:05:00.000Z",
        href: `/apply/${state.draftId}`,
      };
      return pendingReview;
    }),
    decideSubmission: vi.fn(async (_expectedVersion: number, decision: "approved" | "declined") =>
      readiness(
        decision === "approved"
          ? {
              ...state,
              state: "submitted",
              stage: "complete",
              receiptStatus: "submitted",
            }
          : state,
      ),
    ),
    allowsAgentSubmission: vi.fn(() => true),
  };
}

function names(manifests: ReturnType<typeof createApplicationToolManifests>): string[] {
  return manifests.map(({ name }) => name);
}

describe("application WebMCP outcomes", () => {
  it("requests one bounded assistance decision and does not expose lifecycle internals", async () => {
    const deps = dependencies(base);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual([
      "get_application_readiness",
      "request_application_assistance",
    ]);
    expect(names(manifests)).not.toEqual(
      expect.arrayContaining([
        "validate_application",
        "review_application",
        "request_data_permission",
        "request_final_confirmation",
      ]),
    );

    const result = await manifests[1]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "requires_user_action",
      summary: expect.stringContaining("agent client"),
      requestId: delegationRequestId,
      nextTool: "decide_application_assistance",
      presentation: {
        title: "Let Jobbbler prepare this application?",
        confirmLabel: "Allow once",
        facts: [
          { key: "Scope", value: "This application only" },
          { key: "Purpose", value: "Prepare this application with the candidate." },
          {
            key: "Allowed actions",
            value:
              "read_application, edit_application, validate_application, review_application, request_data_consent, request_confirmation, submit_application",
          },
          { key: "Expires", value: "2026-08-29T10:15:00.000Z" },
        ],
      },
    });
    expect(deps.requestAgentAccess).toHaveBeenCalledWith(
      expect.arrayContaining([
        "read_application",
        "edit_application",
        "validate_application",
        "review_application",
      ]),
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("records the assistance decision from the agent client before exposing edits", async () => {
    const requested = { ...base, agentAuthorityStatus: "requested" as const };
    const deps = dependencies(requested);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual([
      "get_application_readiness",
      "decide_application_assistance",
    ]);

    const signal = new AbortController().signal;
    const result = await manifests[1]!.execute(
      { requestId: delegationRequestId, decision: "approved" },
      { signal },
    );
    expect(deps.decideAgentAccess).toHaveBeenCalledWith(delegationRequestId, "approved", {
      signal,
      channel: "agent_client",
    });
    expect(result).toMatchObject({
      status: "completed",
      data: {
        decision: "approved",
        agentAuthorityStatus: "active",
        nextTool: "get_application_readiness",
      },
    });
  });

  it("accepts a bounded batch of suggestions after assistance is active", async () => {
    const deps = dependencies(base, [
      "read_application",
      "edit_application",
      "validate_application",
      "review_application",
    ]);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual(["get_application_readiness", "propose_application_updates"]);

    const signal = new AbortController().signal;
    const result = await manifests[1]!.execute(
      {
        patches: [
          { fieldKey: "motivation", value: "A concise, role-specific answer." },
          { fieldKey: "portfolio_url", value: "https://example.com/work" },
        ],
      },
      { signal },
    );
    expect(deps.proposeUpdates).toHaveBeenCalledWith(
      [
        { fieldKey: "motivation", value: "A concise, role-specific answer." },
        { fieldKey: "portfolio_url", value: "https://example.com/work" },
      ],
      { signal },
    );
    expect(result).toMatchObject({ status: "completed", data: { version: 3 } });

    const duplicate = await manifests[1]!.execute(
      {
        patches: [
          { fieldKey: "motivation", value: "First" },
          { fieldKey: "motivation", value: "Second" },
        ],
      },
      { signal },
    );
    expect(duplicate).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
  });

  it("asks for one exact review in the agent client when the draft is complete", async () => {
    const ready = { ...base, completedRequiredFields: 5 };
    const deps = dependencies(ready, [
      "read_application",
      "edit_application",
      "submit_application",
    ]);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual([
      "get_application_readiness",
      "propose_application_updates",
      "request_submission_review",
    ]);

    const result = await manifests[2]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "requires_user_action",
      summary: expect.stringContaining("agent client"),
      requestId: reviewRequestId,
      nextTool: "decide_application_submission",
      userAction: { kind: "action_confirmation", surface: "application_review" },
      presentation: {
        title: "Review and submit this application?",
        confirmLabel: "Submit this application",
        facts: expect.arrayContaining([
          { key: "Recipient", value: "Northstar Systems" },
          { key: "Privacy notice", value: "privacy-2026-08" },
          { key: "Draft version", value: ready.version },
        ]),
      },
    });
    expect(names(createApplicationToolManifests(deps))).toEqual([
      "get_application_readiness",
      "propose_application_updates",
      "decide_application_submission",
    ]);
  });

  it("records the exact submission decision in one outcome tool", async () => {
    const ready = {
      ...base,
      completedRequiredFields: 5,
    };
    const operations: AgentOperation[] = [
      "read_application",
      "edit_application",
      "validate_application",
      "review_application",
      "request_data_consent",
      "request_confirmation",
      "submit_application",
    ];
    const deps = dependencies(ready, operations);
    const initial = createApplicationToolManifests(deps);
    expect(names(initial)).toEqual([
      "get_application_readiness",
      "propose_application_updates",
      "request_submission_review",
    ]);
    const signal = new AbortController().signal;
    await initial[2]!.execute({}, { signal });
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual([
      "get_application_readiness",
      "propose_application_updates",
      "decide_application_submission",
    ]);
    const result = await manifests[2]!.execute(
      { requestId: reviewRequestId, draftVersion: ready.version, decision: "approved" },
      { signal },
    );
    expect(deps.decideSubmission).toHaveBeenCalledWith(ready.version, "approved", {
      signal,
      channel: "agent_client",
    });
    expect(result).toMatchObject({ status: "completed", data: { receiptStatus: "submitted" } });
  });
});

describe("site-wide application tools", () => {
  const stableNames = [
    "get_application_readiness",
    "request_application_assistance",
    "decide_application_assistance",
    "propose_application_updates",
    "request_submission_review",
    "decide_application_submission",
    "withdraw_application_consent",
  ];

  it("keeps the reduced outcome inventory discoverable on every page", () => {
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => dependencies(base),
      readApplication: vi.fn(async () => readiness(base)),
      withdrawConsent: vi.fn(),
      onNavigate: vi.fn(),
    });
    expect(names(manifests)).toEqual(stableNames);
    expect(manifests[2]!.description).toContain("Never infer or approve this decision");
    expect(manifests[5]!.description).toContain("exact requestId and draftVersion");
    expect(manifests[6]!.description).toContain("immediately");
  });

  it("reads readiness without navigating or mounting a private page", async () => {
    const onNavigate = vi.fn();
    const readApplication = vi.fn(async () => readiness(base));
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => null,
      readApplication,
      withdrawConsent: vi.fn(),
      onNavigate,
    });
    const signal = new AbortController().signal;
    const result = await manifests[0]!.execute({ draftId: base.draftId }, { signal });

    expect(readApplication).toHaveBeenCalledWith(base.draftId, { signal });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "completed",
      data: {
        draftId: base.draftId,
        missingCount: 1,
        nextAction: "prepare",
        nextTool: "request_application_assistance",
      },
    });
  });

  it("reports legacy external drafts as read-only while preserving active consent withdrawal", async () => {
    const external = {
      ...base,
      applyMode: "external",
      dataPermissionStatus: "active",
    } as ApplicationAgentState;
    const externalReadiness = {
      ...readiness(external),
      nextAction: "withdraw",
    } as ApplicationToolReadiness;
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => null,
      readApplication: vi.fn(async () => externalReadiness),
      withdrawConsent: vi.fn(),
      onNavigate: vi.fn(),
    });

    const result = await manifests[0]!.execute(
      { draftId: external.draftId },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        applyMode: "external",
        nextAction: "withdraw",
        nextTool: "withdraw_application_consent",
      },
    });
    expect(names(createApplicationToolManifests(dependencies(external)))).toEqual([
      "get_application_readiness",
    ]);
    expect(names(manifests)).toContain("withdraw_application_consent");
  });

  it("validates ownership before an action navigates and returns structured NOT_FOUND", async () => {
    const onNavigate = vi.fn();
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => null,
      readApplication: vi.fn(async () => null),
      withdrawConsent: vi.fn(),
      onNavigate,
    });
    const result = await manifests[1]!.execute(
      { draftId: base.draftId },
      { signal: new AbortController().signal },
    );
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "NOT_FOUND", retryable: false },
    });
    expect(onNavigate).not.toHaveBeenCalled();
  });

  it("opens a verified draft for an action and returns an actionable conflict", async () => {
    const onNavigate = vi.fn();
    const surface = dependencies(base);
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => null,
      readApplication: vi.fn(async () => readiness(base)),
      withdrawConsent: vi.fn(),
      onNavigate,
      waitForSurface: vi.fn(async () => surface),
    });
    const result = await manifests[4]!.execute(
      { draftId: base.draftId },
      { signal: new AbortController().signal },
    );
    expect(onNavigate).toHaveBeenCalledWith(`/apply/${base.draftId}`);
    expect(result).toMatchObject({
      status: "failed",
      error: { code: "CONFLICT", retryable: false },
    });
  });

  it("withdraws consent directly without navigating to the application page", async () => {
    const onNavigate = vi.fn();
    const withdrawConsent = vi.fn(async () => ({
      draftId: base.draftId,
      withdrawnGrantIds: ["grant_550e8400-e29b-41d4-a716-446655440000"],
      withdrawnAt: "2026-08-29T10:05:00.000Z",
      futureConsentProcessingStopped: true as const,
      pastSubmissionUnaffected: false,
    }));
    const manifests = createStableApplicationToolManifests({
      currentSurface: () => null,
      readApplication: vi.fn(async () => readiness(base)),
      withdrawConsent,
      onNavigate,
    });

    const result = await manifests[6]!.execute(
      { draftId: base.draftId },
      { signal: new AbortController().signal },
    );

    expect(withdrawConsent).toHaveBeenCalledWith(base.draftId, {
      signal: expect.any(AbortSignal),
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: "completed",
      data: { futureConsentProcessingStopped: true },
    });
  });
});
