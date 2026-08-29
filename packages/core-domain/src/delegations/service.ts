import type { AgentOperation } from "@jobbbler/contracts";

import { DomainError } from "../errors.js";

export interface DelegationResource {
  readonly type: "application_draft";
  readonly id: string;
}

export interface DelegationRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly agentSessionId: string;
  readonly resource: DelegationResource;
  readonly operations: readonly AgentOperation[];
  readonly purpose: string;
  readonly expiresAt: string;
  readonly status: "requested" | "active" | "revoked";
  readonly requestedAt: string;
  readonly approvedAt: string | null;
  readonly revokedAt: string | null;
}

function requireOwner(actual: string, expected: string): void {
  if (actual !== expected)
    throw new DomainError({ code: "FORBIDDEN", message: "The owner does not match." });
}

function isExpired(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

export function requestDelegation(
  input: Omit<DelegationRecord, "status" | "requestedAt" | "approvedAt" | "revokedAt"> & {
    readonly now: string;
  },
): DelegationRecord {
  if (input.operations.length === 0 || new Set(input.operations).size !== input.operations.length) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Delegation operations must be explicit and unique.",
    });
  }
  if (input.purpose.trim().length === 0 || isExpired(input.expiresAt, input.now)) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Delegation purpose and future expiry are required.",
    });
  }
  return {
    ...input,
    purpose: input.purpose.trim(),
    status: "requested",
    requestedAt: input.now,
    approvedAt: null,
    revokedAt: null,
  };
}

export function approveDelegation(
  record: DelegationRecord,
  ownerId: string,
  now: string,
): DelegationRecord {
  requireOwner(record.ownerId, ownerId);
  if (record.status !== "requested" || isExpired(record.expiresAt, now)) {
    throw new DomainError({ code: "CONFLICT", message: "This delegation cannot be approved." });
  }
  return { ...record, status: "active", approvedAt: now };
}

export function revokeDelegation(
  record: DelegationRecord,
  ownerId: string,
  now: string,
): DelegationRecord {
  requireOwner(record.ownerId, ownerId);
  if (record.status === "revoked") return record;
  return { ...record, status: "revoked", revokedAt: now };
}

export function assertDelegationAllows(
  record: DelegationRecord,
  request: Readonly<{
    ownerId: string;
    agentSessionId: string;
    resource: DelegationResource;
    operation: AgentOperation;
    now: string;
  }>,
): void {
  requireOwner(record.ownerId, request.ownerId);
  if (record.status !== "active")
    throw new DomainError({ code: "FORBIDDEN", message: "Delegation approval is required." });
  if (isExpired(record.expiresAt, request.now))
    throw new DomainError({ code: "FORBIDDEN", message: "Delegation expired." });
  if (
    record.agentSessionId !== request.agentSessionId ||
    record.resource.type !== request.resource.type ||
    record.resource.id !== request.resource.id ||
    !record.operations.includes(request.operation)
  ) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Delegation scope does not allow this operation.",
    });
  }
}
