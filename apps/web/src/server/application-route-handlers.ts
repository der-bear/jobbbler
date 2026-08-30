import { createHash, randomBytes } from "node:crypto";

import {
  entityIdSchema,
  type AgentOperation,
  type ApplicationDraft,
  type ApplicationListItem,
  type ApplicationReceiptSummary,
  type ApplicationReviewSummary,
  type ApplicationStartResult,
  type ApplicationWorkspace,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";

import {
  requireAgentOperation,
  type ApplicationAuthorizationRouteDependencies,
} from "./application-authorization-route-handlers";
import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { readBoundedJsonBody } from "./bounded-json-body";
import { createRequestId } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";
import { assertTrustedMutationOrigin } from "./identity-security";
import type { OwnerActivityPublisher } from "./owner-activity-publisher";
import { requiresAgentClientApplicationDecision } from "./application-policy";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface ApplicationActor {
  readonly kind: "human" | "agent";
  readonly ownerId: string;
}

export interface ApplicationRouteContext {
  readonly params: Promise<{ readonly draftId: string; readonly reviewId: string }>;
}

export interface ConfirmationSecrets {
  create(): string;
  hash(raw: string): string;
}

export interface ApplicationOperations {
  list(ownerId: string, now: string): Promise<readonly ApplicationListItem[]>;
  start(ownerId: string, raw: unknown, now: string): Promise<ApplicationStartResult>;
  get(ownerId: string, draftId: string, now: string): Promise<ApplicationWorkspace>;
  answer(
    actor: ApplicationActor,
    draftId: string,
    raw: unknown,
    now: string,
  ): Promise<ApplicationDraft>;
  validate(actor: ApplicationActor, draftId: string, now: string): Promise<ApplicationDraft>;
  review(
    actor: ApplicationActor,
    draftId: string,
    raw: unknown,
    now: string,
  ): Promise<ApplicationReviewSummary>;
  submit(
    actor: ApplicationActor,
    draftId: string,
    raw: unknown,
    confirmationHash: string,
    now: string,
  ): Promise<ApplicationReceiptSummary>;
  requestConfirmation(
    ownerId: string,
    draftId: string,
    reviewId: string,
    confirmationHash: string,
    now: string,
  ): Promise<{ readonly id: string; readonly expiresAt: string }>;
}

export interface ApplicationRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly authorization: ApplicationAuthorizationRouteDependencies;
  readonly operations: ApplicationOperations;
  readonly confirmation: ConfirmationSecrets;
  readonly activity?: OwnerActivityPublisher;
}

const MAX_APPLICATION_BODY_BYTES = 12_500;

export function createConfirmationSecrets(): ConfirmationSecrets {
  return {
    create: () => randomBytes(32).toString("base64url"),
    hash: (raw) =>
      createHash("sha256").update("jobbbler:confirmation:v1\u0000").update(raw).digest("hex"),
  };
}

async function readApplicationJsonBody(request: Request): Promise<unknown> {
  return readBoundedJsonBody(request, {
    maxBytes: MAX_APPLICATION_BODY_BYTES,
    emptyMessage: "Expected a bounded JSON request body.",
  });
}

function parseEntityId(value: string): string {
  return entityIdSchema.parse(value);
}

function confirmationCookieName(environment: RuntimeEnvironment): string {
  return environment["NODE_ENV"] === "production"
    ? "__Host-jobbbler_confirmation"
    : "jobbbler_confirmation";
}

function serializeConfirmationCookie(raw: string, environment: RuntimeEnvironment): string {
  const parts = [
    `${confirmationCookieName(environment)}=${raw}`,
    "Path=/",
    "HttpOnly",
    "SameSite=Strict",
    "Priority=High",
    "Max-Age=300",
  ];
  if (environment["NODE_ENV"] === "production") parts.push("Secure");
  return parts.join("; ");
}

async function requireHumanActor(
  request: Request,
  dependencies: ApplicationRouteDependencies,
): Promise<ApplicationActor> {
  if (request.headers.has("authorization")) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "This action requires the human application workspace.",
    });
  }
  const owner = await requireOwnerSession(request, dependencies.identity);
  return { kind: "human", ownerId: owner.owner.id };
}

