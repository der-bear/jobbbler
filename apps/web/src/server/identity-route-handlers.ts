import type {
  CreatedOwnerSession,
  PreparedSearchAlertEmailVerification,
  ResolvedOwnerSession,
  StartedEmailVerification,
} from "@jobbbler/core-domain";
import { DomainError, ownerSummary } from "@jobbbler/core-domain";
import { startEmailVerificationInputSchema } from "@jobbbler/contracts";
import type { OwnerActivityRepository } from "@jobbbler/storage";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { readBoundedJsonBody } from "./bounded-json-body";
import { createRequestId } from "./context";
import { getRateLimitKey } from "./context";
import {
  assertTrustedMutationOrigin,
  canExposeLocalOtp,
  ownerSessionCookie,
  ownerSessionCookieName,
  sensitiveRateLimitKey,
} from "./identity-security";
import type { RateLimiter } from "./rate-limit";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface IdentityOperations {
  createEphemeralSession(now: string): Promise<CreatedOwnerSession>;
  resolveSession(rawToken: string | null, now: string): Promise<ResolvedOwnerSession | null>;
  startEmailVerification(
    ownerId: string,
    rawInput: unknown,
    now: string,
  ): Promise<StartedEmailVerification>;
  startSearchAlertEmailVerification?(
    ownerId: string,
    rawInput: unknown,
    now: string,
    stableContext?: {
      readonly endpointId: string;
      readonly challengeId: string;
    },
  ): Promise<PreparedSearchAlertEmailVerification>;
  completeEmailVerification(
    ownerId: string,
    rawInput: unknown,
    now: string,
  ): Promise<{
    readonly owner: ReturnType<typeof ownerSummary>;
    readonly endpointId: string;
    readonly verifiedAt: string;
  }>;
  confirmSearchAlertEmailVerification?(
    ownerId: string,
    rawInput: unknown,
    now: string,
  ): Promise<{
    readonly owner: ReturnType<typeof ownerSummary>;
    readonly endpointId: string;
    readonly verifiedAt: string;
  }>;
  abandonSearchAlertEmailVerification?(
    ownerId: string,
    challengeId: string,
    now: string,
  ): Promise<boolean>;
  listVerificationEndpoints(ownerId: string): Promise<
    readonly {
      readonly id: string;
      readonly kind: "email";
      readonly maskedAddress: string;
      readonly status: "pending" | "verified" | "revoked";
      readonly verifiedAt: string | null;
    }[]
  >;
  revokeVerificationEndpoint(
    ownerId: string,
    endpointId: string,
    now: string,
  ): Promise<{
    readonly id: string;
    readonly kind: "email";
    readonly maskedAddress: string;
    readonly status: "pending" | "verified" | "revoked";
    readonly verifiedAt: string | null;
  }>;
  startOwnerRecovery(
    rawInput: unknown,
    now: string,
  ): Promise<{
    readonly recoveryId: string;
    readonly rawCode: string;
    readonly expiresAt: string;
    readonly encryptedAddress: string | null;
  }>;
  completeOwnerRecovery(rawInput: unknown, now: string): Promise<CreatedOwnerSession>;
  startOwnerDeletion(
    ownerId: string,
    rawInput: unknown,
    now: string,
  ): Promise<{
    readonly id: string;
    readonly ownerId: string;
    readonly status: "pending" | "expired";
    readonly expiresAt: string;
    readonly createdAt: string;
    readonly updatedAt: string;
  }>;
  completeOwnerDeletion(
    ownerId: string,
    sessionId: string,
    rawInput: unknown,
    now: string,
  ): Promise<{ readonly deleted: true }>;
}

export interface VerificationDelivery {
  deliverVerification(input: {
    readonly encryptedAddress: string;
    readonly code: string;
    readonly expiresAt: string;
    readonly challengeId: string;
  }): Promise<{ readonly delivery: "queued" | "captured" }>;
}

export interface IdentityRouteDependencies {
  readonly identity: IdentityOperations;
  readonly delivery: VerificationDelivery;
  readonly environment: RuntimeEnvironment;
  readonly now: () => string;
  readonly nowMs: () => number;
  readonly rateLimiter: RateLimiter;
  readonly activity: Pick<OwnerActivityRepository, "append">;
}

const MAX_IDENTITY_BODY_BYTES = 4_096;

