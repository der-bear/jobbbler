import { describe, expect, it } from "vitest";

import {
  approveDelegation,
  assertDelegationAllows,
  requestDelegation,
  revokeDelegation,
} from "./service.js";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_00000001-0000-7000-8000-000000000001";
const draftId = "draft_00000001-0000-7000-8000-000000000001";

describe("agent delegations", () => {
  it("keeps a request unusable until its owner approves one scoped, expiring capability", () => {
    const requested = requestDelegation({
      id: "delegation_00000001-0000-7000-8000-000000000001",
      ownerId,
      agentSessionId: "agent_00000001-0000-7000-8000-000000000001",
      resource: { type: "application_draft", id: draftId },
      operations: ["edit_application", "review_application"],
      purpose: "Prepare this application with the candidate.",
      expiresAt: "2026-08-29T10:30:00.000Z",
      now,
    });

    expect(() =>
      assertDelegationAllows(requested, {
        ownerId,
        agentSessionId: requested.agentSessionId,
        resource: requested.resource,
        operation: "edit_application",
        now,
      }),
    ).toThrow(/approval/i);

    const approved = approveDelegation(requested, ownerId, now);
    expect(
      assertDelegationAllows(approved, {
        ownerId,
        agentSessionId: approved.agentSessionId,
        resource: approved.resource,
        operation: "edit_application",
        now,
      }),
    ).toBeUndefined();
    expect(() =>
      assertDelegationAllows(approved, {
        ownerId,
        agentSessionId: approved.agentSessionId,
        resource: approved.resource,
        operation: "submit_application",
        now,
      }),
    ).toThrow(/scope/i);
  });

  it("denies a revoked, expired, or foreign-owner delegation", () => {
    const approved = approveDelegation(
      requestDelegation({
        id: "delegation_00000001-0000-7000-8000-000000000002",
        ownerId,
        agentSessionId: "agent_00000001-0000-7000-8000-000000000002",
        resource: { type: "application_draft", id: draftId },
        operations: ["read_application"],
        purpose: "Inspect the candidate draft.",
        expiresAt: "2026-08-29T10:01:00.000Z",
        now,
      }),
      ownerId,
      now,
    );
    const revoked = revokeDelegation(approved, ownerId, "2026-08-29T10:00:30.000Z");

    for (const delegation of [revoked, approved]) {
      expect(() =>
        assertDelegationAllows(delegation, {
          ownerId: delegation === revoked ? ownerId : "owner_00000002-0000-7000-8000-000000000002",
          agentSessionId: delegation.agentSessionId,
          resource: delegation.resource,
          operation: "read_application",
          now: delegation === revoked ? "2026-08-29T10:00:31.000Z" : "2026-08-29T10:02:00.000Z",
        }),
      ).toThrow();
    }
  });
});
