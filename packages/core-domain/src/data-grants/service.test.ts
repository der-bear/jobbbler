import { describe, expect, it } from "vitest";

import {
  approveDataGrant,
  assertGrantCovers,
  requestDataGrant,
  withdrawDataGrant,
} from "./service.js";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_00000001-0000-7000-8000-000000000001";
const draftId = "draft_00000001-0000-7000-8000-000000000001";

describe("data grants", () => {
  it("requires owner approval and binds disclosure to recipient, purpose, and payload", () => {
    const requested = requestDataGrant({
      id: "grant_00000001-0000-7000-8000-000000000001",
      ownerId,
      draftId,
      recipientId: "recipient_00000001-0000-7000-8000-000000000001",
      purpose: "Submit the reviewed application to Northstar.",
      payloadHash: "a".repeat(64),
      categories: ["identity", "application_answers"],
      fieldKeys: ["full_name", "portfolio_url"],
      documentIds: [],
      expiresAt: "2026-08-29T10:30:00.000Z",
      now,
    });

    expect(() =>
      assertGrantCovers(requested, {
        ownerId,
        draftId,
        recipientId: requested.recipientId,
        purpose: requested.purpose,
        payloadHash: requested.payloadHash,
        categories: ["identity"],
        now,
      }),
    ).toThrow(/approval/i);

    const approved = approveDataGrant(requested, ownerId, now);
    expect(
      assertGrantCovers(approved, {
        ownerId,
        draftId,
        recipientId: approved.recipientId,
        purpose: approved.purpose,
        payloadHash: approved.payloadHash,
        categories: ["identity"],
        now,
      }),
    ).toBeUndefined();
    expect(() =>
      assertGrantCovers(approved, {
        ownerId,
        draftId,
        recipientId: approved.recipientId,
        purpose: "Send this application to another recipient.",
        payloadHash: approved.payloadHash,
        categories: ["identity"],
        now,
      }),
    ).toThrow(/purpose/i);
  });

  it("withdraws future consent and rejects a changed payload or expired grant", () => {
    const approved = approveDataGrant(
      requestDataGrant({
        id: "grant_00000001-0000-7000-8000-000000000002",
        ownerId,
        draftId,
        recipientId: "recipient_00000001-0000-7000-8000-000000000001",
        purpose: "Submit the reviewed application to Northstar.",
        payloadHash: "b".repeat(64),
        categories: ["contact"],
        fieldKeys: ["email"],
        documentIds: [],
        expiresAt: "2026-08-29T10:01:00.000Z",
        now,
      }),
      ownerId,
      now,
    );

    for (const grant of [
      withdrawDataGrant(approved, ownerId, "2026-08-29T10:00:30.000Z"),
      approved,
    ]) {
      expect(() =>
        assertGrantCovers(grant, {
          ownerId,
          draftId,
          recipientId: grant.recipientId,
          purpose: grant.purpose,
          payloadHash: grant === approved ? "c".repeat(64) : grant.payloadHash,
          categories: ["contact"],
          now: grant === approved ? "2026-08-29T10:02:00.000Z" : "2026-08-29T10:00:31.000Z",
        }),
      ).toThrow();
    }
  });
});
