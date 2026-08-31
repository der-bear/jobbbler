import type { ApplicationDraft } from "@jobbbler/contracts";

import type { AgentDelegationRecord } from "./records.js";

export function requiresAgentClientSubmissionDecision(
  _draft: Pick<ApplicationDraft, "answers">,
  delegations: readonly Pick<AgentDelegationRecord, "status" | "expiresAt">[],
  now: string,
): boolean {
  return delegations.some(
    ({ status, expiresAt }) => (status === "requested" || status === "active") && expiresAt > now,
  );
}
