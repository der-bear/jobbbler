import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  applicationConsentWithdrawalSchema,
  applicationDataGrantSummarySchema,
  applicationDelegationSummarySchema,
  applicationSubmissionDecisionReceiptSchema,
  applicationSubmissionReviewRequestSchema,
  dataCategorySchema,
  entityIdSchema,
  legalBasisSchema,
  requestAgentDelegationSchema,
  requestDataGrantSchema,
  type AgentOperation,
  type ApplicationDraft,
  type ApplicationDataGrantSummary,
  type ApplicationDelegationSummary,
  type Job,
  type RequestDataGrant,
} from "@jobbbler/contracts";
import {
  createEntityId,
  DomainError,
  requestDataGrant,
  requestDelegation,
} from "@jobbbler/core-domain";
import type {
  ActiveDelegationMatchInput,
  AgentDelegationRecord,
  AgentSessionRecord,
  AgentSessionRepository,
  ApplicationRepository,
  DelegationRepository,
  IdempotencyRepository,
  JobRepository,
  RichDataGrantMatchInput,
  RichDataGrantApprovalGuard,
  RichDataGrantRecord,
  RichDataGrantRepository,
} from "@jobbbler/storage";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { createRequestId, getRateLimitKey } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { readSmallJsonBody, requireOwnerSession } from "./identity-route-handlers";
import { assertTrustedMutationOrigin, sensitiveRateLimitKey } from "./identity-security";
import type { OwnerActivityPublisher } from "./owner-activity-publisher";
import { requiresAgentClientApplicationDecision } from "./application-policy";

const DEFAULT_CAPABILITY_TTL_SECONDS = 15 * 60;
const AUTHORIZATION_WINDOW_MS = 15 * 60 * 1_000;
const AUTHORIZATION_RATE_LIMIT = 12;

const requestedTtlSecondsSchema = z.number().int().min(60).max(3_600);
const createAgentSessionBodySchema = z.strictObject({
  requestedTtlSeconds: requestedTtlSecondsSchema.default(DEFAULT_CAPABILITY_TTL_SECONDS),
});
const createDelegationBodySchema = requestAgentDelegationSchema.omit({
  agentSessionId: true,
  draftId: true,
});
const delegationApprovalInteractionSchema = z.strictObject({
  interaction: z.strictObject({
    channel: z.enum(["first_party_ui", "agent_client"]),
    requestId: entityIdSchema,
    affirmation: z.literal("approved"),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});
const delegationRevocationInteractionSchema = z.strictObject({
  interaction: z.strictObject({
    channel: z.enum(["first_party_ui", "agent_client"]),
    requestId: entityIdSchema,
    affirmation: z.enum(["declined", "revoked"]),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});
const createDataGrantBodySchema = requestDataGrantSchema.omit({ draftId: true }).extend({
  consentRequestId: entityIdSchema.optional(),
  requestedTtlSeconds: requestedTtlSecondsSchema.default(DEFAULT_CAPABILITY_TTL_SECONDS),
});
const grantApprovalInteractionSchema = z.strictObject({
  interaction: z.strictObject({
    channel: z.enum(["first_party_ui", "agent_client"]),
    requestId: entityIdSchema,
    affirmation: z.literal("confirmed"),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});
const grantWithdrawalInteractionSchema = z.strictObject({
  interaction: z.strictObject({
    channel: z.enum(["first_party_ui", "agent_client"]),
    requestId: entityIdSchema,
    affirmation: z.literal("withdrawn"),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});
const submissionDecisionBodySchema = z.strictObject({
  expectedVersion: z.number().int().nonnegative(),
  decision: z.enum(["approved", "declined"]),
  interaction: z.strictObject({
    channel: z.literal("agent_client"),
    requestId: entityIdSchema,
    affirmation: z.enum(["approved", "declined"]),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});
const pendingConsentRecordSchema = applicationSubmissionReviewRequestSchema
  .omit({ fields: true })
  .extend({
    ownerId: entityIdSchema,
    recipientId: entityIdSchema,
    categories: z.array(dataCategorySchema).min(1).max(10),
    fieldKeys: z
      .array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/))
      .min(1)
      .max(24),
    documentIds: z.array(entityIdSchema).max(10),
    legalBasis: legalBasisSchema,
    valuesHash: z.string().regex(/^[a-f0-9]{64}$/),
    createdAt: z.iso.datetime({ offset: true }),
  });
const consentDecisionRecordSchema = applicationSubmissionDecisionReceiptSchema.extend({
  ownerId: entityIdSchema,
  recipientId: entityIdSchema,
  purpose: z.string().trim().min(1).max(240),
  categories: z.array(dataCategorySchema).min(1).max(10),
  fieldKeys: z
    .array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/))
    .min(1)
    .max(24),
  documentIds: z.array(entityIdSchema).max(10),
  noticeVersion: z.string().trim().min(1).max(40),
  legalBasis: legalBasisSchema,
  valuesHash: z.string().regex(/^[a-f0-9]{64}$/),
});

const CONSENT_REQUEST_SCOPE = "application.consent_request";
const CONSENT_DECISION_SCOPE = "application.consent_decision";

type AuthorizationInteractionChannel = "first_party_ui" | "agent_client";

function activityActorKind(channel: AuthorizationInteractionChannel): "human" | "agent" {
  return channel === "agent_client" ? "agent" : "human";
}

function requireAgentClientDecisionChannel(channel: AuthorizationInteractionChannel): void {
  if (channel !== "agent_client") {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Complete this application decision in the external agent client.",
    });
  }
}

export interface AgentSessionTokenSecrets {
  create(): string;
  hash(rawToken: string): string;
}

export interface ApplicationAuthorizationIds {
  agentSession(): string;
  delegation(): string;
  dataGrant(): string;
  interaction(): string;
}

export interface ApplicationDataGrantAuthorizationPolicy {
  consentPresentation(
    ownerId: string,
    draftId: string,
  ): Promise<{
    readonly recipientId: string;
    readonly recipientName: string;
    readonly purpose: string;
    readonly categories: readonly z.infer<typeof dataCategorySchema>[];
    readonly fieldKeys: readonly string[];
    readonly fieldLabels: readonly string[];
    readonly fields: readonly Readonly<{
      fieldKey: string;
      label: string;
      value: ApplicationDraft["answers"][number]["value"];
      sensitive: boolean;
    }>[];
    readonly documentIds: readonly string[];
    readonly noticeVersion: string;
    readonly legalBasis: z.infer<typeof legalBasisSchema>;
    readonly valuesHash: string;
  }>;
  assertDataGrantRequest(
    input: Readonly<{
      ownerId: string;
      draftId: string;
      request: Omit<RequestDataGrant, "draftId">;
    }>,
  ): Promise<void>;
  assertStoredDataGrantCurrent(record: RichDataGrantRecord): Promise<RichDataGrantApprovalGuard>;
}

export interface ApplicationAuthorizationRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly applications: Pick<
    ApplicationRepository,
    "getById" | "getByOwner" | "applyMaterialEdit"
  >;
  readonly jobs: Pick<JobRepository, "getById">;
  readonly agentSessions: AgentSessionRepository;
  readonly delegations: DelegationRepository;
  readonly richDataGrants: RichDataGrantRepository;
  readonly idempotency: IdempotencyRepository;
  readonly dataGrantPolicy: ApplicationDataGrantAuthorizationPolicy;
  readonly ids: ApplicationAuthorizationIds;
  readonly agentTokens: AgentSessionTokenSecrets;
  readonly activity?: OwnerActivityPublisher;
}

export interface DraftRouteContext {
  readonly params: Promise<{ readonly draftId: string }>;
}

export interface AgentSessionRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly sessionId: string }>;
}

export interface DelegationRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly delegationId: string }>;
}

