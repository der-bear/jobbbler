import { describe, expect, it, vi } from "vitest";

import type { AgentOperation, ApplicationAgentState } from "@jobbbler/contracts";

import { createApplicationToolManifests } from "./webmcp-tools";

const base: ApplicationAgentState = {
  draftId: "application_550e8400-e29b-41d4-a716-446655440000",
  jobId: "job_550e8400-e29b-41d4-a716-446655440000",
  state: "draft",
  stage: "profile",
  version: 1,
  requiredFields: 5,
  completedRequiredFields: 1,
  reviewStatus: "none",
  dataPermissionStatus: "none",
  agentAuthorityStatus: "none",
  finalConfirmationReady: false,
  receiptStatus: "none",
};

const delegationRequestId = "delegation_650e8400-e29b-41d4-a716-446655440000";
const consentRequestId = "grant_750e8400-e29b-41d4-a716-446655440000";
const reviewRequestId = "review_850e8400-e29b-41d4-a716-446655440000";

function dependencies(state: ApplicationAgentState, operations: readonly AgentOperation[] = []) {
  return {
    currentState: vi.fn(() => state),
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
    approveAgentAccess: vi.fn(async () => ({ ...state, agentAuthorityStatus: "active" as const })),
    setAnswer: vi.fn(async () => ({ ...state, version: state.version + 1 })),
    validate: vi.fn(async () => ({ ...state, state: "valid" as const, stage: "review" as const })),
    review: vi.fn(async () => ({
      ...state,
      state: "reviewed" as const,
      stage: "permission" as const,
    })),
    requestDataPermission: vi.fn(async () => ({
      state,
      request: {
        id: consentRequestId,
        recipient: "Northstar Systems",
        purpose: "Submit this reviewed application.",
        categories: ["identity", "application answers"],
        fieldKeys: ["full name", "email", "motivation"],
        noticeVersion: "privacy-2026-08",
        expiresAt: "2026-08-29T10:15:00.000Z",
      },
    })),
    approveDataPermission: vi.fn(async () => ({
      ...state,
      dataPermissionStatus: "active" as const,
    })),
    finalConfirmationRequest: vi.fn(() => ({
      id: reviewRequestId,
      recipient: "Northstar Systems",
      purpose: "Submit this reviewed application.",
      categories: ["identity", "application answers"],
      fieldKeys: ["full name", "email", "motivation"],
      noticeVersion: "privacy-2026-08",
    })),
    confirmFinalApplication: vi.fn(async () => ({
      ...state,
      finalConfirmationReady: true,
    })),
    submit: vi.fn(async () => ({
      ...state,
      state: "submitted" as const,
      stage: "complete" as const,
      receiptStatus: "submitted" as const,
    })),
    allowsAgentSubmission: vi.fn(() => true),
    fieldKeys: ["full_name", "email", "motivation"] as const,
  };
}

function names(manifests: ReturnType<typeof createApplicationToolManifests>): string[] {
  return manifests.map(({ name }) => name);
}

