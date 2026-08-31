import { describe, expect, it } from "vitest";

import { requiresAgentClientSubmissionDecision } from "./application-submission.js";

const now = "2026-08-29T10:00:00.000Z";
const future = "2026-08-29T10:15:00.000Z";
const expired = "2026-08-29T09:59:59.999Z";

const manualDraft = {
  answers: [
    {
      fieldKey: "cover_letter",
      value: "Candidate-authored note",
      provenance: "user_entered" as const,
      sensitive: true,
      acceptedByHuman: true,
    },
  ],
};

describe("requiresAgentClientSubmissionDecision", () => {
  it.each(["requested", "active"] as const)(
    "keeps a %s assistance lineage in the agent client",
    (status) => {
      expect(
        requiresAgentClientSubmissionDecision(manualDraft, [{ status, expiresAt: future }], now),
      ).toBe(true);
    },
  );

  it.each(["requested", "active"] as const)(
    "ignores an expired %s delegation for first-party submission",
    (status) => {
      expect(
        requiresAgentClientSubmissionDecision(manualDraft, [{ status, expiresAt: expired }], now),
      ).toBe(false);
    },
  );

  it("allows first-party takeover of agent suggestions after assistance is revoked", () => {
    expect(
      requiresAgentClientSubmissionDecision(
        {
          answers: [
            {
              ...manualDraft.answers[0]!,
              provenance: "agent_suggestion",
              acceptedByHuman: false,
            },
          ],
        },
        [{ status: "revoked", expiresAt: future }],
        now,
      ),
    ).toBe(false);
  });

  it("leaves a purely manual draft in the first-party flow", () => {
    expect(
      requiresAgentClientSubmissionDecision(
        manualDraft,
        [{ status: "revoked", expiresAt: future }],
        now,
      ),
    ).toBe(false);
  });
});
