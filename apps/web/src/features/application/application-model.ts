import type {
  AgentOperation,
  ApplicationAnswer,
  ApplicationAgentState,
  ApplicationWorkspace,
  DataCategory,
  Job,
} from "@jobbbler/contracts";

export type ApplicationStage =
  "profile" | "review" | "permission" | "confirmation" | "legacy_external" | "closed" | "complete";

export type ApplicationNextAction =
  "prepare" | "review" | "submit" | "withdraw" | "read_only" | "complete";

function instantMilliseconds(value: string): number {
  return Date.parse(value);
}

function laterInstant(left: string, right: string): string {
  return instantMilliseconds(left) >= instantMilliseconds(right) ? left : right;
}

export function isLiveApplicationAssistance(
  delegation: ApplicationWorkspace["delegationRequests"][number],
  now: string,
): boolean {
  return (
    (delegation.status === "requested" || delegation.status === "active") &&
    instantMilliseconds(delegation.expiresAt) > instantMilliseconds(now)
  );
}

export function isLiveApplicationDataGrant(
  grant: ApplicationWorkspace["dataGrant"],
  now: string,
): grant is NonNullable<ApplicationWorkspace["dataGrant"]> {
  return (
    grant !== null &&
    (grant.status === "requested" || grant.status === "active") &&
    instantMilliseconds(grant.expiresAt) > instantMilliseconds(now)
  );
}

export function isAgentAssistedApplication(workspace: ApplicationWorkspace, now: string): boolean {
  return workspace.delegationRequests.some((delegation) =>
    isLiveApplicationAssistance(delegation, now),
  );
}

export interface ApplicationServerClock {
  now(): string;
  synchronize(serverNow: string): string;
}

export function createServerDerivedApplicationClock(
  serverNow: string,
  monotonicNow: () => number = () => globalThis.performance.now(),
): ApplicationServerClock {
  let monotonicAnchor = monotonicNow();
  let serverAnchor = instantMilliseconds(serverNow);
  let latest = serverAnchor;

  const currentMilliseconds = (): number => {
    const elapsed = Math.max(0, monotonicNow() - monotonicAnchor);
    latest = Math.max(latest, serverAnchor + elapsed);
    return latest;
  };

  return {
    now: () => new Date(currentMilliseconds()).toISOString(),
    synchronize(nextServerNow) {
      const current = currentMilliseconds();
      monotonicAnchor = monotonicNow();
      serverAnchor = Math.max(current, instantMilliseconds(nextServerNow));
      latest = serverAnchor;
      return new Date(latest).toISOString();
    },
  };
}

export interface BoundApplicationServerClock {
  readonly draftId: string;
  readonly clock: ApplicationServerClock;
}

export interface ApplicationAgentCredential {
  readonly sessionId: string;
  readonly token: string;
  readonly expiresAt: string;
}

export function createApplicationAgentAuthorization(
  input: Readonly<{
    workspace: Pick<ApplicationWorkspace, "delegationRequests">;
    credential: ApplicationAgentCredential | null;
    currentTime(): string;
  }>,
): Readonly<{
  currentCredential(): ApplicationAgentCredential | null;
  isOperationAuthorized(operation: AgentOperation): boolean;
}> {
  const credentialAt = (now: string): ApplicationAgentCredential | null =>
    input.credential !== null &&
    instantMilliseconds(input.credential.expiresAt) > instantMilliseconds(now)
      ? input.credential
      : null;

  return {
    currentCredential: () => credentialAt(input.currentTime()),
    isOperationAuthorized(operation) {
      const now = input.currentTime();
      const credential = credentialAt(now);
      return (
        credential !== null &&
        input.workspace.delegationRequests.some(
          (delegation) =>
            delegation.agentSessionId === credential.sessionId &&
            delegation.status === "active" &&
            instantMilliseconds(delegation.expiresAt) > instantMilliseconds(now) &&
            delegation.operations.includes(operation),
        )
      );
    },
  };
}

export function bindApplicationServerClock(
  current: BoundApplicationServerClock | null,
  workspace: Pick<ApplicationWorkspace, "draft" | "serverNow">,
  monotonicNow?: () => number,
): BoundApplicationServerClock {
  if (current?.draftId === workspace.draft.id) {
    current.clock.synchronize(workspace.serverNow);
    return current;
  }
  return {
    draftId: workspace.draft.id,
    clock: createServerDerivedApplicationClock(workspace.serverNow, monotonicNow),
  };
}

export function nextApplicationAuthorizationExpiry(
  workspace: ApplicationWorkspace,
  now: string,
  additionalExpiries: readonly string[] = [],
): string | null {
  const current = instantMilliseconds(now);
  const expiries = workspace.delegationRequests
    .filter(
      ({ status, expiresAt }) =>
        (status === "requested" || status === "active") && instantMilliseconds(expiresAt) > current,
    )
    .map(({ expiresAt }) => expiresAt);
  expiries.push(
    ...additionalExpiries.filter((expiresAt) => {
      const expiry = instantMilliseconds(expiresAt);
      return Number.isFinite(expiry) && expiry > current;
    }),
  );
  if (isLiveApplicationDataGrant(workspace.dataGrant, now)) {
    expiries.push(workspace.dataGrant.expiresAt);
  }
  if (expiries.length === 0) return null;
  return expiries.reduce((earliest, candidate) =>
    instantMilliseconds(candidate) < instantMilliseconds(earliest) ? candidate : earliest,
  );
}