async function requireApplicationActor(
  request: Request,
  draftId: string,
  operation: AgentOperation,
  dependencies: ApplicationRouteDependencies,
): Promise<ApplicationActor> {
  if (request.headers.has("authorization")) {
    const agent = await requireAgentOperation(
      request,
      draftId,
      operation,
      dependencies.authorization,
    );
    return { kind: "agent", ownerId: agent.draft.ownerId };
  }
  return requireHumanActor(request, dependencies);
}

async function requireFirstPartyApplicationDecisionAllowed(
  actor: ApplicationActor,
  draftId: string,
  dependencies: ApplicationRouteDependencies,
): Promise<ApplicationWorkspace | null> {
  if (actor.kind !== "human") return null;
  const [workspace, delegations] = await Promise.all([
    dependencies.operations.get(actor.ownerId, draftId, dependencies.identity.now()),
    dependencies.authorization.delegations.listByResource(actor.ownerId, draftId),
  ]);
  if (requiresAgentClientApplicationDecision(workspace.draft, delegations)) {
    throw new DomainError({
      code: "FORBIDDEN",
      message:
        "Complete consent and submission decisions for this agent-assisted draft in the external agent client.",
    });
  }
  return workspace;
}

export async function handleRequestConfirmation(
  request: Request,
  context: ApplicationRouteContext,
  dependencies: ApplicationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const params = await context.params;
    const draftId = parseEntityId(params.draftId);
    const reviewId = parseEntityId(params.reviewId);
    const actor = await requireApplicationActor(
      request,
      draftId,
      "request_confirmation",
      dependencies,
    );
    const decisionWorkspace = await requireFirstPartyApplicationDecisionAllowed(
      actor,
      draftId,
      dependencies,
    );
    const raw = dependencies.confirmation.create();
    const now = dependencies.identity.now();
    const result = await dependencies.operations.requestConfirmation(
      actor.ownerId,
      draftId,
      reviewId,
      dependencies.confirmation.hash(raw),
      now,
    );
    if (dependencies.activity !== undefined) {
      const workspace =
        decisionWorkspace ?? (await dependencies.operations.get(actor.ownerId, draftId, now));
      await dependencies.activity.publish({
        ownerId: actor.ownerId,
        correlationId: requestId,
        kind: "application",
        key: "request_final_confirmation",
        status: "requires_user_action",
        safeSummary: "Final confirmation is ready for the candidate.",
        actorKind: actor.kind,
        aggregate: { type: "application_draft", version: workspace.draft.version },
        occurredAt: now,
        effects: [
          { target: "application", kind: "focus" },
          { target: "agent_activity", kind: "announce" },
        ],
      });
    }
    return apiSuccessResponse(
      { confirmationId: result.id, expiresAt: result.expiresAt },
      {
        requestId,
        status: 201,
        headers: {
          "set-cookie": serializeConfirmationCookie(raw, dependencies.identity.environment),
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleStartApplication(
  request: Request,
  dependencies: ApplicationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const actor = await requireHumanActor(request, dependencies);
    const now = dependencies.identity.now();
    const result = await dependencies.operations.start(
      actor.ownerId,
      await readApplicationJsonBody(request),
      now,
    );
    await dependencies.activity?.publish({
      ownerId: actor.ownerId,
      correlationId: requestId,
      kind: "application",
      key: "prepare_application",
      status: "completed",
      safeSummary:
        result.disposition === "created"
          ? "Application draft created."
          : "Application draft reopened.",
      actorKind: "human",
      aggregate: { type: "application_draft", version: result.draft.version },
      occurredAt: now,
      effects: [
        { target: "application", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(result, {
      requestId,
      status: result.disposition === "created" ? 201 : 200,
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleListApplications(
  request: Request,
  dependencies: ApplicationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const owner = await requireOwnerSession(request, dependencies.identity);
    return apiSuccessResponse(
      await dependencies.operations.list(owner.owner.id, dependencies.identity.now()),
      { requestId },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleGetApplication(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
  dependencies: ApplicationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const actor = await requireHumanActor(request, dependencies);
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    return apiSuccessResponse(
      await dependencies.operations.get(actor.ownerId, draftId, dependencies.identity.now()),
      { requestId },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleSubmitApplication(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
  dependencies: ApplicationRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const actor = await requireApplicationActor(
      request,
      draftId,
      "submit_application",
      dependencies,
    );
    await requireFirstPartyApplicationDecisionAllowed(actor, draftId, dependencies);
    const now = dependencies.identity.now();
    const result = await dependencies.operations.submit(
      actor,
      draftId,
      await readApplicationJsonBody(request),
      dependencies.confirmation.hash(
        requireConfirmationCookie(request, dependencies.identity.environment),
      ),
      now,
    );
    if (dependencies.activity !== undefined) {
      const workspace = await dependencies.operations.get(actor.ownerId, draftId, now);
      await dependencies.activity.publish({
        ownerId: actor.ownerId,
        correlationId: requestId,
        kind: "application",
        key: "submit_application",
        status: "completed",
        safeSummary: "Reviewed application submitted with an immutable receipt.",
        actorKind: actor.kind,
        aggregate: { type: "application_draft", version: workspace.draft.version },
        occurredAt: now,
        effects: [
          { target: "application", kind: "refresh" },
          { target: "agent_activity", kind: "announce" },
        ],
      });
    }
    return apiSuccessResponse(result, { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleApplicationCommand(
  request: Request,
  context: { readonly params: Promise<{ readonly draftId: string }> },
  dependencies: ApplicationRouteDependencies,
  command: "answer" | "validate" | "review",
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.identity.environment);
    const { draftId: rawDraftId } = await context.params;
    const draftId = parseEntityId(rawDraftId);
    const operation: AgentOperation =
      command === "answer"
        ? "edit_application"
        : command === "review"
          ? "review_application"
          : "validate_application";
    const actor = await requireApplicationActor(request, draftId, operation, dependencies);
    if (command === "answer") {
      await requireFirstPartyApplicationDecisionAllowed(actor, draftId, dependencies);
    }
    const now = dependencies.identity.now();
    const result =
      command === "answer"
        ? await dependencies.operations.answer(
            actor,
            draftId,
            await readApplicationJsonBody(request),
            now,
          )
        : command === "review"
          ? await dependencies.operations.review(
              actor,
              draftId,
              await readApplicationJsonBody(request),
              now,
            )
          : await dependencies.operations.validate(actor, draftId, now);
    const version = "version" in result ? result.version : result.draftVersion;
    await dependencies.activity?.publish({
      ownerId: actor.ownerId,
      correlationId: requestId,
      kind: "application",
      key: operation,
      status: "completed",
      safeSummary:
        command === "answer"
          ? "Application draft updated."
          : command === "review"
            ? "Application review sealed for candidate approval."
            : "Application requirements validated.",
      actorKind: actor.kind,
      aggregate: { type: "application_draft", version },
      occurredAt: now,
      effects: [
        { target: "application", kind: "refresh" },
        { target: "agent_activity", kind: "announce" },
      ],
    });
    return apiSuccessResponse(result, { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export function confirmationCookie(
  request: Request,
  environment: RuntimeEnvironment,
): string | null {
  const name = confirmationCookieName(environment);
  const cookies = request.headers.get("cookie");
  if (cookies === null) return null;
  for (const part of cookies.split(";")) {
    const separator = part.indexOf("=");
    if (separator < 1 || part.slice(0, separator).trim() !== name) continue;
    const value = part.slice(separator + 1).trim();
    return value.length <= 256 ? value : null;
  }
  return null;
}

export function requireConfirmationCookie(
  request: Request,
  environment: RuntimeEnvironment,
): string {
  const raw = confirmationCookie(request, environment);
  if (raw === null) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "A fresh human confirmation is required.",
    });
  }
  return raw;
}
