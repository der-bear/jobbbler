import { createHash } from "node:crypto";

import type { JobSearchCriteria } from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";

export interface JobSearchSortKey {
  readonly primary: number;
  readonly publishedAtMs: number;
  readonly id: string;
}

interface EncodedJobSearchCursor {
  readonly v: 2;
  readonly s: JobSearchCriteria["sort"];
  readonly p: number;
  readonly t: number;
  readonly i: string;
  readonly f: string;
}

function criteriaFingerprint(criteria: JobSearchCriteria): string {
  const canonical = {
    query: criteria.query,
    categories: criteria.categories,
    workModels: criteria.workModels,
    employmentTypes: criteria.employmentTypes ?? [],
    seniorities: criteria.seniorities,
    locations: criteria.locations,
    remoteOrLocations: criteria.remoteOrLocations === true,
    skills: criteria.skills,
    excludeKeywords: criteria.excludeKeywords,
    salary: criteria.salary,
    postedWithinDays: criteria.postedWithinDays,
    sort: criteria.sort,
  };
  return createHash("sha256").update(JSON.stringify(canonical)).digest("base64url").slice(0, 16);
}

function invalidCursor(): DomainError {
  return new DomainError({
    code: "VALIDATION",
    message: "Search cursor is invalid or does not match the current search.",
  });
}

export function jobSearchPublishedAtMs(value: string): number {
  const milliseconds = Date.parse(value);
  if (!Number.isSafeInteger(milliseconds)) {
    throw new TypeError("Job publication timestamp must resolve to epoch milliseconds.");
  }
  return milliseconds;
}

export function compareJobSearchSortKeys(
  left: JobSearchSortKey,
  right: JobSearchSortKey,
  sort: JobSearchCriteria["sort"],
): number {
  if (sort !== "newest" && left.primary !== right.primary) {
    return left.primary > right.primary ? -1 : 1;
  }
  if (left.publishedAtMs !== right.publishedAtMs) {
    return left.publishedAtMs > right.publishedAtMs ? -1 : 1;
  }
  return left.id < right.id ? -1 : left.id > right.id ? 1 : 0;
}

export function encodeJobSearchCursor(key: JobSearchSortKey, criteria: JobSearchCriteria): string {
  if (!Number.isFinite(key.primary) || !Number.isSafeInteger(key.publishedAtMs)) {
    throw new TypeError("Job search cursor sort values must be finite.");
  }
  const cursor: EncodedJobSearchCursor = {
    v: 2,
    s: criteria.sort,
    p: key.primary,
    t: key.publishedAtMs,
    i: key.id,
    f: criteriaFingerprint(criteria),
  };
  return Buffer.from(JSON.stringify(cursor), "utf8").toString("base64url");
}

export function decodeJobSearchCursor(
  value: string,
  criteria: JobSearchCriteria,
): JobSearchSortKey {
  try {
    const parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8")) as unknown;
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("v" in parsed) ||
      parsed.v !== 2 ||
      !("s" in parsed) ||
      parsed.s !== criteria.sort ||
      !("p" in parsed) ||
      typeof parsed.p !== "number" ||
      !Number.isFinite(parsed.p) ||
      !("t" in parsed) ||
      typeof parsed.t !== "number" ||
      !Number.isSafeInteger(parsed.t) ||
      !("i" in parsed) ||
      typeof parsed.i !== "string" ||
      !("f" in parsed) ||
      parsed.f !== criteriaFingerprint(criteria)
    ) {
      throw invalidCursor();
    }
    return { primary: parsed.p, publishedAtMs: parsed.t, id: parsed.i };
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw invalidCursor();
  }
}