export interface DataGrantRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly grantId: string }>;
}

export interface ConsentDecisionRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly requestId: string }>;
}

export interface ResolvedApplicationAgent {
  readonly draft: ApplicationDraft;
  readonly session: AgentSessionRecord;
}

export interface AuthorizedApplicationAgent extends ResolvedApplicationAgent {
  readonly delegation: AgentDelegationRecord;
}

class AuthorizationRateLimitError extends DomainError {
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super({
      code: "RATE_LIMITED",
      message: "Too many application authorization requests. Try again later.",
      retryable: true,
    });
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function authorizationErrorResponse(error: unknown, requestId: string): Response {
  return apiErrorResponse(error, {
    requestId,
    ...(error instanceof AuthorizationRateLimitError
      ? { retryAfterSeconds: error.retryAfterSeconds }
      : {}),
  });
}

export function createAgentSessionTokenSecrets(): AgentSessionTokenSecrets {
  return {
    create: () => randomBytes(32).toString("base64url"),
    hash: (rawToken) =>
      createHash("sha256")
        .update("jobbbler:application-agent-session:v1\u0000")
        .update(rawToken)
        .digest("hex"),
  };
}

export function createApplicationAuthorizationIds(): ApplicationAuthorizationIds {
  return {
    agentSession: () => createEntityId("agent_session"),
    delegation: () => createEntityId("delegation"),
    dataGrant: () => createEntityId("grant"),
    interaction: () => createEntityId("interaction"),
  };
}

function recordHash(value: unknown): string {
  return createHash("sha256")
    .update("jobbbler:consent-record:v1\u0000")
    .update(JSON.stringify(value))
    .digest("hex");
}

function equalList(left: readonly string[], right: readonly string[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}

function parseEntityId(value: string): string {
  return entityIdSchema.parse(value);
}

function requestedExpiry(
  now: string,
  requestedTtlSeconds: number,
  boundaries: readonly string[] = [],
): string {
  const nowMs = Date.parse(now);
  const requestedMs = nowMs + requestedTtlSeconds * 1_000;
  const boundaryMs = boundaries.map((boundary) => Date.parse(boundary));
  if (boundaryMs.some((boundary) => !Number.isFinite(boundary))) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The stored authorization boundary is invalid.",
    });
  }
  const expiresAtMs = Math.min(requestedMs, ...boundaryMs);
  if (!Number.isFinite(nowMs) || !Number.isFinite(expiresAtMs) || expiresAtMs <= nowMs) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The requested authorization would already be expired.",
    });
  }
  return new Date(expiresAtMs).toISOString();
}

