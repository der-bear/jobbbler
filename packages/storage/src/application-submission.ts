import type { ApplicationDraft } from "@jobbbler/contracts";

import type { AgentDelegationRecord } from "./records.js";

export function requiresAgentClientSubmissionDecision(
  draft: Pick<ApplicationDraft, "answers">,
  delegations: readonly Pick<AgentDelegationRecord, "status">[],
): boolean {
  return (
    delegations.some(({ status }) => status === "requested" || status === "active") ||
    draft.answers.some(({ provenance }) => provenance === "agent_suggestion")
  );
}