export function mountApplicationExpiryClock(
  input: Readonly<{
    workspace: ApplicationWorkspace;
    clock: Pick<ApplicationServerClock, "now">;
    additionalExpiries?: readonly string[];
    onTick(now: string): void;
  }>,
): () => void {
  let stopped = false;
  let current = input.clock.now();
  let timer: ReturnType<typeof globalThis.setTimeout> | null = null;

  const schedule = (): void => {
    const nextExpiry = nextApplicationAuthorizationExpiry(
      input.workspace,
      current,
      input.additionalExpiries,
    );
    if (nextExpiry === null || stopped) return;
    const delay = Math.max(
      0,
      instantMilliseconds(nextExpiry) - instantMilliseconds(input.clock.now()),
    );
    timer = globalThis.setTimeout(() => {
      current = laterInstant(current, laterInstant(nextExpiry, input.clock.now()));
      input.onTick(current);
      schedule();
    }, Math.ceil(delay));
  };

  schedule();
  return () => {
    stopped = true;
    if (timer !== null) globalThis.clearTimeout(timer);
  };
}

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

export function applicationReadinessForValues(
  workspace: ApplicationWorkspace,
  values: Readonly<Record<string, string>>,
): ReturnType<typeof applicationReadiness> {
  const required = workspace.requirements.filter((field) => field.required);
  const missingFieldKeys = required
    .filter((field) => (values[field.fieldKey] ?? "").trim().length === 0)
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

export function applicationDisclosureForValues(
  workspace: ApplicationWorkspace,
  values: Readonly<Record<string, string>>,
): ReturnType<typeof applicationDisclosure> {
  const disclosed = workspace.requirements.filter(
    (field) => (values[field.fieldKey] ?? "").trim().length > 0,
  );
  return {
    fieldKeys: disclosed.map((field) => field.fieldKey),
    categories: [...new Set(disclosed.map((field) => field.category))],
    sensitiveFieldKeys: disclosed.filter((field) => field.sensitive).map((field) => field.fieldKey),
  };
}

export function applicationStage(
  workspace: ApplicationWorkspace,
  now: string,
  roleStatus: Job["status"] = "open",
): ApplicationStage {
  if (
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off"
  ) {
    return "complete";
  }
  if (roleStatus !== "open") return "closed";
  if (workspace.applyMode === "external") return "legacy_external";
  if (workspace.draft.state === "valid") return "review";
  if (workspace.draft.state === "reviewed" || workspace.draft.state === "awaiting_confirmation") {
    return isLiveApplicationDataGrant(workspace.dataGrant, now) &&
      workspace.dataGrant.status === "active"
      ? "confirmation"
      : "permission";
  }
  return "profile";
}

export function applicationAgentState(
  workspace: ApplicationWorkspace,
  finalConfirmationReady: boolean,
  now: string,
  roleStatus: Job["status"] = "open",
): ApplicationAgentState {
  const progress = visibleApplicationProgress(workspace);
  const liveDelegation = workspace.delegationRequests.find((delegation) =>
    isLiveApplicationAssistance(delegation, now),
  );
  const latestRevokedDelegation = workspace.delegationRequests.find(
    ({ status }) => status === "revoked",
  );
  return {
    draftId: workspace.draft.id,
    jobId: workspace.draft.jobId,
    applyMode: workspace.applyMode,
    state: workspace.draft.state,
    stage: applicationStage(workspace, now, roleStatus),
    version: workspace.draft.version,
    requiredFields: progress.required,
    completedRequiredFields: progress.completed,
    reviewStatus: workspace.review?.status ?? "none",
    dataPermissionStatus: isLiveApplicationDataGrant(workspace.dataGrant, now)
      ? workspace.dataGrant.status
      : "none",
    agentAuthorityStatus: liveDelegation?.status ?? latestRevokedDelegation?.status ?? "none",
    finalConfirmationReady,
    receiptStatus: workspace.receipt?.status ?? "none",
  };
}

export function applicationNextAction(
  workspace: ApplicationWorkspace,
  now: string,
  finalConfirmationReady = false,
  roleStatus: Job["status"] = "open",
): ApplicationNextAction {
  if (
    workspace.receipt !== null ||
    workspace.draft.state === "submitted" ||
    workspace.draft.state === "handed_off"
  ) {
    return "complete";
  }
  if (roleStatus !== "open") {
    return isLiveApplicationDataGrant(workspace.dataGrant, now) &&
      workspace.dataGrant.status === "active"
      ? "withdraw"
      : "read_only";
  }
  if (workspace.applyMode === "external") {
    return isLiveApplicationDataGrant(workspace.dataGrant, now) &&
      workspace.dataGrant.status === "active"
      ? "withdraw"
      : "read_only";
  }
  if (finalConfirmationReady) return "submit";
  return applicationReadiness(workspace).readyForReview ? "review" : "prepare";
}