async function enforceAuthorizationRateLimit(
  request: Request,
  scope: string,
  principal: string,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<void> {
  const keys = [
    sensitiveRateLimitKey(
      `application-authorization:${scope}`,
      principal,
      dependencies.identity.environment,
    ),
  ];
  if (dependencies.identity.environment["TRUST_PROXY_HEADERS"] === "true") {
    keys.unshift(
      getRateLimitKey(
        request,
        `application-authorization:${scope}`,
        dependencies.identity.environment,
      ),
    );
  }
  for (const key of keys) {
    const decision = await dependencies.identity.rateLimiter.check({
      key,
      limit: AUTHORIZATION_RATE_LIMIT,
      windowMs: AUTHORIZATION_WINDOW_MS,
      nowMs: dependencies.identity.nowMs(),
    });
    if (!decision.allowed) throw new AuthorizationRateLimitError(decision.retryAfterSeconds);
  }
}

function invalidAgentCredential(): DomainError {
  return new DomainError({
    code: "UNAUTHORIZED",
    message: "A valid application agent token is required.",
  });
}

export function applicationAgentBearerToken(request: Request): string {
  const header = request.headers.get("authorization");
  if (header === null || header.length > 96) throw invalidAgentCredential();
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/.exec(header);
  if (match === null) throw invalidAgentCredential();
  const rawToken = match[1]!;
  const decoded = Buffer.from(rawToken, "base64url");
  if (decoded.length !== 32 || decoded.toString("base64url") !== rawToken) {
    throw invalidAgentCredential();
  }
  return rawToken;
}

async function requireHumanDraft(
  request: Request,
  draftId: string,
  scope: string,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<{ readonly draft: ApplicationDraft; readonly ownerId: string }> {
  assertTrustedMutationOrigin(request, dependencies.identity.environment);
  if (request.headers.has("authorization")) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "This authorization decision requires the human application workspace.",
    });
  }
  const current = await requireOwnerSession(request, dependencies.identity);
  await enforceAuthorizationRateLimit(request, scope, current.owner.id, dependencies);
  const draft = await dependencies.applications.getByOwner(draftId, current.owner.id);
  if (draft === null) {
    throw new DomainError({ code: "NOT_FOUND", message: "Application draft was not found." });
  }
  return { draft, ownerId: current.owner.id };
}

