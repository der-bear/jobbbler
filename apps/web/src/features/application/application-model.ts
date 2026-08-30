import type {
  ApplicationAnswer,
  ApplicationAgentState,
  ApplicationWorkspace,
  DataCategory,
} from "@jobbbler/contracts";

export type ApplicationStage =
  "profile" | "review" | "permission" | "confirmation" | "legacy_external" | "complete";

export type ApplicationNextAction =
  "prepare" | "review" | "submit" | "withdraw" | "read_only" | "complete";

function isCompletedAnswer(answer: ApplicationAnswer | undefined): boolean {
  if (answer === undefined || answer.value === null) return false;
  if (typeof answer.value === "string") return answer.value.trim().length > 0;
  if (Array.isArray(answer.value)) return answer.value.length > 0;
  return true;
}

export function applicationReadiness(workspace: ApplicationWorkspace): Readonly<{
  completed: number;
  required: number;
  missingFieldKeys: readonly string[];
  readyForReview: boolean;
}> {
  const required = workspace.requirements.filter((field) => field.required);
  const missingFieldKeys = required
    .filter(
      (field) =>
        !isCompletedAnswer(
          workspace.draft.answers.find((answer) => answer.fieldKey === field.fieldKey),
        ),
    )
    .map(({ fieldKey }) => fieldKey);
  return {
    completed: required.length - missingFieldKeys.length,
    required: required.length,
    missingFieldKeys,
    readyForReview: missingFieldKeys.length === 0,
  };
}

export function visibleApplicationProgress(
  workspace: ApplicationWorkspace,
): Readonly<{ completed: number; required: number }> {
  const { completed, required } = applicationReadiness(workspace);
  return { completed, required };
}

export function applicationDisclosure(workspace: ApplicationWorkspace): Readonly<{
  fieldKeys: readonly string[];
  categories: readonly DataCategory[];
  sensitiveFieldKeys: readonly string[];
}> {
  const disclosed = workspace.requirements.filter((field) =>
    isCompletedAnswer(workspace.draft.answers.find((answer) => answer.fieldKey === field.fieldKey)),
  );
  return {
    fieldKeys: disclosed.map((field) => field.fieldKey),
    categories: [...new Set(disclosed.map((field) => field.category))],
    sensitiveFieldKeys: disclosed.filter((field) => field.sensitive).map((field) => field.fieldKey),
  };
}

export function applicationStage(workspace: ApplicationWorkspace): ApplicationStage {
  if (
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off"
  ) {
    return "complete";
  }
  if (workspace.applyMode === "external") return "legacy_external";
  if (workspace.draft.state === "valid") return "review";
  if (workspace.draft.state === "reviewed" || workspace.draft.state === "awaiting_confirmation") {
    return workspace.dataGrant?.status === "active" ? "confirmation" : "permission";
  }
  return "profile";
}

export function applicationAgentState(
  workspace: ApplicationWorkspace,
  finalConfirmationReady: boolean,
): ApplicationAgentState {
  const progress = visibleApplicationProgress(workspace);
  const latestDelegation = workspace.delegationRequests[0];
  return {
    draftId: workspace.draft.id,
    jobId: workspace.draft.jobId,
    applyMode: workspace.applyMode,
    state: workspace.draft.state,
    stage: applicationStage(workspace),
    version: workspace.draft.version,
    requiredFields: progress.required,
    completedRequiredFields: progress.completed,
    reviewStatus: workspace.review?.status ?? "none",
    dataPermissionStatus: workspace.dataGrant?.status ?? "none",
    agentAuthorityStatus: latestDelegation?.status ?? "none",
    finalConfirmationReady,
    receiptStatus: workspace.receipt?.status ?? "none",
  };
}

export function applicationNextAction(
  workspace: ApplicationWorkspace,
  finalConfirmationReady = false,
): ApplicationNextAction {
  if (
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off"
  ) {
    return "complete";
  }
  if (workspace.applyMode === "external") {
    return workspace.dataGrant?.status === "active" ? "withdraw" : "read_only";
  }
  if (finalConfirmationReady) return "submit";
  return applicationReadiness(workspace).readyForReview ? "review" : "prepare";
}
