import { describe, expect, it } from "vitest";

import {
  completeOwnerDeletionInputSchema,
  completeOwnerRecoveryInputSchema,
  createOwnerDeletionIntentInputSchema,
  completeEmailVerificationInputSchema,
  ownerSessionResultSchema,
  ownerSummarySchema,
  startOwnerRecoveryInputSchema,
  startOwnerRecoveryResultSchema,
  startEmailVerificationInputSchema,
  verificationEndpointSummarySchema,
} from "./identity.js";

describe("identity contracts", () => {
  it("normalizes an email verification request", () => {
    expect(startEmailVerificationInputSchema.parse({ email: "  Person@Example.COM " })).toEqual({
      email: "person@example.com",
    });
  });

  it("requires a six-digit verification code", () => {
    expect(() =>
      completeEmailVerificationInputSchema.parse({
        challengeId: "challenge_550e8400-e29b-41d4-a716-446655440000",
        code: "12345",
      }),
    ).toThrow();
  });

  it("keeps endpoint-backed recovery capability out of the owner identity summary", () => {
    const owner = {
      id: "owner_550e8400-e29b-41d4-a716-446655440000",
      kind: "ephemeral",
      verified: false,
    };

    expect(ownerSummarySchema.parse(owner)).toEqual(owner);
    expect(ownerSummarySchema.safeParse({ ...owner, recoverable: false }).success).toBe(false);
  });

  it("exposes only masked endpoint and non-secret session summaries", () => {
    const owner = {
      id: "owner_550e8400-e29b-41d4-a716-446655440000",
      kind: "guest",
      verified: true,
    };
    expect(
      ownerSessionResultSchema.parse({ owner, expiresAt: "2026-09-05T10:00:00.000Z" }),
    ).toMatchObject({ owner });
    expect(
      verificationEndpointSummarySchema.parse({
        id: "endpoint_550e8400-e29b-41d4-a716-446655440000",
        kind: "email",
        maskedDestination: "p•••••@example.com",
        status: "verified",
        verifiedAt: "2026-08-29T10:00:00.000Z",
      }),
    ).not.toHaveProperty("addressHash");
  });

  it("keeps recovery requests small, normalized, and free of identity hints", () => {
    expect(startOwnerRecoveryInputSchema.parse({ email: " Person@Example.COM " })).toEqual({
      email: "person@example.com",
    });
    const result = startOwnerRecoveryResultSchema.parse({
      recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440000",
      expiresAt: "2026-08-29T10:10:00.000Z",
      delivery: "accepted",
    });
    expect(result).not.toHaveProperty("ownerId");
    expect(result).not.toHaveProperty("maskedDestination");
    expect(result).not.toHaveProperty("emailExists");
  });

  it("requires exact human confirmation phrases for private-data deletion", () => {
    expect(
      createOwnerDeletionIntentInputSchema.parse({ confirmation: "DELETE MY PRIVATE DATA" }),
    ).toEqual({ confirmation: "DELETE MY PRIVATE DATA" });
    expect(() =>
      createOwnerDeletionIntentInputSchema.parse({ confirmation: "delete my private data" }),
    ).toThrow();
    expect(
      completeOwnerDeletionInputSchema.parse({
        deletionId: "deletion_550e8400-e29b-41d4-a716-446655440000",
        confirmation: "DELETE",
      }),
    ).toMatchObject({ confirmation: "DELETE" });
  });

  it("requires one recovery id and six-digit code without accepting extra fields", () => {
    expect(
      completeOwnerRecoveryInputSchema.parse({
        recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440000",
        code: "123456",
      }),
    ).toMatchObject({ code: "123456" });
    expect(() =>
      completeOwnerRecoveryInputSchema.parse({
        recoveryId: "recovery_550e8400-e29b-41d4-a716-446655440000",
        code: "123456",
        ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      }),
    ).toThrow();
  });
});