async function applicationJob(
  draft: ApplicationDraft,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Job> {
  const job = await dependencies.jobs.getById(draft.jobId);
  if (job === null) {
    throw new DomainError({ code: "NOT_FOUND", message: "Application job was not found." });
  }
  return job;
}

async function applicationJobMode(
  draft: ApplicationDraft,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<"internal" | "external"> {
  return (await applicationJob(draft, dependencies)).applyMode;
}

async function requireInternalApplicationDraft(
  draft: ApplicationDraft,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<void> {
  const job = await applicationJob(draft, dependencies);
  if (job.applyMode === "external") {
    throw new DomainError({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
  }
  if (job.status !== "open") {
    throw new DomainError({
      code: "CONFLICT",
      message: "Role closed — nothing submitted.",
    });
  }
}

export async function requireApplicationAgentSession(
  request: Request,
  draftId: string,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<ResolvedApplicationAgent> {
  assertTrustedMutationOrigin(request, dependencies.identity.environment);
  const rawToken = applicationAgentBearerToken(request);
  const tokenHash = dependencies.agentTokens.hash(rawToken);
  await enforceAuthorizationRateLimit(request, "agent-token", tokenHash, dependencies);
  const draft = await dependencies.applications.getById(draftId);
  if (draft === null) throw invalidAgentCredential();
  const session = await dependencies.agentSessions.resolve({
    tokenHash,
    ownerId: draft.ownerId,
    draftId,
    now: dependencies.identity.now(),
  });
  if (session === null) throw invalidAgentCredential();
  return { draft, session };
}

export async function requireAgentOperation(
  request: Request,
  draftId: string,
  operation: AgentOperation,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<AuthorizedApplicationAgent> {
  const resolved = await requireApplicationAgentSession(request, draftId, dependencies);
  const input: ActiveDelegationMatchInput = {
    ownerId: resolved.draft.ownerId,
    agentSessionId: resolved.session.id,
    resourceType: "application_draft",
    resourceId: draftId,
    operation,
    now: dependencies.identity.now(),
  };
  const delegation = await dependencies.delegations.getActiveMatch(input);
  if (delegation === null) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "An active delegation does not allow this application operation.",
    });
  }
  return { ...resolved, delegation };
}

export async function requireCurrentDataGrant(
  input: Omit<RichDataGrantMatchInput, "now">,
  dependencies: Pick<ApplicationAuthorizationRouteDependencies, "identity" | "richDataGrants">,
): Promise<RichDataGrantRecord> {
  const grant = await dependencies.richDataGrants.getCurrent({
    ...input,
    now: dependencies.identity.now(),
  });
  if (grant === null) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "An active data grant does not cover this exact disclosure.",
    });
  }
  return grant;
}

function delegationSummary(record: AgentDelegationRecord): ApplicationDelegationSummary {
  return applicationDelegationSummarySchema.parse({
    id: record.id,
    agentSessionId: record.agentSessionId,
    operations: record.operations,
    purpose: record.purpose,
    status: record.status,
    expiresAt: record.expiresAt,
    approvedAt: record.approvedAt,
  });
}

function dataGrantSummary(record: RichDataGrantRecord): ApplicationDataGrantSummary {
  return applicationDataGrantSummarySchema.parse({
    id: record.id,
    status: record.status,
    expiresAt: record.expiresAt,
    decisionChannel:
      record.approvalChannel ??
      (record.approvalRequestId === null || record.approvalRequestId === undefined
        ? "first_party_ui"
        : "agent_client"),
    decisionRequestId: record.approvalRequestId ?? record.id,
  });
}

function submissionDecisionReceipt(record: z.infer<typeof consentDecisionRecordSchema>) {
  return applicationSubmissionDecisionReceiptSchema.parse({
    requestId: record.requestId,
    draftId: record.draftId,
    decision: record.decision,
    acceptedDraftVersion: record.acceptedDraftVersion,
    decidedAt: record.decidedAt,
    channel: record.channel,
    evidenceVersion: record.evidenceVersion,
  });
}

async function publishAuthorizationActivity(
  dependencies: ApplicationAuthorizationRouteDependencies,
  input: Readonly<{
    ownerId: string;
    requestId: string;
    key: string;
    status: "completed" | "requires_user_action";
    safeSummary: string;
    actorKind: "human" | "agent";
    draftVersion: number;
    occurredAt: string;
  }>,
): Promise<void> {
  await dependencies.activity?.publish({
    ownerId: input.ownerId,
    correlationId: input.requestId,
    kind:
      input.key.includes("grant") || input.key.includes("consent") ? "consent" : "authorization",
    key: input.key,
    status: input.status,
    safeSummary: input.safeSummary,
    actorKind: input.actorKind,
    aggregate: { type: "application_draft", version: input.draftVersion },
    occurredAt: input.occurredAt,
    effects: [
      { target: "application", kind: "refresh" },
      { target: "agent_activity", kind: "announce" },
    ],
  });
}

export async function handleCreateAgentSessionRequest(
  request: Request,
  context: DraftRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const human = await requireHumanDraft(request, draftId, "create-agent-session", dependencies);
    await requireInternalApplicationDraft(human.draft, dependencies);
    const parsed = createAgentSessionBodySchema.parse(await readSmallJsonBody(request));
    const rawToken = dependencies.agentTokens.create();
    const now = dependencies.identity.now();
    const record: AgentSessionRecord = {
      id: dependencies.ids.agentSession(),
      ownerId: human.ownerId,
      draftId,
      tokenHash: dependencies.agentTokens.hash(rawToken),
      expiresAt: requestedExpiry(now, parsed.requestedTtlSeconds),
      revokedAt: null,
      createdAt: now,
    };
    const stored = await dependencies.agentSessions.insert(record);
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "create_agent_session",
      status: "completed",
      safeSummary: "Scoped agent session created.",
      actorKind: "human",
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(
      { sessionId: stored.id, token: rawToken, expiresAt: stored.expiresAt },
      { requestId, status: 201 },
    );
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleRevokeAgentSessionRequest(
  request: Request,
  context: AgentSessionRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const sessionId = parseEntityId(params.sessionId);
    const human = await requireHumanDraft(request, draftId, "revoke-agent-session", dependencies);
    const now = dependencies.identity.now();
    const stored = await dependencies.agentSessions.revoke(sessionId, human.ownerId, draftId, now);
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "revoke_agent_session",
      status: "completed",
      safeSummary: "Scoped agent session revoked.",
      actorKind: "human",
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(
      { sessionId: stored.id, expiresAt: stored.expiresAt, revokedAt: stored.revokedAt },
      { requestId },
    );
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleCreateDelegationRequest(
  request: Request,
  context: DraftRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const agent = await requireApplicationAgentSession(request, draftId, dependencies);
    await requireInternalApplicationDraft(agent.draft, dependencies);
    const parsed = createDelegationBodySchema.parse(await readSmallJsonBody(request));
    const now = dependencies.identity.now();
    const requested = requestDelegation({
      id: dependencies.ids.delegation(),
      ownerId: agent.draft.ownerId,
      agentSessionId: agent.session.id,
      resource: { type: "application_draft", id: draftId },
      operations: parsed.operations,
      purpose: parsed.purpose,
      expiresAt: requestedExpiry(now, parsed.requestedTtlSeconds, [agent.session.expiresAt]),
      now,
    });
    await publishAuthorizationActivity(dependencies, {
      ownerId: agent.draft.ownerId,
      requestId,
      key: "request_agent_access",
      status: "requires_user_action",
      safeSummary: "Agent requested scoped application access.",
      actorKind: "agent",
      draftVersion: agent.draft.version,
      occurredAt: now,
    });
    const stored = await dependencies.delegations.insert({
      id: requested.id,
      ownerId: requested.ownerId,
      agentSessionId: requested.agentSessionId,
      resourceType: requested.resource.type,
      resourceId: requested.resource.id,
      operations: requested.operations,
      purpose: requested.purpose,
      status: requested.status,
      expiresAt: requested.expiresAt,
      createdAt: requested.requestedAt,
      approvedAt: requested.approvedAt,
      revokedAt: requested.revokedAt,
    });
    return apiSuccessResponse(delegationSummary(stored), { requestId, status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleApproveDelegationRequest(
  request: Request,
  context: DelegationRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const delegationId = parseEntityId(params.delegationId);
    const human = await requireHumanDraft(request, draftId, "approve-delegation", dependencies);
    await requireInternalApplicationDraft(human.draft, dependencies);
    const requested = await dependencies.delegations.getById(delegationId, human.ownerId);
    if (requested === null || requested.resourceId !== draftId) {
      throw new DomainError({ code: "NOT_FOUND", message: "Delegation request was not found." });
    }
    const { interaction } = delegationApprovalInteractionSchema.parse(
      await readSmallJsonBody(request),
    );
    requireAgentClientDecisionChannel(interaction.channel);
    if (interaction.requestId !== delegationId) {
      throw new DomainError({
        code: "VALIDATION",
        message: "The assistance decision is not bound to this exact request.",
      });
    }
    const now = dependencies.identity.now();
    const stored = await dependencies.delegations.approve(delegationId, human.ownerId, now, {
      channel: interaction.channel,
      requestId: interaction.requestId,
      action: interaction.affirmation,
      evidenceVersion: interaction.evidenceVersion,
    });
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "approve_agent_access",
      status: "completed",
      safeSummary:
        interaction.channel === "agent_client"
          ? "Scoped application assistance approved through the agent client."
          : "Scoped application assistance approved in the private workspace.",
      actorKind: activityActorKind(interaction.channel),
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(delegationSummary(stored), { requestId });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleRevokeDelegationRequest(
  request: Request,
  context: DelegationRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const delegationId = parseEntityId(params.delegationId);
    const human = await requireHumanDraft(request, draftId, "revoke-delegation", dependencies);
    const existing = await dependencies.delegations.getById(delegationId, human.ownerId);
    if (existing === null || existing.resourceId !== draftId) {
      throw new DomainError({ code: "NOT_FOUND", message: "Delegation request was not found." });
    }
    const { interaction } = delegationRevocationInteractionSchema.parse(
      await readSmallJsonBody(request),
    );
    requireAgentClientDecisionChannel(interaction.channel);
    if (interaction.requestId !== delegationId) {
      throw new DomainError({
        code: "VALIDATION",
        message: "The assistance decision is not bound to this exact request.",
      });
    }
    const expectedAction = existing.status === "requested" ? "declined" : "revoked";
    if (existing.status !== "revoked" && interaction.affirmation !== expectedAction) {
      throw new DomainError({
        code: "VALIDATION",
        message: `This assistance request must be ${expectedAction}.`,
      });
    }
    const now = dependencies.identity.now();
    const stored = await dependencies.delegations.revoke(delegationId, human.ownerId, now, {
      channel: interaction.channel,
      requestId: interaction.requestId,
      action: interaction.affirmation,
      evidenceVersion: interaction.evidenceVersion,
    });
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "revoke_agent_access",
      status: "completed",
      safeSummary:
        interaction.affirmation === "declined"
          ? "Scoped application assistance declined."
          : "Scoped application assistance revoked.",
      actorKind: activityActorKind(interaction.channel),
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(delegationSummary(stored), { requestId });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleCreateSubmissionReviewRequest(
  request: Request,
  context: DraftRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const actor = request.headers.has("authorization")
      ? await requireAgentOperation(request, draftId, "request_data_consent", dependencies)
      : await requireHumanDraft(request, draftId, "request-submission-review", dependencies);
    await requireInternalApplicationDraft(actor.draft, dependencies);
    const ownerId = actor.draft.ownerId;
    const draft = actor.draft;
    const presentation = await dependencies.dataGrantPolicy.consentPresentation(ownerId, draftId);
    const now = dependencies.identity.now();
    const id = dependencies.ids.interaction();
    const record = pendingConsentRecordSchema.parse({
      id,
      draftId,
      draftVersion: draft.version,
      recipient: presentation.recipientName,
      purpose: presentation.purpose,
      noticeVersion: presentation.noticeVersion,
      expiresAt: new Date(Date.parse(now) + 5 * 60_000).toISOString(),
      ownerId,
      recipientId: presentation.recipientId,
      categories: presentation.categories,
      fieldKeys: presentation.fieldKeys,
      documentIds: presentation.documentIds,
      legalBasis: presentation.legalBasis,
      valuesHash: presentation.valuesHash,
      createdAt: now,
    });
    await dependencies.idempotency.putIfAbsent({
      scope: CONSENT_REQUEST_SCOPE,
      key: id,
      requestHash: recordHash(record),
      responseStatus: 201,
      responseBody: record,
      createdAt: now,
      expiresAt: record.expiresAt,
    });
    return apiSuccessResponse(
      applicationSubmissionReviewRequestSchema.parse({
        id: record.id,
        draftId: record.draftId,
        draftVersion: record.draftVersion,
        recipient: record.recipient,
        purpose: record.purpose,
        fields: presentation.fields,
        noticeVersion: record.noticeVersion,
        expiresAt: record.expiresAt,
      }),
      {
        requestId,
        status: 201,
      },
    );
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleDecideSubmissionReviewRequest(
  request: Request,
  context: ConsentDecisionRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const interactionRequestId = parseEntityId(params.requestId);
    const human = await requireHumanDraft(
      request,
      draftId,
      "decide-submission-review",
      dependencies,
    );
    await requireInternalApplicationDraft(human.draft, dependencies);
    const parsed = submissionDecisionBodySchema.parse(await readSmallJsonBody(request));
    if (
      parsed.interaction.requestId !== interactionRequestId ||
      parsed.interaction.affirmation !== parsed.decision
    ) {
      throw new DomainError({
        code: "VALIDATION",
        message: "The decision must match the exact pending interaction request.",
      });
    }
    const storedRequest = await dependencies.idempotency.get(
      CONSENT_REQUEST_SCOPE,
      interactionRequestId,
    );
    if (storedRequest === null) {
      throw new DomainError({ code: "NOT_FOUND", message: "Consent request was not found." });
    }
    const pending = pendingConsentRecordSchema.parse(storedRequest.responseBody);
    const now = dependencies.identity.now();
    if (
      pending.ownerId !== human.ownerId ||
      pending.draftId !== draftId ||
      pending.draftVersion !== parsed.expectedVersion ||
      pending.expiresAt <= now
    ) {
      throw new DomainError({
        code: "CONFLICT",
        message: "The consent request is stale, expired, or belongs to another application.",
      });
    }
    const presentation = await dependencies.dataGrantPolicy.consentPresentation(
      human.ownerId,
      draftId,
    );
    if (
      presentation.valuesHash !== pending.valuesHash ||
      presentation.recipientId !== pending.recipientId ||
      presentation.purpose !== pending.purpose ||
      presentation.noticeVersion !== pending.noticeVersion ||
      presentation.legalBasis !== pending.legalBasis ||
      !equalList(presentation.fieldKeys, pending.fieldKeys) ||
      !equalList(presentation.categories, pending.categories)
    ) {
      throw new DomainError({
        code: "CONFLICT",
        message: "The application changed after the consent request was presented.",
      });
    }
    const previousDecision = await dependencies.idempotency.get(
      CONSENT_DECISION_SCOPE,
      interactionRequestId,
    );
    if (previousDecision !== null) {
      const previous = consentDecisionRecordSchema.parse(previousDecision.responseBody);
      if (previous.decision !== parsed.decision) {
        throw new DomainError({
          code: "CONFLICT",
          message: "This consent request already has a different decision.",
        });
      }
      return apiSuccessResponse(submissionDecisionReceipt(previous), {
        requestId,
      });
    }

    let acceptedDraftVersion = human.draft.version;
    if (parsed.decision === "approved") {
      const coveredFields = new Set(pending.fieldKeys);
      const acceptedAnswers = human.draft.answers.map((answer) =>
        coveredFields.has(answer.fieldKey) ? { ...answer, acceptedByHuman: true } : answer,
      );
      const materiallyChanged = human.draft.answers.some(
        (answer) => coveredFields.has(answer.fieldKey) && !answer.acceptedByHuman,
      );
      if (materiallyChanged) {
        const accepted = await dependencies.applications.applyMaterialEdit({
          ownerId: human.ownerId,
          expectedVersion: human.draft.version,
          draft: {
            ...human.draft,
            answers: acceptedAnswers,
            state: "draft",
            version: human.draft.version + 1,
            updatedAt: now,
          },
          now,
        });
        acceptedDraftVersion = accepted.version;
      }
    }
    const decision = consentDecisionRecordSchema.parse({
      requestId: interactionRequestId,
      draftId,
      decision: parsed.decision,
      acceptedDraftVersion,
      decidedAt: now,
      channel: parsed.interaction.channel,
      evidenceVersion: parsed.interaction.evidenceVersion,
      ownerId: human.ownerId,
      recipientId: pending.recipientId,
      purpose: pending.purpose,
      categories: pending.categories,
      fieldKeys: pending.fieldKeys,
      documentIds: pending.documentIds,
      noticeVersion: pending.noticeVersion,
      legalBasis: pending.legalBasis,
      valuesHash: pending.valuesHash,
    });
    await dependencies.idempotency.putIfAbsent({
      scope: CONSENT_DECISION_SCOPE,
      key: interactionRequestId,
      requestHash: recordHash(decision),
      responseStatus: 200,
      responseBody: decision,
      createdAt: now,
      expiresAt: new Date(Date.parse(now) + 365 * 24 * 60 * 60_000).toISOString(),
    });
    if (parsed.decision === "declined") {
      await publishAuthorizationActivity(dependencies, {
        ownerId: human.ownerId,
        requestId,
        key: "decide_application_submission",
        status: "completed",
        safeSummary: "Application disclosure declined through the agent client.",
        actorKind: activityActorKind(parsed.interaction.channel),
        draftVersion: acceptedDraftVersion,
        occurredAt: now,
      });
    }
    return apiSuccessResponse(submissionDecisionReceipt(decision), {
      requestId,
    });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

async function dataGrantRequester(
  request: Request,
  draftId: string,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<{
  readonly ownerId: string;
  readonly boundaries: readonly string[];
  readonly actorKind: "human" | "agent";
  readonly draftVersion: number;
}> {
  if (request.headers.has("authorization")) {
    const agent = await requireAgentOperation(
      request,
      draftId,
      "request_data_consent",
      dependencies,
    );
    await requireInternalApplicationDraft(agent.draft, dependencies);
    return {
      ownerId: agent.draft.ownerId,
      boundaries: [agent.session.expiresAt, agent.delegation.expiresAt],
      actorKind: "agent",
      draftVersion: agent.draft.version,
    };
  }
  const human = await requireHumanDraft(request, draftId, "request-data-grant", dependencies);
  await requireInternalApplicationDraft(human.draft, dependencies);
  return {
    ownerId: human.ownerId,
    boundaries: [],
    actorKind: "human",
    draftVersion: human.draft.version,
  };
}

export async function handleCreateDataGrantRequest(
  request: Request,
  context: DraftRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const requester = await dataGrantRequester(request, draftId, dependencies);
    const parsed = createDataGrantBodySchema.parse(await readSmallJsonBody(request));
    const now = dependencies.identity.now();
    const policyRequest = {
      recipientId: parsed.recipientId,
      purpose: parsed.purpose,
      payloadHash: parsed.payloadHash,
      categories: parsed.categories,
      fieldKeys: parsed.fieldKeys,
      documentIds: parsed.documentIds,
      noticeVersion: parsed.noticeVersion,
      legalBasis: parsed.legalBasis,
    } satisfies Omit<RequestDataGrant, "draftId">;
    await dependencies.dataGrantPolicy.assertDataGrantRequest({
      ownerId: requester.ownerId,
      draftId,
      request: policyRequest,
    });
    if (
      requester.actorKind === "agent" &&
      policyRequest.legalBasis === "consent" &&
      parsed.consentRequestId === undefined
    ) {
      throw new DomainError({
        code: "FORBIDDEN",
        message: "Agent-client disclosure requires an approved server consent request.",
      });
    }
    if (parsed.consentRequestId !== undefined) {
      const storedDecision = await dependencies.idempotency.get(
        CONSENT_DECISION_SCOPE,
        parsed.consentRequestId,
      );
      if (storedDecision === null) {
        throw new DomainError({
          code: "FORBIDDEN",
          message: "The server has no approved decision for this consent request.",
        });
      }
      const decision = consentDecisionRecordSchema.parse(storedDecision.responseBody);
      const presentation = await dependencies.dataGrantPolicy.consentPresentation(
        requester.ownerId,
        draftId,
      );
      if (
        decision.ownerId !== requester.ownerId ||
        decision.draftId !== draftId ||
        decision.decision !== "approved" ||
        decision.recipientId !== policyRequest.recipientId ||
        decision.purpose !== policyRequest.purpose ||
        decision.noticeVersion !== policyRequest.noticeVersion ||
        decision.legalBasis !== policyRequest.legalBasis ||
        decision.valuesHash !== presentation.valuesHash ||
        !equalList(decision.fieldKeys, policyRequest.fieldKeys) ||
        !equalList(decision.categories, policyRequest.categories) ||
        !equalList(decision.documentIds, policyRequest.documentIds) ||
        !equalList(presentation.fieldKeys, decision.fieldKeys) ||
        !equalList(presentation.categories, decision.categories) ||
        !equalList(presentation.documentIds, decision.documentIds)
      ) {
        throw new DomainError({
          code: "CONFLICT",
          message: "The approved consent request does not match this reviewed disclosure.",
        });
      }
    }
    const requested = requestDataGrant({
      id: dependencies.ids.dataGrant(),
      ownerId: requester.ownerId,
      draftId,
      recipientId: policyRequest.recipientId,
      purpose: policyRequest.purpose,
      payloadHash: policyRequest.payloadHash,
      categories: policyRequest.categories,
      fieldKeys: policyRequest.fieldKeys,
      documentIds: policyRequest.documentIds,
      expiresAt: requestedExpiry(now, parsed.requestedTtlSeconds, requester.boundaries),
      now,
    });
    await publishAuthorizationActivity(dependencies, {
      ownerId: requester.ownerId,
      requestId,
      key: "request_data_consent",
      status: "requires_user_action",
      safeSummary: "Purpose-bound data permission requested.",
      actorKind: requester.actorKind,
      draftVersion: requester.draftVersion,
      occurredAt: now,
    });
    const stored = await dependencies.richDataGrants.insert(
      {
        id: requested.id,
        ownerId: requested.ownerId,
        draftId: requested.draftId,
        recipientId: requested.recipientId,
        purpose: requested.purpose,
        payloadHash: requested.payloadHash,
        categories: requested.categories,
        fieldKeys: requested.fieldKeys,
        documentIds: requested.documentIds,
        noticeVersion: policyRequest.noticeVersion,
        legalBasis: policyRequest.legalBasis,
        status: requested.status,
        expiresAt: requested.expiresAt,
        createdAt: requested.requestedAt,
        approvedAt: requested.approvedAt,
        withdrawnAt: requested.withdrawnAt,
        ...(parsed.consentRequestId === undefined
          ? {}
          : { approvalRequestId: parsed.consentRequestId }),
      },
      now,
    );
    return apiSuccessResponse(dataGrantSummary(stored), { requestId, status: 201 });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleApproveDataGrantRequest(
  request: Request,
  context: DataGrantRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const grantId = parseEntityId(params.grantId);
    const human = await requireHumanDraft(request, draftId, "approve-data-grant", dependencies);
    await requireInternalApplicationDraft(human.draft, dependencies);
    const requested = await dependencies.richDataGrants.getById(grantId, human.ownerId, draftId);
    if (requested === null) {
      throw new DomainError({ code: "NOT_FOUND", message: "Data grant request was not found." });
    }
    const guard = await dependencies.dataGrantPolicy.assertStoredDataGrantCurrent(requested);
    const { interaction } = grantApprovalInteractionSchema.parse(await readSmallJsonBody(request));
    const now = dependencies.identity.now();
    const delegations = await dependencies.delegations.listByResource(human.ownerId, draftId);
    if (
      interaction.channel === "first_party_ui" &&
      (requested.approvalRequestId !== null && requested.approvalRequestId !== undefined
        ? true
        : requiresAgentClientApplicationDecision(human.draft, delegations, now))
    ) {
      throw new DomainError({
        code: "FORBIDDEN",
        message:
          "Complete consent and submission decisions for this agent-assisted draft in the external agent client.",
      });
    }
    const isBoundToApproval =
      interaction.channel === "first_party_ui"
        ? interaction.requestId === grantId
        : requested.approvalRequestId !== null &&
          requested.approvalRequestId !== undefined &&
          interaction.requestId === requested.approvalRequestId;
    if (!isBoundToApproval) {
      throw new DomainError({
        code: "VALIDATION",
        message: "The approval action is not bound to the reviewed permission request.",
      });
    }
    const stored = await dependencies.richDataGrants.approveCurrent({
      id: grantId,
      ownerId: human.ownerId,
      draftId,
      at: now,
      approvalEvidence: {
        channel: interaction.channel,
        requestId: interaction.requestId,
        affirmativeAction: interaction.affirmation,
        evidenceVersion: interaction.evidenceVersion,
      },
      ...guard,
    });
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "approve_data_grant",
      status: "completed",
      safeSummary:
        interaction.channel === "agent_client"
          ? "Exact reviewed data permission approved through the agent client."
          : "Exact reviewed data permission approved in the private workspace.",
      actorKind: activityActorKind(interaction.channel),
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(dataGrantSummary(stored), { requestId });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleWithdrawDataGrantRequest(
  request: Request,
  context: DataGrantRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const grantId = parseEntityId(params.grantId);
    const human = await requireHumanDraft(request, draftId, "withdraw-data-grant", dependencies);
    const existing = await dependencies.richDataGrants.getById(grantId, human.ownerId, draftId);
    if (existing === null) {
      throw new DomainError({ code: "NOT_FOUND", message: "Data grant request was not found." });
    }
    const now = dependencies.identity.now();
    const stored = await dependencies.richDataGrants.withdraw(grantId, human.ownerId, draftId, now);
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "withdraw_data_grant",
      status: "completed",
      safeSummary: "Application data permission withdrawn.",
      actorKind: "human",
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(dataGrantSummary(stored), { requestId });
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}

export async function handleWithdrawApplicationConsentRequest(
  request: Request,
  context: DraftRouteContext,
  dependencies: ApplicationAuthorizationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const human = await requireHumanDraft(request, draftId, "withdraw-consent", dependencies);
    const applyMode = await applicationJobMode(human.draft, dependencies);
    const { interaction } = grantWithdrawalInteractionSchema.parse(
      await readSmallJsonBody(request),
    );
    const now = dependencies.identity.now();
    const grants = await dependencies.richDataGrants.listByDraft(human.ownerId, draftId);
    const liveConsentGrants = grants.filter(
      (grant) =>
        grant.legalBasis === "consent" &&
        (grant.status === "requested" || grant.status === "active"),
    );
    const withdrawn = [];
    for (const grant of liveConsentGrants) {
      withdrawn.push(
        await dependencies.richDataGrants.withdraw(grant.id, human.ownerId, draftId, now, {
          channel: interaction.channel,
          requestId: interaction.requestId,
          action: interaction.affirmation,
          evidenceVersion: interaction.evidenceVersion,
        }),
      );
    }
    const boundaryDraft =
      applyMode === "external" ||
      human.draft.state === "submitted" ||
      human.draft.state === "handed_off"
        ? human.draft
        : await dependencies.applications.applyMaterialEdit({
            ownerId: human.ownerId,
            expectedVersion: human.draft.version,
            draft: {
              ...human.draft,
              state: "draft",
              version: human.draft.version + 1,
              consentRevision: (human.draft.consentRevision ?? 0) + 1,
              answers: human.draft.answers.map((answer) => ({
                ...answer,
                acceptedByHuman: false,
              })),
              updatedAt: now,
            },
            now,
          });
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "withdraw_application_consent",
      status: "completed",
      safeSummary:
        withdrawn.length === 0
          ? "No active application consent remained to withdraw."
          : "Application consent withdrawn; future consent-based processing stopped.",
      actorKind: activityActorKind(interaction.channel),
      draftVersion: boundaryDraft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(
      applicationConsentWithdrawalSchema.parse({
        draftId,
        withdrawnGrantIds: withdrawn.map(({ id }) => id),
        withdrawnAt: now,
        futureConsentProcessingStopped: true,
        pastSubmissionUnaffected: true,
      }),
      { requestId },
    );
  } catch (error) {
    return authorizationErrorResponse(error, requestId);
  }
}
