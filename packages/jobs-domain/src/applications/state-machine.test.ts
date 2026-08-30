import { describe, expect, it } from "vitest";

import {
  confirmReview,
  createApplicationDraft,
  handOffExternal,
  reviewApplication,
  setApplicationAnswer,
  setApplicationAnswers,
  submitInternal,
  validateApplication,
  withdrawApplication,
} from "./state-machine.js";

const now = "2026-08-29T10:00:00.000Z";
const ownerId = "owner_00000001-0000-7000-8000-000000000001";
const jobId = "job_00000001-0000-7000-8000-000000000001";
const hash = (value: string) => `hash:${value}`;

describe("application state machine", () => {
  it("applies a validated answer batch as one atomic draft version", () => {
    const draft = createApplicationDraft({
      id: "draft_00000001-0000-7000-8000-000000000010",
      ownerId,
      jobId,
      requiredFieldKeys: ["full_name", "email"],
      now,
    });
    const updated = setApplicationAnswers(draft, {
      ownerId,
      expectedVersion: 0,
      answers: [
        {
          fieldKey: "full_name",
          value: "Ada Lovelace",
          provenance: "agent_suggestion",
          sensitive: true,
          acceptedByHuman: false,
        },
        {
          fieldKey: "email",
          value: "ada@example.test",
          provenance: "agent_suggestion",
          sensitive: true,
          acceptedByHuman: false,
        },
      ],
      now,
    }).draft;

    expect(updated.version).toBe(1);
    expect(updated.answers.map(({ fieldKey }) => fieldKey)).toEqual(["email", "full_name"]);
  });

  it("validates required answers, binds an immutable review, and invalidates it after a material edit", () => {
    const draft = createApplicationDraft({
      id: "draft_00000001-0000-7000-8000-000000000001",
      ownerId,
      jobId,
      requiredFieldKeys: ["full_name", "email"],
      now,
    });
    const named = setApplicationAnswer(draft, {
      ownerId,
      expectedVersion: 0,
      answer: {
        fieldKey: "full_name",
        value: "Ada Lovelace",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
      now,
    }).draft;
    expect(() => validateApplication(named, ownerId, now)).toThrow(/email/i);

    const complete = setApplicationAnswer(named, {
      ownerId,
      expectedVersion: 1,
      answer: {
        fieldKey: "email",
        value: "ada@example.test",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
      now,
    }).draft;
    const valid = validateApplication(complete, ownerId, now);
    expect(valid.version).toBe(3);
    const reviewed = reviewApplication(valid, {
      id: "review_00000001-0000-7000-8000-000000000001",
      ownerId,
      now,
      hash,
    });
    expect(reviewed.draft.version).toBe(4);
    expect(reviewed.review.draftVersion).toBe(reviewed.draft.version);
    const edited = setApplicationAnswer(reviewed.draft, {
      ownerId,
      expectedVersion: reviewed.draft.version,
      answer: {
        fieldKey: "full_name",
        value: "Ada Byron",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
      now: "2026-08-29T10:01:00.000Z",
      review: reviewed.review,
    });

    expect(reviewed.review.payloadHash).toMatch(/^hash:/);
    expect(edited.draft.state).toBe("draft");
    expect(edited.invalidatedReview?.status).toBe("invalidated");
  });

  it("uses one expiring confirmation for an idempotent internal receipt and never calls an external handoff submitted", () => {
    const ready = validateApplication(
      setApplicationAnswer(
        createApplicationDraft({
          id: "draft_00000001-0000-7000-8000-000000000002",
          ownerId,
          jobId,
          requiredFieldKeys: ["full_name"],
          now,
        }),
        {
          ownerId,
          expectedVersion: 0,
          answer: {
            fieldKey: "full_name",
            value: "Ada",
            provenance: "user_entered",
            sensitive: false,
            acceptedByHuman: true,
          },
          now,
        },
      ).draft,
      ownerId,
      now,
    );
    const reviewed = reviewApplication(ready, {
      id: "review_00000001-0000-7000-8000-000000000002",
      ownerId,
      now,
      hash,
    });
    const confirmation = confirmReview(reviewed.draft, reviewed.review, {
      id: "confirm_00000001-0000-7000-8000-000000000002",
      ownerId,
      now,
      expiresAt: "2026-08-29T10:05:00.000Z",
    });
    const submitted = submitInternal(reviewed.draft, reviewed.review, confirmation, {
      id: "receipt_00000001-0000-7000-8000-000000000002",
      ownerId,
      idempotencyKey: "key-1",
      now,
    });
    const replay = submitInternal(reviewed.draft, reviewed.review, confirmation, {
      id: "receipt_other",
      ownerId,
      idempotencyKey: "key-1",
      now,
      existingReceipt: submitted.receipt,
    });
    expect(submitted.draft.state).toBe("submitted");
    expect(submitted.draft.version).toBe(reviewed.draft.version + 1);
    expect(submitted.confirmation.status).toBe("consumed");
    expect(replay.receipt).toBe(submitted.receipt);
    expect(() =>
      submitInternal(reviewed.draft, reviewed.review, submitted.confirmation, {
        id: "receipt_other",
        ownerId,
        idempotencyKey: "key-2",
        now,
      }),
    ).toThrow(/used/i);

    const handedOff = handOffExternal(reviewed.draft, reviewed.review, confirmation, {
      id: "receipt_00000001-0000-7000-8000-000000000003",
      ownerId,
      now,
      externalUrl: "https://ats.example.test/apply",
    });
    expect(handedOff.receipt.status).toBe("handed_off");
    expect(handedOff.draft.version).toBe(reviewed.draft.version + 1);
    expect(handedOff.receipt.status).not.toBe("submitted");
  });

  it("enforces ownership and permits withdrawal without erasing provenance", () => {
    const draft = createApplicationDraft({
      id: "draft_00000001-0000-7000-8000-000000000003",
      ownerId,
      jobId,
      requiredFieldKeys: [],
      now,
    });
    expect(() =>
      withdrawApplication(draft, "owner_00000002-0000-7000-8000-000000000002", now),
    ).toThrow(/owner/i);
    const withdrawn = withdrawApplication(draft, ownerId, now);
    expect(withdrawn.state).toBe("withdrawn");
    expect(withdrawn.version).toBe(draft.version + 1);
    expect(withdrawn.createdAt).toBe(now);
  });
});
