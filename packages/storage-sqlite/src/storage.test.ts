import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { storageContractSuite } from "@jobbbler/storage/contract-tests";
import type { Job, JobSearchCriteria } from "@jobbbler/contracts";

import { createSqliteStorage } from "./index.js";

const temporaryDirectories: string[] = [];

storageContractSuite("SQLite", async () => {
  const directory = await mkdtemp(join(tmpdir(), "jobbbler-storage-contract-"));
  temporaryDirectories.push(directory);
  return createSqliteStorage(join(directory, "jobbbler.sqlite"));
});

describe("SQLite relevance candidate completeness", () => {
  it("does not discard an older, stronger match before ranking", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-storage-completeness-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    const organizationId = "org_10000000-0000-7000-8000-000000000001";
    await storage.organizations.upsert({
      id: organizationId,
      name: "Fictional Scale Lab",
      slug: "fictional-scale-lab",
      website: null,
      description: "A fictional organization used for storage contract verification.",
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    });

    const makeJob = (index: number, skills: string[], publishedAt: string): Job => ({
      id: `job_10000000-0000-7000-8000-${index.toString(16).padStart(12, "0")}`,
      organizationId,
      organizationName: "Fictional Scale Lab",
      title: `Platform Engineer ${String(index)}`,
      summary: "Build and operate a fictional developer platform.",
      categories: ["software_engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Europe"],
      skills,
      salary: null,
      source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
      applyMode: "external",
      status: "open",
      publishedAt,
      updatedAt: "2026-08-29T10:00:00.000Z",
    });

    for (let index = 1; index <= 1_000; index += 1) {
      await storage.jobs.upsert(makeJob(index, ["TypeScript"], "2026-08-28T10:00:00.000Z"));
    }
    const strongest = makeJob(1_001, ["Rust"], "2026-01-01T10:00:00.000Z");
    await storage.jobs.upsert(strongest);

    const criteria: JobSearchCriteria = {
      query: null,
      categories: [],
      workModels: [],
      seniorities: [],
      locations: [],
      skills: ["Rust"],
      excludeKeywords: [],
      salary: null,
      postedWithinDays: null,
      sort: "relevance",
      cursor: null,
      limit: 1,
      unresolvedAssumptions: [],
    };
    const result = await storage.jobs.search({
      criteria,
      now: "2026-08-29T10:00:00.000Z",
      limit: 1,
    });

    expect(result.jobs).toEqual([strongest]);
    expect(result.total).toBe(1_001);
    expect(result.nextCursor).toEqual(expect.any(String));
    storage.close();
  }, 15_000);
});

describe("SQLite application capability persistence", () => {
  it("binds review, hashed single-use confirmation, receipt idempotency, and revocation to owner", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-storage-capability-"));
    temporaryDirectories.push(directory);
    const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
    const now = "2026-08-29T10:00:00.000Z";
    const ownerId = "owner_450e8400-e29b-41d4-a716-446655440000";
    const organizationId = "org_450e8400-e29b-41d4-a716-446655440000";
    const jobId = "job_450e8400-e29b-41d4-a716-446655440000";
    await storage.owners.insert({ id: ownerId, kind: "guest", verified: true, version: 1, createdAt: now, updatedAt: now });
    await storage.organizations.upsert({ id: organizationId, name: "Capability Lab", slug: "capability-lab", website: null, description: "Test organization", createdAt: now, updatedAt: now });
    await storage.jobs.upsert({ id: jobId, organizationId, organizationName: "Capability Lab", title: "Engineer", summary: "Test job", categories: ["software_engineering"], workModel: "remote", employmentType: "full_time", seniority: "mid", locations: ["Europe"], skills: [], salary: null, source: { key: "jobbbler_demo", label: "Demo", url: null }, applyMode: "internal", status: "open", publishedAt: now, updatedAt: now });
    await storage.applications.insert({ id: "application_450e8400-e29b-41d4-a716-446655440000", ownerId, jobId, state: "reviewed", version: 1, answers: [], createdAt: now, updatedAt: now });
    await storage.applications.insertReview({ id: "review_450e8400-e29b-41d4-a716-446655440000", ownerId, draftId: "application_450e8400-e29b-41d4-a716-446655440000", draftVersion: 1, payloadHash: "payload-sha256", findings: [], status: "active", createdAt: now, invalidatedAt: null });
    await storage.applications.insertConfirmation({ id: "confirmation_450e8400-e29b-41d4-a716-446655440000", ownerId, draftId: "application_450e8400-e29b-41d4-a716-446655440000", reviewId: "review_450e8400-e29b-41d4-a716-446655440000", payloadHash: "payload-sha256", confirmationHash: "sha256-token-only", status: "active", expiresAt: "2026-08-30T10:00:00.000Z", createdAt: now, consumedAt: null });
    await expect(storage.applications.consumeConfirmation("confirmation_450e8400-e29b-41d4-a716-446655440000", ownerId, "sha256-token-only", now)).resolves.toMatchObject({ status: "consumed" });
    await expect(storage.applications.consumeConfirmation("confirmation_450e8400-e29b-41d4-a716-446655440000", ownerId, "sha256-token-only", now)).rejects.toMatchObject({ code: "CONFLICT" });
    const receipt = { id: "receipt_450e8400-e29b-41d4-a716-446655440000", ownerId, draftId: "application_450e8400-e29b-41d4-a716-446655440000", reviewId: "review_450e8400-e29b-41d4-a716-446655440000", confirmationId: "confirmation_450e8400-e29b-41d4-a716-446655440000", idempotencyKey: "submit-once", status: "submitted" as const, externalUrl: null, createdAt: now };
    expect((await storage.applications.putReceiptIfAbsent(receipt)).inserted).toBe(true);
    expect((await storage.applications.putReceiptIfAbsent({ ...receipt, id: "receipt_550e8400-e29b-41d4-a716-446655440000" })).inserted).toBe(false);
    const agentSessionId = "agent_session_450e8400-e29b-41d4-a716-446655440000";
    await storage.agentSessions.insert({ id: agentSessionId, ownerId, draftId: receipt.draftId, tokenHash: "a".repeat(64), expiresAt: "2026-08-30T10:00:00.000Z", revokedAt: null, createdAt: now });
    await storage.delegations.insert({ id: "delegation_450e8400-e29b-41d4-a716-446655440000", ownerId, agentSessionId, resourceType: "application_draft", resourceId: receipt.draftId, operations: ["review_application"], purpose: "draft review", status: "requested", expiresAt: "2026-08-30T10:00:00.000Z", createdAt: now, approvedAt: null, revokedAt: null });
    await storage.delegations.approve("delegation_450e8400-e29b-41d4-a716-446655440000", ownerId, now);
    await expect(storage.delegations.revoke("delegation_450e8400-e29b-41d4-a716-446655440000", "other-owner", now)).rejects.toMatchObject({ code: "CONFLICT" });
    await storage.dataGrants.insert({ id: "grant_450e8400-e29b-41d4-a716-446655440000", ownerId, recipientId: "agent", purpose: "tailored draft", payloadHash: "payload-sha256", fields: ["email"], status: "requested", expiresAt: "2026-08-30T10:00:00.000Z", createdAt: now, approvedAt: null, withdrawnAt: null });
    await storage.dataGrants.approve("grant_450e8400-e29b-41d4-a716-446655440000", ownerId, now);
    await expect(storage.dataGrants.withdraw("grant_450e8400-e29b-41d4-a716-446655440000", ownerId, now)).resolves.toMatchObject({ status: "withdrawn" });
  });
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
