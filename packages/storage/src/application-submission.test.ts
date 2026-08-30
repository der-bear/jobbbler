import { describe, expect, it } from "vitest";

import { requiresAgentClientSubmissionDecision } from "./application-submission.js";

const manualDraft = {
  answers: [
    {
      fieldKey: "motivation",
      value: "Candidate-authored note",
      provenance: "user_entered" as const,
      sensitive: false,
      acceptedByHuman: true,
    },
  ],
};

describe("requiresAgentClientSubmissionDecision", () => {
  it.each(["requested", "active"] as const)(
    "keeps a %s assistance lineage in the agent client",
    (status) => {
      expect(requiresAgentClientSubmissionDecision(manualDraft, [{ status }])).toBe(true);
    },
  );

  it("keeps an agent-suggested answer lineage in the agent client after assistance ends", () => {
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
        [{ status: "revoked" }],
      ),
    ).toBe(true);
  });

  it("leaves a purely manual draft in the first-party flow", () => {
    expect(requiresAgentClientSubmissionDecision(manualDraft, [{ status: "revoked" }])).toBe(false);
  });
});
