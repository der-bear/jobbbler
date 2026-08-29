import { createHmac, timingSafeEqual } from "node:crypto";

import { ownerActivityPageSchema } from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";
import type { OwnerActivityRepository, OwnerActivityWindow } from "@jobbbler/storage";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { createRequestId } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";
import { sensitiveRateLimitKey } from "./identity-security";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export interface OwnerActivityCursorCodec {
  encode(ownerId: string, sequence: number): string;
  decode(ownerId: string, cursor: string): number;
}

export interface OwnerActivityRouteDependencies {
  readonly identity: IdentityRouteDependencies;
  readonly activity: OwnerActivityRepository;
  readonly cursor: OwnerActivityCursorCodec;
  readonly pollAfterMs: number;
}

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;
const READS_PER_MINUTE = 120;
const LOCAL_CURSOR_SECRET = "jobbbler-local-activity-cursor-change-before-production";

function cursorSecret(environment: RuntimeEnvironment): string {
  const configured = environment["TOKEN_HASH_SECRET"];
  if (configured !== undefined && configured.length >= 32) return configured;
  if (environment["NODE_ENV"] !== "production") return LOCAL_CURSOR_SECRET;
  throw new Error("TOKEN_HASH_SECRET must contain at least 32 characters.");
}

function invalidCursor(): DomainError {
  return new DomainError({
    code: "VALIDATION",
    message: "The activity cursor is invalid or does not match this private session.",
  });
}

function signature(secret: string, ownerId: string, sequence: number): string {
  return createHmac("sha256", secret)
    .update(`jobbbler:owner-activity-cursor:v1\u0000${ownerId}\u0000${String(sequence)}`)
    .digest("hex");
}

function equalFixedHex(left: string, right: string): boolean {
  if (!/^[0-9a-f]{64}$/u.test(left) || !/^[0-9a-f]{64}$/u.test(right)) return false;
  return timingSafeEqual(Buffer.from(left, "hex"), Buffer.from(right, "hex"));
}

export function createOwnerActivityCursorCodec(
  environment: RuntimeEnvironment = process.env,
): OwnerActivityCursorCodec {
  const secret = cursorSecret(environment);
  return {
    encode(ownerId, sequence) {
      if (!Number.isSafeInteger(sequence) || sequence < 0) throw invalidCursor();
      const payload = Buffer.from(String(sequence), "utf8").toString("base64url");
      return `v1.${payload}.${signature(secret, ownerId, sequence)}`;
    },
    decode(ownerId, cursor) {
      if (cursor.length < 70 || cursor.length > 160) throw invalidCursor();
      const parts = cursor.split(".");
      if (parts.length !== 3 || parts[0] !== "v1") throw invalidCursor();
      const payload = parts[1] ?? "";
      const supplied = parts[2] ?? "";
      try {
        const decoded = Buffer.from(payload, "base64url").toString("utf8");
        if (!/^0$|^[1-9]\d{0,15}$/u.test(decoded)) throw invalidCursor();
        if (Buffer.from(decoded, "utf8").toString("base64url") !== payload) throw invalidCursor();
        const sequence = Number(decoded);
        if (!Number.isSafeInteger(sequence) || sequence < 0) throw invalidCursor();
        if (!equalFixedHex(supplied, signature(secret, ownerId, sequence))) throw invalidCursor();
        return sequence;
      } catch (error) {
        if (error instanceof DomainError) throw error;
        throw invalidCursor();
      }
    },
  };
}

function assertTrustedRead(request: Request, environment: RuntimeEnvironment): void {
  const fetchSite = request.headers.get("sec-fetch-site");
  if (fetchSite !== null && fetchSite !== "same-origin") {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Private activity can only be read from the Jobbbler interface.",
    });
  }
  const origin = request.headers.get("origin");
  if (origin === null) return;
  const expected = new URL(environment["PUBLIC_BASE_URL"] ?? request.url).origin;
  if (origin !== expected) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Private activity can only be read from the Jobbbler interface.",
    });
  }
}

