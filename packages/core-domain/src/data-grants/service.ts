import type { DataCategory } from "@jobbbler/contracts";

import { DomainError } from "../errors.js";

export interface DataGrantRecord {
  readonly id: string;
  readonly ownerId: string;
  readonly draftId: string;
  readonly recipientId: string;
  readonly purpose: string;
  readonly payloadHash: string;
  readonly categories: readonly DataCategory[];
  readonly fieldKeys: readonly string[];
  readonly documentIds: readonly string[];
  readonly expiresAt: string;
  readonly status: "requested" | "active" | "withdrawn";
  readonly requestedAt: string;
  readonly approvedAt: string | null;
  readonly withdrawnAt: string | null;
}

function requireOwner(actual: string, expected: string): void {
  if (actual !== expected)
    throw new DomainError({ code: "FORBIDDEN", message: "The owner does not match." });
}

function expired(expiresAt: string, now: string): boolean {
  return Date.parse(expiresAt) <= Date.parse(now);
}

export function requestDataGrant(
  input: Omit<DataGrantRecord, "status" | "requestedAt" | "approvedAt" | "withdrawnAt"> & {
    readonly now: string;
  },
): DataGrantRecord {
  if (
    !/^[a-f0-9]{64}$/.test(input.payloadHash) ||
    input.categories.length === 0 ||
    input.purpose.trim().length === 0 ||
    expired(input.expiresAt, input.now)
  ) {
    throw new DomainError({
      code: "VALIDATION",
      message: "Data grant requires a purpose, payload boundary, categories, and future expiry.",
    });
  }
  return {
    ...input,
    purpose: input.purpose.trim(),
    status: "requested",
    requestedAt: input.now,
    approvedAt: null,
    withdrawnAt: null,
  };
}

export function approveDataGrant(
  record: DataGrantRecord,
  ownerId: string,
  now: string,
): DataGrantRecord {
  requireOwner(record.ownerId, ownerId);
  if (record.status !== "requested" || expired(record.expiresAt, now))
    throw new DomainError({ code: "CONFLICT", message: "This data grant cannot be approved." });
  return { ...record, status: "active", approvedAt: now };
}

export function withdrawDataGrant(
  record: DataGrantRecord,
  ownerId: string,
  now: string,
): DataGrantRecord {
  requireOwner(record.ownerId, ownerId);
  return record.status === "withdrawn"
    ? record
    : { ...record, status: "withdrawn", withdrawnAt: now };
}

export function assertGrantCovers(
  record: DataGrantRecord,
  request: Readonly<{
    ownerId: string;
    draftId: string;
    recipientId: string;
    purpose: string;
    payloadHash: string;
    categories: readonly DataCategory[];
    now: string;
  }>,
): void {
  requireOwner(record.ownerId, request.ownerId);
  if (record.status !== "active")
    throw new DomainError({ code: "FORBIDDEN", message: "Data-grant approval is required." });
  if (expired(record.expiresAt, request.now))
    throw new DomainError({ code: "FORBIDDEN", message: "Data grant expired." });
  if (
    record.draftId !== request.draftId ||
    record.recipientId !== request.recipientId ||
    record.purpose !== request.purpose ||
    record.payloadHash !== request.payloadHash
  ) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Data grant recipient, purpose, or payload does not match.",
    });
  }
  if (request.categories.some((category) => !record.categories.includes(category))) {
    throw new DomainError({
      code: "FORBIDDEN",
      message: "Data grant categories do not cover this disclosure.",
    });
  }
}
