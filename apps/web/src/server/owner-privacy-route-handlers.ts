import { createEntityId, DomainError, ownerSummary } from "@jobbbler/core-domain";
import {
  completeOwnerDeletionInputSchema,
  completeOwnerRecoveryInputSchema,
  createOwnerDeletionIntentInputSchema,
  ownerActivityEventSchema,
  startOwnerRecoveryInputSchema,
} from "@jobbbler/contracts";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { createRequestId, getRateLimitKey } from "./context";
import {
  readSmallJsonBody,
  requireOwnerSession,
  serializeOwnerCookie,
  type IdentityRouteDependencies,
} from "./identity-route-handlers";
import {
  assertTrustedMutationOrigin,
  canExposeLocalOtp,
  ownerSessionCookie,
  ownerSessionCookieName,
  sensitiveRateLimitKey,
} from "./identity-security";

const RECOVERY_RESPONSE_FLOOR_MS = 350;

export type RecoveryResponseScheduler = (task: () => Promise<void>) => void;

async function checkLimit(
  requestId: string,
  key: string,
  limit: number,
  windowMs: number,
  dependencies: IdentityRouteDependencies,
): Promise<Response | null> {
  const decision = await dependencies.rateLimiter.check({
    key,
    limit,
    windowMs,
    nowMs: dependencies.nowMs(),
  });
  if (decision.allowed) return null;
  return apiErrorResponse(
    new DomainError({
      code: "RATE_LIMITED",
      message: "Too many identity requests. Try again later.",
      retryable: true,
    }),
    { requestId, retryAfterSeconds: decision.retryAfterSeconds },
  );
}

async function firstLimited(
  requestId: string,
  keys: readonly string[],
  limit: number,
  windowMs: number,
  dependencies: IdentityRouteDependencies,
): Promise<Response | null> {
  for (const key of keys) {
    const limited = await checkLimit(requestId, key, limit, windowMs, dependencies);
    if (limited !== null) return limited;
  }
  return null;
}

function clearedOwnerCookie(environment: Readonly<Record<string, string | undefined>>): string {
  const parts = [
    `${ownerSessionCookieName(environment)}=`,
    "Expires=Thu, 01 Jan 1970 00:00:00 GMT",
    "Max-Age=0",
    "Path=/",
    "HttpOnly",
    "SameSite=Lax",
    "Priority=High",
  ];
  if (environment["NODE_ENV"] === "production") parts.push("Secure");
  return parts.join("; ");
}

function responseFloor(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, RECOVERY_RESPONSE_FLOOR_MS));
}

async function publishIdentityActivity(
  dependencies: IdentityRouteDependencies,
  input: {
    readonly ownerId: string;
    readonly ownerVersion: number;
    readonly key: "recover_private_workspace" | "delete_private_workspace";
    readonly status: "completed" | "requires_user_action";
    readonly safeSummary: string;
    readonly occurredAt: string;
    readonly correlationId: string;
  },
): Promise<void> {
  try {
    const event = ownerActivityEventSchema.parse({
      id: createEntityId("activity"),
      schemaVersion: 1,
      kind: input.key === "recover_private_workspace" ? "authorization" : "consent",
      key: input.key,
      status: input.status,
      safeSummary: input.safeSummary,
      correlationId: input.correlationId,
      actorKind: "human",
      aggregate: { type: "system", version: input.ownerVersion },
      occurredAt: input.occurredAt,
      effects: [{ target: "agent_activity", kind: "announce" }],
    });
    await dependencies.activity.append({
      ownerId: input.ownerId,
      event,
    });
  } catch {
    // Identity success must not strand a user if the observable projection is unavailable.
  }
}

export async function handleStartOwnerRecoveryRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
  scheduleAfterResponse?: RecoveryResponseScheduler,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const input = startOwnerRecoveryInputSchema.parse(await readSmallJsonBody(request));
    const limited = await firstLimited(
      requestId,
      [
        getRateLimitKey(request, "identity-recovery-start", dependencies.environment),
        sensitiveRateLimitKey("identity-recovery-address", input.email, dependencies.environment),
      ],
      5,
      15 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;
    const started = await dependencies.identity.startOwnerRecovery(input, dependencies.now());
    const deliver = async (): Promise<void> => {
      if (started.encryptedAddress === null) return;
      await dependencies.delivery
        .deliverVerification({
          encryptedAddress: started.encryptedAddress,
          code: started.rawCode,
          expiresAt: started.expiresAt,
          challengeId: started.recoveryId,
        })
        .then(() => undefined)
        .catch(() => undefined);
    };
    const delivery = scheduleAfterResponse === undefined ? deliver() : Promise.resolve();
    if (started.encryptedAddress !== null && scheduleAfterResponse !== undefined) {
      scheduleAfterResponse(deliver);
    }
    await Promise.all([delivery, responseFloor()]);
    const developmentCode = canExposeLocalOtp(dependencies.environment)
      ? started.rawCode
      : undefined;
    return apiSuccessResponse(
      {
        recoveryId: started.recoveryId,
        expiresAt: started.expiresAt,
        delivery: "accepted" as const,
        ...(developmentCode === undefined ? {} : { developmentCode }),
      },
      { requestId, status: 202, cacheControl: "no-store" },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleCompleteOwnerRecoveryRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const input = completeOwnerRecoveryInputSchema.parse(await readSmallJsonBody(request));
    const limited = await firstLimited(
      requestId,
      [
        getRateLimitKey(request, "identity-recovery-complete", dependencies.environment),
        sensitiveRateLimitKey(
          "identity-recovery-challenge",
          input.recoveryId,
          dependencies.environment,
        ),
      ],
      12,
      15 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;
    const recovered = await dependencies.identity.completeOwnerRecovery(input, dependencies.now());
    await publishIdentityActivity(dependencies, {
      ownerId: recovered.owner.id,
      ownerVersion: recovered.owner.version,
      key: "recover_private_workspace",
      status: "completed",
      safeSummary: "Private workspace access recovered.",
      occurredAt: dependencies.now(),
      correlationId: requestId,
    });
    return apiSuccessResponse(
      { owner: ownerSummary(recovered.owner), expiresAt: recovered.expiresAt },
      {
        requestId,
        cacheControl: "no-store",
        headers: {
          "set-cookie": serializeOwnerCookie(
            ownerSessionCookie(recovered.rawToken, recovered.expiresAt, dependencies.environment),
          ),
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleStartOwnerDeletionRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const current = await requireOwnerSession(request, dependencies);
    const input = createOwnerDeletionIntentInputSchema.parse(await readSmallJsonBody(request));
    const limited = await checkLimit(
      requestId,
      sensitiveRateLimitKey(
        "identity-owner-deletion-start",
        current.owner.id,
        dependencies.environment,
      ),
      3,
      60 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;
    const intent = await dependencies.identity.startOwnerDeletion(
      current.owner.id,
      input,
      dependencies.now(),
    );
    await publishIdentityActivity(dependencies, {
      ownerId: current.owner.id,
      ownerVersion: current.owner.version,
      key: "delete_private_workspace",
      status: "requires_user_action",
      safeSummary: "Final human confirmation is required to delete private data.",
      occurredAt: dependencies.now(),
      correlationId: requestId,
    });
    return apiSuccessResponse(
      { deletionId: intent.id, expiresAt: intent.expiresAt },
      { requestId, status: 201, cacheControl: "no-store" },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleCompleteOwnerDeletionRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const current = await requireOwnerSession(request, dependencies);
    const input = completeOwnerDeletionInputSchema.parse(await readSmallJsonBody(request));
    const limited = await checkLimit(
      requestId,
      sensitiveRateLimitKey(
        "identity-owner-deletion-complete",
        current.owner.id,
        dependencies.environment,
      ),
      5,
      60 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;
    const result = await dependencies.identity.completeOwnerDeletion(
      current.owner.id,
      current.session.id,
      input,
      dependencies.now(),
    );
    return apiSuccessResponse(result, {
      requestId,
      cacheControl: "no-store",
      headers: { "set-cookie": clearedOwnerCookie(dependencies.environment) },
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