function queryInput(request: Request): { readonly cursor: string | null; readonly limit: number } {
  const parameters = new URL(request.url).searchParams;
  for (const key of parameters.keys()) {
    if (key !== "cursor" && key !== "limit") {
      throw new DomainError({ code: "VALIDATION", message: "Unsupported activity query." });
    }
    if (parameters.getAll(key).length !== 1) {
      throw new DomainError({ code: "VALIDATION", message: "Duplicate activity query value." });
    }
  }
  const cursor = parameters.get("cursor");
  if (cursor !== null && (cursor.length === 0 || cursor.length > 160)) throw invalidCursor();
  const rawLimit = parameters.get("limit");
  if (rawLimit === null) return { cursor, limit: DEFAULT_LIMIT };
  if (!/^[1-9]\d{0,2}$/u.test(rawLimit)) {
    throw new DomainError({ code: "VALIDATION", message: "Activity limit is invalid." });
  }
  const limit = Number(rawLimit);
  if (limit > MAX_LIMIT) {
    throw new DomainError({ code: "VALIDATION", message: "Activity limit is invalid." });
  }
  return { cursor, limit };
}

function assertOwnedWindow(
  ownerId: string,
  afterSequence: number | null,
  window: OwnerActivityWindow,
): void {
  if (
    !Number.isSafeInteger(window.latestSequence) ||
    window.latestSequence < 0 ||
    (window.hasMore && window.events.length === 0)
  ) {
    throw new DomainError({
      code: "CONFLICT",
      message: "The activity projection is inconsistent. Refresh authoritative state.",
    });
  }
  let previous = afterSequence ?? -1;
  for (const record of window.events) {
    if (
      record.ownerId !== ownerId ||
      !Number.isSafeInteger(record.sequence) ||
      record.sequence < 1 ||
      record.sequence <= previous ||
      record.sequence > window.latestSequence
    ) {
      throw new DomainError({
        code: "CONFLICT",
        message: "The activity projection is inconsistent. Refresh authoritative state.",
      });
    }
    previous = record.sequence;
  }
}

async function rateLimit(
  ownerId: string,
  requestId: string,
  dependencies: OwnerActivityRouteDependencies,
): Promise<Response | null> {
  const decision = await dependencies.identity.rateLimiter.check({
    key: sensitiveRateLimitKey("owner-activity-read", ownerId, dependencies.identity.environment),
    limit: READS_PER_MINUTE,
    windowMs: 60_000,
    nowMs: dependencies.identity.nowMs(),
  });
  if (decision.allowed) return null;
  return apiErrorResponse(
    new DomainError({
      code: "RATE_LIMITED",
      message: "Too many activity refreshes. Try again shortly.",
      retryable: true,
    }),
    { requestId, retryAfterSeconds: decision.retryAfterSeconds },
  );
}

export async function handleListOwnerActivityRequest(
  request: Request,
  dependencies: OwnerActivityRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    assertTrustedRead(request, dependencies.identity.environment);
    const current = await requireOwnerSession(request, dependencies.identity);
    const limited = await rateLimit(current.owner.id, requestId, dependencies);
    if (limited !== null) return limited;
    const input = queryInput(request);
    const afterSequence =
      input.cursor === null ? null : dependencies.cursor.decode(current.owner.id, input.cursor);
    let window = await dependencies.activity.listWindow({
      ownerId: current.owner.id,
      afterSequence,
      limit: input.limit,
    });
    assertOwnedWindow(current.owner.id, afterSequence, window);

    const resyncRequired = afterSequence !== null && afterSequence > window.latestSequence;
    if (resyncRequired) {
      window = await dependencies.activity.listWindow({
        ownerId: current.owner.id,
        afterSequence: null,
        limit: input.limit,
      });
      assertOwnedWindow(current.owner.id, null, window);
    }
    const lastSequence = window.events.at(-1)?.sequence;
    const nextSequence = resyncRequired
      ? window.latestSequence
      : (lastSequence ?? afterSequence ?? window.latestSequence);
    const data = ownerActivityPageSchema.parse({
      events: window.events.map((record) => record.event),
      nextCursor: dependencies.cursor.encode(current.owner.id, nextSequence),
      hasMore: window.hasMore,
      resyncRequired,
      pollAfterMs: dependencies.pollAfterMs,
    });
    return apiSuccessResponse(data, {
      requestId,
      cacheControl: "no-store",
      headers: {
        vary: "Cookie",
        "referrer-policy": "no-referrer",
        "x-activity-transport": "authoritative-poll",
      },
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
