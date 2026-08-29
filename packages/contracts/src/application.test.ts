import { describe, expect, it } from "vitest";

import {
  requestAgentDelegationSchema,
  requestDataGrantSchema,
  submitApplicationInputSchema,
} from "./application.js";

const draftId = "draft_550e8400-e29b-41d4-a716-446655440000";
const agentSessionId = "agent_550e8400-e29b-41d4-a716-446655440000";

describe("application authorization contracts", () => {
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
      legalBasis: "user_instruction",
    });

    expect(grant.payloadHash).toHaveLength(64);
    expect(grant.legalBasis).toBe("user_instruction");
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
});