describe("application-route WebMCP tools", () => {
  it("starts with a safe state reader and a least-privilege authority request", async () => {
    const deps = dependencies(base);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual(["get_application_state", "request_application_access"]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([true, false]);

    const result = await manifests[1]!.execute({}, { signal: new AbortController().signal });
    expect(deps.requestAgentAccess).toHaveBeenCalledWith(
      ["read_application", "edit_application", "validate_application"],
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
    expect(result).toMatchObject({
      status: "requires_user_action",
      requestId: delegationRequestId,
      userAction: { kind: "agent_authorization", surface: "application_authorization" },
      presentation: {
        title: "Allow application assistance?",
        confirmLabel: "Allow these actions",
      },
    });
    expect(JSON.stringify(result)).not.toContain("token");
  });

  it("records agent-mediated approval only after a pending authority request", async () => {
    const requested = { ...base, agentAuthorityStatus: "requested" as const };
    const deps = dependencies(requested, ["read_application"]);
    const manifests = createApplicationToolManifests(deps);

    expect(names(manifests)).toEqual(["get_application_state", "approve_application_access"]);
    const result = await manifests[1]!.execute(
      { requestId: delegationRequestId, confirmed: true },
      { signal: new AbortController().signal },
    );

    expect(deps.approveAgentAccess).toHaveBeenCalledWith(delegationRequestId, {
      signal: expect.any(AbortSignal),
    });
    expect(result).toMatchObject({ status: "completed", data: { agentAuthorityStatus: "active" } });
  });

  it("exposes strict profile tools only after matching authority", async () => {
    const deps = dependencies(base, [
      "read_application",
      "edit_application",
      "validate_application",
    ]);
    const manifests = createApplicationToolManifests(deps);
    expect(names(manifests)).toEqual([
      "get_application_state",
      "set_application_answer",
      "validate_application",
    ]);

    const signal = new AbortController().signal;
    const updated = await manifests[1]!.execute(
      { fieldKey: "motivation", value: "A concise suggestion." },
      { signal },
    );
    expect(deps.setAnswer).toHaveBeenCalledWith(
      { fieldKey: "motivation", value: "A concise suggestion." },
      { signal },
    );
    expect(updated).toMatchObject({ status: "completed", data: { version: 2 } });

    const invalid = await manifests[1]!.execute(
      { fieldKey: "motivation", value: "Suggestion", acceptedByHuman: true },
      { signal },
    );
    expect(invalid).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(deps.setAnswer).toHaveBeenCalledOnce();
  });

  it("returns explicit user-action envelopes for data permission and final confirmation", async () => {
    const permission = {
      ...base,
      state: "reviewed" as const,
      stage: "permission" as const,
      reviewStatus: "active" as const,
    };
    const permissionDeps = dependencies(permission, ["read_application", "request_data_consent"]);
    const permissionTools = createApplicationToolManifests(permissionDeps);
    expect(names(permissionTools)).toEqual(["get_application_state", "request_data_permission"]);
    const permissionResult = await permissionTools[1]!.execute(
      {},
      { signal: new AbortController().signal },
    );
    expect(permissionResult).toMatchObject({
      status: "requires_user_action",
      requestId: consentRequestId,
      userAction: { kind: "data_consent", surface: "data_consent" },
      presentation: {
        title: "Share this reviewed application?",
        confirmLabel: "Approve this disclosure",
        facts: expect.arrayContaining([
          { key: "Recipient", value: "Northstar Systems" },
          { key: "Notice", value: "privacy-2026-08" },
        ]),
      },
    });

    const requestedPermission = {
      ...permission,
      dataPermissionStatus: "requested" as const,
    };
    const requestedPermissionDeps = dependencies(requestedPermission, [
      "read_application",
      "request_data_consent",
    ]);
    const requestedPermissionTools = createApplicationToolManifests(requestedPermissionDeps);
    expect(names(requestedPermissionTools)).toEqual([
      "get_application_state",
      "approve_data_permission",
    ]);
    const approvedPermission = await requestedPermissionTools[1]!.execute(
      { requestId: consentRequestId, confirmed: true },
      { signal: new AbortController().signal },
    );
    expect(requestedPermissionDeps.approveDataPermission).toHaveBeenCalledWith(consentRequestId, {
      signal: expect.any(AbortSignal),
    });
    expect(approvedPermission).toMatchObject({
      status: "completed",
      data: { dataPermissionStatus: "active" },
    });

    const confirmation = {
      ...permission,
      stage: "confirmation" as const,
      dataPermissionStatus: "active" as const,
    };
    const confirmationDeps = dependencies(confirmation, [
      "read_application",
      "request_confirmation",
      "submit_application",
    ]);
    const confirmationTools = createApplicationToolManifests(confirmationDeps);
    expect(names(confirmationTools)).toEqual([
      "get_application_state",
      "request_final_confirmation",
      "confirm_reviewed_application",
    ]);
    const confirmationResult = await confirmationTools[1]!.execute(
      {},
      { signal: new AbortController().signal },
    );
    expect(confirmationResult).toMatchObject({
      status: "requires_user_action",
      requestId: reviewRequestId,
      userAction: { kind: "action_confirmation", surface: "application_review" },
      presentation: {
        title: "Confirm this exact application?",
        confirmLabel: "Confirm reviewed application",
      },
    });
    const confirmed = await confirmationTools[2]!.execute(
      { requestId: reviewRequestId, confirmed: true },
      { signal: new AbortController().signal },
    );
    expect(confirmationDeps.confirmFinalApplication).toHaveBeenCalledWith(reviewRequestId, {
      signal: expect.any(AbortSignal),
    });
    expect(confirmed).toMatchObject({
      status: "completed",
      data: { finalConfirmationReady: true },
    });
    expect(
      new TextEncoder().encode(JSON.stringify(confirmationResult)).byteLength,
    ).toBeLessThanOrEqual(1_500);
  });

  it("never exposes an external handoff as an agent submission or navigation", async () => {
    const confirmation = {
      ...base,
      state: "reviewed" as const,
      stage: "confirmation" as const,
      reviewStatus: "active" as const,
      dataPermissionStatus: "active" as const,
      finalConfirmationReady: true,
    };
    const deps = {
      ...dependencies(confirmation, ["read_application", "request_confirmation"]),
      allowsAgentSubmission: vi.fn(() => false),
    };
    const manifests = createApplicationToolManifests(deps);

    expect(names(manifests)).toEqual(["get_application_state", "prepare_external_handoff"]);
    expect(names(manifests)).not.toContain("submit_application");
    const result = await manifests[1]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "requires_user_action",
      userAction: { kind: "action_confirmation", surface: "application_review" },
    });
    expect(deps.submit).not.toHaveBeenCalled();
    expect(JSON.stringify(result)).toContain("visible workspace");
  });
});
