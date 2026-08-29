import { createHash, randomBytes } from "node:crypto";

import { z } from "zod";

import {
  applicationDataGrantSummarySchema,
  applicationDelegationSummarySchema,
  entityIdSchema,
  requestAgentDelegationSchema,
  requestDataGrantSchema,
  type AgentOperation,
  type ApplicationDraft,
  type ApplicationDataGrantSummary,
  type ApplicationDelegationSummary,
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
const createDataGrantBodySchema = requestDataGrantSchema.omit({ draftId: true }).extend({
  requestedTtlSeconds: requestedTtlSecondsSchema.default(DEFAULT_CAPABILITY_TTL_SECONDS),
});
const grantApprovalInteractionSchema = z.strictObject({
  interaction: z.strictObject({
    channel: z.literal("first_party_ui"),
    requestId: entityIdSchema,
    affirmation: z.literal("confirmed"),
    evidenceVersion: z.literal("agent-interaction-v1"),
  }),
});

export interface AgentSessionTokenSecrets {
  create(): string;
  hash(rawToken: string): string;
}

export interface ApplicationAuthorizationIds {
  agentSession(): string;
  delegation(): string;
  dataGrant(): string;
}

export interface ApplicationDataGrantAuthorizationPolicy {
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
  readonly applications: Pick<ApplicationRepository, "getById" | "getByOwner">;
  readonly agentSessions: AgentSessionRepository;
  readonly delegations: DelegationRepository;
  readonly richDataGrants: RichDataGrantRepository;
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
  };
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
    const requested = await dependencies.delegations.getById(delegationId, human.ownerId);
    if (requested === null || requested.resourceId !== draftId) {
      throw new DomainError({ code: "NOT_FOUND", message: "Delegation request was not found." });
    }
    const now = dependencies.identity.now();
    const stored = await dependencies.delegations.approve(delegationId, human.ownerId, now);
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "approve_agent_access",
      status: "completed",
      safeSummary: "Scoped agent access approved.",
      actorKind: "human",
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
    const now = dependencies.identity.now();
    const stored = await dependencies.delegations.revoke(delegationId, human.ownerId, now);
    await publishAuthorizationActivity(dependencies, {
      ownerId: human.ownerId,
      requestId,
      key: "revoke_agent_access",
      status: "completed",
      safeSummary: "Scoped agent access revoked.",
      actorKind: "human",
      draftVersion: human.draft.version,
      occurredAt: now,
    });
    return apiSuccessResponse(delegationSummary(stored), { requestId });
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
    return {
      ownerId: agent.draft.ownerId,
      boundaries: [agent.session.expiresAt, agent.delegation.expiresAt],
      actorKind: "agent",
      draftVersion: agent.draft.version,
    };
  }
  const human = await requireHumanDraft(request, draftId, "request-data-grant", dependencies);
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
    const stored = await dependencies.richDataGrants.insert({
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
    });
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
    const requested = await dependencies.richDataGrants.getById(grantId, human.ownerId, draftId);
    if (requested === null) {
      throw new DomainError({ code: "NOT_FOUND", message: "Data grant request was not found." });
    }
    const guard = await dependencies.dataGrantPolicy.assertStoredDataGrantCurrent(requested);
    const { interaction } = grantApprovalInteractionSchema.parse(await readSmallJsonBody(request));
    if (interaction.requestId !== grantId) {
      throw new DomainError({
        code: "VALIDATION",
        message: "The approval action is not bound to the pending data permission request.",
      });
    }
    const now = dependencies.identity.now();
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
      safeSummary: "Exact reviewed data permission approved in the private workspace.",
      actorKind: "human",
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