async function checkIdentityRateLimit(
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

export function ownerSessionToken(
  request: Request,
  environment: RuntimeEnvironment,
): string | null {
  const name = ownerSessionCookieName(environment);
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

export async function readSmallJsonBody(request: Request): Promise<unknown> {
  return readBoundedJsonBody(request, {
    maxBytes: MAX_IDENTITY_BODY_BYTES,
    emptyMessage: "Expected a small JSON request body.",
  });
}

export function serializeOwnerCookie(cookie: ReturnType<typeof ownerSessionCookie>): string {
  const parts = [
    `${cookie.name}=${cookie.value}`,
    `Expires=${cookie.options.expires.toUTCString()}`,
    `Path=${cookie.options.path}`,
    "HttpOnly",
    "SameSite=Lax",
    "Priority=High",
  ];
  if (cookie.options.secure) parts.push("Secure");
  return parts.join("; ");
}

export async function requireOwnerSession(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<ResolvedOwnerSession> {
  const resolved = await dependencies.identity.resolveSession(
    ownerSessionToken(request, dependencies.environment),
    dependencies.now(),
  );
  if (resolved === null) {
    throw new DomainError({
      code: "UNAUTHORIZED",
      message: "Start a private Jobbbler session to continue.",
    });
  }
  return resolved;
}

export async function handleCreateOwnerSessionRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const existing = await dependencies.identity.resolveSession(
      ownerSessionToken(request, dependencies.environment),
      dependencies.now(),
    );
    if (existing !== null) {
      return apiSuccessResponse(
        { owner: ownerSummary(existing.owner), expiresAt: existing.session.expiresAt },
        { requestId },
      );
    }

    const limited = await checkIdentityRateLimit(
      requestId,
      getRateLimitKey(request, "identity-session", dependencies.environment),
      20,
      60 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;

    const created = await dependencies.identity.createEphemeralSession(dependencies.now());
    return apiSuccessResponse(
      { owner: ownerSummary(created.owner), expiresAt: created.expiresAt },
      {
        requestId,
        status: 201,
        headers: {
          "set-cookie": serializeOwnerCookie(
            ownerSessionCookie(created.rawToken, created.expiresAt, dependencies.environment),
          ),
        },
      },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleGetOwnerSessionRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const current = await requireOwnerSession(request, dependencies);
    return apiSuccessResponse(
      { owner: ownerSummary(current.owner), expiresAt: current.session.expiresAt },
      { requestId },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleStartEmailVerificationRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const current = await requireOwnerSession(request, dependencies);
    const body = await readSmallJsonBody(request);
    const parsed = startEmailVerificationInputSchema.parse(body);
    const keys = [
      getRateLimitKey(request, "identity-email-send", dependencies.environment),
      sensitiveRateLimitKey("identity-email-owner", current.owner.id, dependencies.environment),
      sensitiveRateLimitKey("identity-email-address", parsed.email, dependencies.environment),
    ];
    for (const key of keys) {
      const limited = await checkIdentityRateLimit(
        requestId,
        key,
        5,
        15 * 60 * 1_000,
        dependencies,
      );
      if (limited !== null) return limited;
    }
    const started = await dependencies.identity.startEmailVerification(
      current.owner.id,
      parsed,
      dependencies.now(),
    );
    const delivery = await dependencies.delivery.deliverVerification({
      encryptedAddress: started.encryptedAddress,
      code: started.rawCode,
      expiresAt: started.expiresAt,
      challengeId: started.challengeId,
    });
    const developmentCode =
      delivery.delivery === "captured" && canExposeLocalOtp(dependencies.environment)
        ? started.rawCode
        : undefined;
    return apiSuccessResponse(
      {
        challengeId: started.challengeId,
        endpointId: started.endpointId,
        expiresAt: started.expiresAt,
        maskedDestination: started.maskedAddress,
        delivery: delivery.delivery,
        ...(developmentCode === undefined ? {} : { developmentCode }),
      },
      { requestId, status: 202 },
    );
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleCompleteEmailVerificationRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const current = await requireOwnerSession(request, dependencies);
    const limited = await checkIdentityRateLimit(
      requestId,
      sensitiveRateLimitKey("identity-email-complete", current.owner.id, dependencies.environment),
      12,
      15 * 60 * 1_000,
      dependencies,
    );
    if (limited !== null) return limited;
    const result = await dependencies.identity.completeEmailVerification(
      current.owner.id,
      await readSmallJsonBody(request),
      dependencies.now(),
    );
    return apiSuccessResponse(result, { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

function publicEndpoint(endpoint: {
  readonly id: string;
  readonly kind: "email";
  readonly maskedAddress: string;
  readonly status: "pending" | "verified" | "revoked";
  readonly verifiedAt: string | null;
}) {
  return {
    id: endpoint.id,
    kind: endpoint.kind,
    maskedDestination: endpoint.maskedAddress,
    status: endpoint.status,
    verifiedAt: endpoint.verifiedAt,
  };
}

export async function handleListVerificationEndpointsRequest(
  request: Request,
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const current = await requireOwnerSession(request, dependencies);
    const endpoints = await dependencies.identity.listVerificationEndpoints(current.owner.id);
    return apiSuccessResponse(endpoints.map(publicEndpoint), { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleRevokeVerificationEndpointRequest(
  request: Request,
  routeContext: { readonly params: Promise<{ readonly endpointId: string }> },
  dependencies: IdentityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedMutationOrigin(request, dependencies.environment);
    const current = await requireOwnerSession(request, dependencies);
    const { endpointId } = await routeContext.params;
    const endpoint = await dependencies.identity.revokeVerificationEndpoint(
      current.owner.id,
      endpointId,
      dependencies.now(),
    );
    return apiSuccessResponse(publicEndpoint(endpoint), { requestId });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
