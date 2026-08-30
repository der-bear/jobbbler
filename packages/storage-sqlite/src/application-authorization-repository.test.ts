import { afterAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { ApplicationDraft, Job } from "@jobbbler/contracts";
import type { OwnerRecord, Storage } from "@jobbbler/storage";

import { openSqliteDatabase } from "./connection.js";
import { createSqliteStorage } from "./storage.js";

const now = "2026-08-29T10:00:00.000Z";
const future = "2026-08-29T11:00:00.000Z";
const expired = "2026-08-29T09:00:00.000Z";
const ownerId = "owner_71000000-0000-7000-8000-000000000001";
const otherOwnerId = "owner_71000000-0000-7000-8000-000000000002";
const draftId = "application_71000000-0000-7000-8000-000000000001";
const otherDraftId = "application_71000000-0000-7000-8000-000000000002";
const agentSessionId = "agent_session_71000000-0000-7000-8000-000000000001";
const jobId = "job_71000000-0000-7000-8000-000000000001";

const temporaryDirectories: string[] = [];

function owner(id: string): OwnerRecord {
  return {
    id,
    kind: "guest",
    verified: true,
    version: 1,
    createdAt: now,
    updatedAt: now,
  };
}

async function createFixture(): Promise<{
  readonly filename: string;
  readonly storage: Storage;
}> {
  const directory = await mkdtemp(join(tmpdir(), "jobbbler-application-authorization-"));
  temporaryDirectories.push(directory);
  const filename = join(directory, "jobbbler.sqlite");
  const storage = createSqliteStorage(filename);
  const organizationId = "org_71000000-0000-7000-8000-000000000001";

  await storage.owners.insert(owner(ownerId));
  await storage.owners.insert(owner(otherOwnerId));
  await storage.organizations.upsert({
    id: organizationId,
    name: "Authorization Lab",
    slug: "authorization-lab",
    website: null,
    description: "Fictional organization for application authorization tests.",
    createdAt: now,
    updatedAt: now,
  });

  const createJob = (id: string): Job => ({
    id,
    organizationId,
    organizationName: "Authorization Lab",
    title: "Platform Engineer",
    summary: "Build secure agent workflows.",
    categories: ["software_engineering"],
    workModel: "remote",
    employmentType: "full_time",
    seniority: "senior",
    locations: ["Europe"],
    skills: ["TypeScript"],
    salary: null,
    source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
    applyMode: "internal",
    status: "open",
    publishedAt: now,
    updatedAt: now,
  });
  const job = createJob(jobId);
  const otherJob = createJob("job_71000000-0000-7000-8000-000000000002");
  await storage.jobs.upsert(job);
  await storage.jobs.upsert(otherJob);

  const createDraft = (id: string, draftOwnerId: string, jobId: string): ApplicationDraft => ({
    id,
    ownerId: draftOwnerId,
    jobId,
    state: "draft",
    version: 0,
    answers: [],
    createdAt: now,
    updatedAt: now,
  });
  await storage.applications.insert(createDraft(draftId, ownerId, job.id));
  await storage.applications.insert(createDraft(otherDraftId, otherOwnerId, otherJob.id));

  return { filename, storage };
}

describe("SQLite application authorization persistence", () => {
  it("resolves only a live hash-bound agent session for its exact owner and draft", async () => {
    const { filename, storage } = await createFixture();
    const tokenHash = "a".repeat(64);
    const session = {
      id: agentSessionId,
      ownerId,
      draftId,
      tokenHash,
      expiresAt: future,
      revokedAt: null,
      createdAt: now,
    };

    await expect(
      storage.agentSessions.insert({
        ...session,
        id: "agent_session_71000000-0000-7000-8000-000000000099",
        tokenHash: "raw-bearer-token",
      }),
    ).rejects.toBeDefined();
    await expect(storage.agentSessions.insert(session)).resolves.toEqual(session);
    await expect(
      storage.agentSessions.resolve({ tokenHash, ownerId, draftId, now }),
    ).resolves.toEqual(session);
    await expect(
      storage.agentSessions.resolve({ tokenHash, ownerId: otherOwnerId, draftId, now }),
    ).resolves.toBeNull();
    await expect(
      storage.agentSessions.resolve({ tokenHash, ownerId, draftId: otherDraftId, now }),
    ).resolves.toBeNull();
    await expect(
      storage.agentSessions.insert({
        ...session,
        id: "agent_session_71000000-0000-7000-8000-000000000002",
        draftId: otherDraftId,
        tokenHash: "b".repeat(64),
      }),
    ).rejects.toBeDefined();

    await expect(
      storage.agentSessions.revoke(agentSessionId, ownerId, draftId, now),
    ).resolves.toMatchObject({ revokedAt: now });
    await expect(
      storage.agentSessions.resolve({ tokenHash, ownerId, draftId, now }),
    ).resolves.toBeNull();
    storage.close();

    const database = openSqliteDatabase(filename);
    const row = database
      .prepare("SELECT * FROM application_agent_sessions WHERE id = ?")
      .get(agentSessionId) as Record<string, unknown>;
    expect(row["token_hash"]).toBe(tokenHash);
    expect(row).not.toHaveProperty("token");
    database.close();
  });

  it("returns a delegation only when the live session, owner, draft, operation, and time match", async () => {
    const { storage } = await createFixture();
    await storage.agentSessions.insert({
      id: agentSessionId,
      ownerId,
      draftId,
      tokenHash: "c".repeat(64),
      expiresAt: future,
      revokedAt: null,
      createdAt: now,
    });
    const delegation = {
      id: "delegation_71000000-0000-7000-8000-000000000001",
      ownerId,
      agentSessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operations: ["read_application", "edit_application"] as const,
      purpose: "Prepare this application draft.",
      status: "requested" as const,
      expiresAt: future,
      createdAt: now,
      approvedAt: null,
      revokedAt: null,
    };
    const otherSessionId = "agent_session_71000000-0000-7000-8000-000000000002";
    await storage.agentSessions.insert({
      id: otherSessionId,
      ownerId: otherOwnerId,
      draftId: otherDraftId,
      tokenHash: "9".repeat(64),
      expiresAt: future,
      revokedAt: null,
      createdAt: now,
    });
    await expect(
      storage.delegations.insert({
        ...delegation,
        id: "delegation_71000000-0000-7000-8000-000000000002",
        agentSessionId: otherSessionId,
      }),
    ).rejects.toBeDefined();
    await storage.delegations.insert(delegation);
    await storage.delegations.approve(delegation.id, ownerId, now, {
      channel: "agent_client",
      requestId: delegation.id,
      action: "approved",
      evidenceVersion: "agent-interaction-v1",
    });
    await expect(storage.delegations.listByResource(ownerId, draftId)).resolves.toEqual([
      {
        ...delegation,
        status: "active",
        approvedAt: now,
        decisionChannel: "agent_client",
        decisionRequestId: delegation.id,
        decisionAction: "approved",
        decisionEvidenceVersion: "agent-interaction-v1",
      },
    ]);
    await expect(storage.delegations.listByResource(otherOwnerId, draftId)).resolves.toEqual([]);

    const match = {
      ownerId,
      agentSessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operation: "edit_application" as const,
      now,
    };
    await expect(storage.delegations.getActiveMatch(match)).resolves.toMatchObject({
      id: delegation.id,
      status: "active",
    });
    await expect(
      storage.delegations.getActiveMatch({ ...match, operation: "submit_application" }),
    ).resolves.toBeNull();
    await expect(
      storage.delegations.getActiveMatch({ ...match, resourceId: otherDraftId }),
    ).resolves.toBeNull();
    await expect(storage.delegations.getActiveMatch({ ...match, now: future })).resolves.toBeNull();

    await storage.agentSessions.revoke(agentSessionId, ownerId, draftId, now);
    await expect(storage.delegations.getActiveMatch(match)).resolves.toBeNull();
    storage.close();
  });

  it("matches a current data grant only across the complete approved disclosure scope", async () => {
    const { storage } = await createFixture();
    const grant = {
      id: "grant_71000000-0000-7000-8000-000000000001",
      ownerId,
      draftId,
      recipientId: agentSessionId,
      purpose: "Tailor and submit the selected application.",
      payloadHash: "d".repeat(64),
      categories: ["identity", "application_answers"] as const,
      fieldKeys: ["full_name", "work_authorization"] as const,
      documentIds: ["document_71000000-0000-7000-8000-000000000001"] as const,
      noticeVersion: "privacy-2026-08",
      legalBasis: "consent" as const,
      status: "requested" as const,
      expiresAt: future,
      createdAt: now,
      approvedAt: null,
      withdrawnAt: null,
    };
    await expect(storage.richDataGrants.insert(grant, now)).resolves.toEqual({
      ...grant,
      version: 0,
    });
    await expect(storage.richDataGrants.getById(grant.id, ownerId, draftId)).resolves.toEqual({
      ...grant,
      version: 0,
    });
    await storage.richDataGrants.approve(grant.id, ownerId, draftId, now);
    await expect(storage.richDataGrants.listByDraft(ownerId, draftId)).resolves.toEqual([
      { ...grant, status: "active", approvedAt: now, version: 1 },
    ]);
    await expect(storage.richDataGrants.listByDraft(otherOwnerId, draftId)).resolves.toEqual([]);

    const match = {
      ownerId,
      draftId,
      recipientId: grant.recipientId,
      purpose: grant.purpose,
      payloadHash: grant.payloadHash,
      categories: grant.categories,
      fieldKeys: grant.fieldKeys,
      documentIds: grant.documentIds,
      noticeVersion: grant.noticeVersion,
      legalBasis: grant.legalBasis,
      now,
    };
    await expect(storage.richDataGrants.getCurrent(match)).resolves.toMatchObject({
      id: grant.id,
      status: "active",
    });
    await expect(
      storage.richDataGrants.getCurrent({ ...match, fieldKeys: ["email"] }),
    ).resolves.toBeNull();
    await expect(
      storage.richDataGrants.getCurrent({ ...match, noticeVersion: "privacy-2026-09" }),
    ).resolves.toBeNull();
    await expect(storage.richDataGrants.getCurrent({ ...match, now: future })).resolves.toBeNull();

    const withdrawalEvidence = {
      channel: "agent_client" as const,
      requestId: "interaction_71000000-0000-7000-8000-000000000001",
      action: "withdrawn" as const,
      evidenceVersion: "agent-interaction-v1" as const,
    };
    await expect(
      storage.richDataGrants.withdraw(grant.id, ownerId, draftId, now, withdrawalEvidence),
    ).resolves.toMatchObject({
      status: "withdrawn",
      version: 2,
      withdrawalChannel: "agent_client",
      withdrawalRequestId: withdrawalEvidence.requestId,
      withdrawalAction: "withdrawn",
      withdrawalEvidenceVersion: "agent-interaction-v1",
    });
    await expect(storage.richDataGrants.getCurrent(match)).resolves.toBeNull();

    const renewed = {
      ...grant,
      id: "grant_71000000-0000-7000-8000-000000000003",
      status: "requested" as const,
      approvedAt: null,
      withdrawnAt: null,
    };
    await expect(storage.richDataGrants.insert(renewed, now)).resolves.toMatchObject(renewed);
    await expect(
      storage.richDataGrants.insert(
        {
          ...renewed,
          id: "grant_71000000-0000-7000-8000-000000000004",
        },
        now,
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      storage.richDataGrants.insert(
        {
          ...renewed,
          id: "grant_71000000-0000-7000-8000-000000000005",
          noticeVersion: "privacy-2026-09",
        },
        now,
      ),
    ).resolves.toMatchObject({ noticeVersion: "privacy-2026-09" });
    storage.close();
  });

  it.each(["requested", "active"] as const)(
    "atomically retires an expired %s grant before inserting its replacement",
    async (status) => {
      const { storage } = await createFixture();
      const suffix = status === "requested" ? "061" : "062";
      const expiredGrant = {
        id: `grant_71000000-0000-7000-8000-000000000${suffix}`,
        ownerId,
        draftId,
        recipientId: agentSessionId,
        purpose: `Replace expired ${status} permission.`,
        payloadHash: (status === "requested" ? "6" : "7").repeat(64),
        categories: ["identity"] as const,
        fieldKeys: ["full_name"] as const,
        documentIds: [] as const,
        noticeVersion: "privacy-2026-08",
        legalBasis: "consent" as const,
        status,
        expiresAt: expired,
        createdAt: "2026-08-29T08:00:00.000Z",
        approvedAt: status === "active" ? "2026-08-29T08:05:00.000Z" : null,
        withdrawnAt: null,
      };
      await storage.richDataGrants.insert(expiredGrant, "2026-08-29T08:00:00.000Z");

      const replacement = {
        ...expiredGrant,
        id: `grant_71000000-0000-7000-8000-000000000${status === "requested" ? "071" : "072"}`,
        status: "requested" as const,
        expiresAt: future,
        createdAt: now,
        approvedAt: null,
      };
      await expect(storage.richDataGrants.insert(replacement, now)).resolves.toMatchObject({
        id: replacement.id,
        status: "requested",
        version: 0,
      });
      await expect(
        storage.richDataGrants.getById(expiredGrant.id, ownerId, draftId),
      ).resolves.toMatchObject({ status: "withdrawn", withdrawnAt: now, version: 1 });
      storage.close();
    },
  );

  it("rejects a data grant whose owner does not own the bound draft", async () => {
    const { storage } = await createFixture();
    await expect(
      storage.richDataGrants.insert(
        {
          id: "grant_71000000-0000-7000-8000-000000000002",
          ownerId,
          draftId: otherDraftId,
          recipientId: agentSessionId,
          purpose: "Cross-owner disclosure must fail.",
          payloadHash: "e".repeat(64),
          categories: ["identity"],
          fieldKeys: ["full_name"],
          documentIds: [],
          noticeVersion: "privacy-2026-08",
          legalBasis: "consent",
          status: "requested",
          expiresAt: future,
          createdAt: now,
          approvedAt: null,
          withdrawnAt: null,
        },
        now,
      ),
    ).rejects.toBeDefined();
    storage.close();
  });

  it("activates a grant only while its reviewed draft and job boundary still match", async () => {
    const { storage } = await createFixture();
    const reviewed = await storage.applications.update(
      {
        ...(await storage.applications.getByOwner(draftId, ownerId))!,
        state: "reviewed",
        version: 1,
        updatedAt: now,
      },
      0,
    );
    const review = {
      id: "review_71000000-0000-7000-8000-000000000031",
      ownerId,
      draftId,
      draftVersion: reviewed.version,
      payloadHash: "7".repeat(64),
      findings: [],
      status: "active" as const,
      createdAt: now,
      invalidatedAt: null,
    };
    await storage.applications.insertReview(review);
    const grant = await storage.richDataGrants.insert(
      {
        id: "grant_71000000-0000-7000-8000-000000000031",
        ownerId,
        draftId,
        recipientId: "org_71000000-0000-7000-8000-000000000001",
        purpose: "Submit this reviewed application to Authorization Lab.",
        payloadHash: review.payloadHash,
        categories: ["identity"],
        fieldKeys: ["full_name"],
        documentIds: [],
        noticeVersion: "privacy-2026-08",
        legalBasis: "user_instruction",
        status: "requested",
        expiresAt: future,
        createdAt: now,
        approvedAt: null,
        withdrawnAt: null,
      },
      now,
    );
    const guard = {
      expectedGrantVersion: grant.version ?? 0,
      expectedDraftVersion: reviewed.version,
      reviewId: review.id,
      reviewPayloadHash: review.payloadHash,
      jobId,
      jobOrganizationId: "org_71000000-0000-7000-8000-000000000001",
      jobOrganizationName: "Authorization Lab",
      jobApplyMode: "internal" as const,
    };

    await storage.jobs.upsert({
      ...(await storage.jobs.getById(jobId))!,
      organizationName: "Changed Organization",
      updatedAt: future,
    });
    const approvalEvidence = {
      channel: "agent_client" as const,
      requestId: grant.id,
      affirmativeAction: "confirmed" as const,
      evidenceVersion: "agent-interaction-v1" as const,
    };
    await expect(
      storage.richDataGrants.approveCurrent({
        id: grant.id,
        ownerId,
        draftId,
        at: now,
        approvalEvidence,
        ...guard,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await storage.jobs.upsert({
      ...(await storage.jobs.getById(jobId))!,
      organizationName: guard.jobOrganizationName,
      updatedAt: future,
    });
    await expect(
      storage.richDataGrants.approveCurrent({
        id: grant.id,
        ownerId,
        draftId,
        at: now,
        approvalEvidence,
        ...guard,
      }),
    ).resolves.toMatchObject({
      status: "active",
      version: 1,
      approvalChannel: "agent_client",
      approvalRequestId: grant.id,
      affirmativeAction: "confirmed",
      approvalEvidenceVersion: "agent-interaction-v1",
    });
    storage.close();
  });

  it("never resolves an expired agent session", async () => {
    const { storage } = await createFixture();
    const tokenHash = "f".repeat(64);
    await storage.agentSessions.insert({
      id: agentSessionId,
      ownerId,
      draftId,
      tokenHash,
      expiresAt: expired,
      revokedAt: null,
      createdAt: "2026-08-29T08:00:00.000Z",
    });
    await expect(
      storage.agentSessions.resolve({ tokenHash, ownerId, draftId, now }),
    ).resolves.toBeNull();
    storage.close();
  });

  it("atomically invalidates stale authorization artifacts after a material edit", async () => {
    const { storage } = await createFixture();
    const reviewed = await storage.applications.update(
      {
        ...(await storage.applications.getByOwner(draftId, ownerId))!,
        state: "reviewed",
        version: 1,
        updatedAt: now,
      },
      0,
    );
    const review = {
      id: "review_71000000-0000-7000-8000-000000000001",
      ownerId,
      draftId,
      draftVersion: reviewed.version,
      payloadHash: "1".repeat(64),
      findings: [],
      status: "active" as const,
      createdAt: now,
      invalidatedAt: null,
    };
    const confirmation = {
      id: "confirmation_71000000-0000-7000-8000-000000000001",
      ownerId,
      draftId,
      reviewId: review.id,
      payloadHash: review.payloadHash,
      confirmationHash: "2".repeat(64),
      status: "active" as const,
      expiresAt: future,
      createdAt: now,
      consumedAt: null,
    };
    const grant = {
      id: "grant_71000000-0000-7000-8000-000000000010",
      ownerId,
      draftId,
      recipientId: agentSessionId,
      purpose: "Submit the selected application.",
      payloadHash: review.payloadHash,
      categories: ["identity"] as const,
      fieldKeys: ["full_name"] as const,
      documentIds: [] as const,
      noticeVersion: "privacy-2026-08",
      legalBasis: "consent" as const,
      status: "active" as const,
      expiresAt: future,
      createdAt: now,
      approvedAt: now,
      withdrawnAt: null,
    };
    await storage.applications.insertReview(review);
    await storage.applications.insertConfirmation(confirmation);
    await storage.richDataGrants.insert(grant, now);

    await expect(storage.applications.getLatestReview(draftId, ownerId)).resolves.toEqual(review);
    await expect(
      storage.richDataGrants.withdraw(grant.id, ownerId, draftId, now),
    ).resolves.toMatchObject({ version: 1 });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "invalidated" });
    await expect(
      storage.richDataGrants.insert(
        { ...grant, id: "grant_71000000-0000-7000-8000-000000000019" },
        now,
      ),
    ).resolves.toMatchObject({ version: 0 });
    await expect(
      storage.applications.applyMaterialEdit({
        ownerId: otherOwnerId,
        expectedVersion: reviewed.version,
        draft: { ...reviewed, state: "draft", version: reviewed.version + 1, updatedAt: future },
        now: future,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(storage.applications.getReview(review.id, ownerId)).resolves.toMatchObject({
      status: "active",
    });
    const edited = await storage.applications.applyMaterialEdit({
      ownerId,
      expectedVersion: reviewed.version,
      draft: { ...reviewed, state: "draft", version: reviewed.version + 1, updatedAt: future },
      now: future,
    });

    expect(edited).toMatchObject({ version: 2, state: "draft" });
    await expect(storage.applications.getReview(review.id, ownerId)).resolves.toMatchObject({
      status: "invalidated",
      invalidatedAt: future,
    });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({
      status: "invalidated",
    });
    await expect(storage.richDataGrants.getById(grant.id, ownerId, draftId)).resolves.toMatchObject(
      {
        status: "withdrawn",
        withdrawnAt: now,
        version: 1,
      },
    );
    storage.close();
  });

  it("seals the reviewed draft and its immutable review together", async () => {
    const { storage } = await createFixture();
    const draft = (await storage.applications.getByOwner(draftId, ownerId))!;
    const review = {
      id: "review_71000000-0000-7000-8000-000000000021",
      ownerId,
      draftId,
      draftVersion: draft.version + 1,
      payloadHash: "5".repeat(64),
      findings: [],
      status: "active" as const,
      createdAt: now,
      invalidatedAt: null,
    };

    await expect(
      storage.applications.sealReview({
        ownerId,
        expectedVersion: draft.version,
        draft: { ...draft, state: "reviewed", version: draft.version + 1, updatedAt: now },
        review,
      }),
    ).resolves.toMatchObject({ draft: { state: "reviewed", version: 1 }, review });
    await expect(storage.applications.getLatestReview(draftId, ownerId)).resolves.toEqual(review);
    storage.close();
  });

  it("commits submission only for the exact current review, confirmation, and disclosure grant", async () => {
    const { filename, storage } = await createFixture();
    const reviewed = await storage.applications.update(
      {
        ...(await storage.applications.getByOwner(draftId, ownerId))!,
        state: "reviewed",
        version: 1,
        updatedAt: now,
      },
      0,
    );
    const review = {
      id: "review_71000000-0000-7000-8000-000000000011",
      ownerId,
      draftId,
      draftVersion: reviewed.version,
      payloadHash: "3".repeat(64),
      findings: [],
      status: "active" as const,
      createdAt: now,
      invalidatedAt: null,
    };
    const confirmation = {
      id: "confirmation_71000000-0000-7000-8000-000000000011",
      ownerId,
      draftId,
      reviewId: review.id,
      payloadHash: review.payloadHash,
      confirmationHash: "4".repeat(64),
      status: "active" as const,
      expiresAt: future,
      createdAt: now,
      consumedAt: null,
    };
    const grant = {
      id: "grant_71000000-0000-7000-8000-000000000011",
      ownerId,
      draftId,
      recipientId: "org_71000000-0000-7000-8000-000000000001",
      purpose: "Submit the selected application.",
      payloadHash: review.payloadHash,
      categories: ["identity"] as const,
      fieldKeys: ["full_name"] as const,
      documentIds: [] as const,
      noticeVersion: "privacy-2026-08",
      legalBasis: "consent" as const,
      status: "active" as const,
      expiresAt: future,
      createdAt: now,
      approvedAt: now,
      withdrawnAt: null,
    };
    const delivery = {
      id: "managed_delivery_71000000-0000-7000-8000-000000000011",
      ownerId,
      draftId,
      reviewId: review.id,
      confirmationId: confirmation.id,
      idempotencyKey: "submit-task9-once",
      provider: "jobbbler_demo" as const,
      providerReferenceId: "demo_submission_71000000-0000-7000-8000-000000000011",
      recipientId: grant.recipientId,
      recipientName: "Authorization Lab",
      payloadHash: review.payloadHash,
      fields: [
        {
          fieldKey: "full_name",
          label: "Full name",
          value: "Ada Lovelace",
          sensitive: true,
        },
      ],
      status: "acknowledged" as const,
      acknowledgedAt: now,
      createdAt: now,
    };
    const receipt = {
      id: "receipt_71000000-0000-7000-8000-000000000011",
      ownerId,
      draftId,
      reviewId: review.id,
      confirmationId: confirmation.id,
      idempotencyKey: "submit-task9-once",
      status: "submitted" as const,
      externalUrl: null,
      submission: {
        managedDeliveryId: delivery.id,
        provider: delivery.provider,
        providerReferenceId: delivery.providerReferenceId,
        recipientId: delivery.recipientId,
        recipientName: delivery.recipientName,
        submittedAt: delivery.acknowledgedAt,
        fields: delivery.fields,
      },
      createdAt: now,
    };
    await storage.applications.insertReview(review);
    await storage.applications.insertConfirmation(confirmation);
    await storage.richDataGrants.insert(grant, now);

    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery,
        decisionChannel: "first_party_ui",
        receipt: {
          id: "receipt_71000000-0000-7000-8000-000000000099",
          ownerId,
          draftId,
          reviewId: review.id,
          confirmationId: confirmation.id,
          idempotencyKey: receipt.idempotencyKey,
          status: "handed_off",
          externalUrl: "https://jobs.example.test/opening/42",
          createdAt: now,
        },
        now,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "active", consumedAt: null });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toBeNull();

    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0, categories: ["contact"] },
        delivery,
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "active" });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toBeNull();

    await expect(storage.delegations.listByResource(ownerId, draftId)).resolves.toEqual([]);
    await storage.agentSessions.insert({
      id: agentSessionId,
      ownerId,
      draftId,
      tokenHash: "5".repeat(64),
      expiresAt: future,
      revokedAt: null,
      createdAt: now,
    });
    for (const status of ["requested", "active"] as const) {
      await storage.delegations.insert({
        id: `delegation_71000000-0000-7000-8000-00000000001${status === "requested" ? "3" : "4"}`,
        ownerId,
        agentSessionId,
        resourceType: "application_draft",
        resourceId: draftId,
        operations: ["read_application"],
        purpose: `Expired ${status} assistance must not block a manual submission.`,
        status,
        expiresAt: expired,
        createdAt: expired,
        approvedAt: status === "active" ? expired : null,
        revokedAt: null,
      });
    }
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0, categories: ["contact"] },
        delivery,
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const lateAssistance = {
      id: "delegation_71000000-0000-7000-8000-000000000011",
      ownerId,
      agentSessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operations: ["read_application"] as const,
      purpose: "Prepare this application after the page preflight.",
      status: "requested" as const,
      expiresAt: future,
      createdAt: now,
      approvedAt: null,
      revokedAt: null,
    };
    await storage.delegations.insert(lateAssistance);
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery,
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "active", consumedAt: null });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toBeNull();
    await storage.delegations.revoke(lateAssistance.id, ownerId, now);

    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery: { ...delivery, status: "not_acknowledged" as never },
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).rejects.toMatchObject({ code: "VALIDATION" });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "active", consumedAt: null });
    await expect(storage.applications.getByOwner(draftId, ownerId)).resolves.toMatchObject({
      state: "reviewed",
      version: reviewed.version,
    });
    await expect(storage.applications.getManagedDelivery(delivery.id, ownerId)).resolves.toBeNull();
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toBeNull();

    const openJob = await storage.jobs.getById(jobId);
    expect(openJob).not.toBeNull();
    await storage.jobs.upsert({ ...openJob!, status: "closed", updatedAt: future });
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery,
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).rejects.toMatchObject({
      code: "CONFLICT",
      message: "Role closed — nothing submitted.",
    });
    await expect(
      storage.applications.getConfirmation(confirmation.id, ownerId),
    ).resolves.toMatchObject({ status: "active", consumedAt: null });
    await expect(storage.applications.getByOwner(draftId, ownerId)).resolves.toMatchObject({
      state: "reviewed",
      version: reviewed.version,
    });
    await expect(storage.applications.getManagedDelivery(delivery.id, ownerId)).resolves.toBeNull();
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toBeNull();
    await storage.jobs.upsert({ ...openJob!, status: "open", updatedAt: future });

    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery,
        decisionChannel: "first_party_ui",
        receipt,
        now,
      }),
    ).resolves.toMatchObject({
      draft: { state: "submitted", version: 2 },
      receipt,
      delivery,
    });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toEqual(receipt);
    await expect(storage.applications.getManagedDelivery(delivery.id, ownerId)).resolves.toEqual(
      delivery,
    );
    await expect(
      storage.delegations.insert({
        ...lateAssistance,
        id: "delegation_71000000-0000-7000-8000-000000000012",
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await storage.jobs.upsert({ ...openJob!, status: "closed", updatedAt: future });
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: reviewed.version,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: { ...grant, version: 0 },
        delivery: { ...delivery, id: "managed_delivery_71000000-0000-7000-8000-000000000012" },
        decisionChannel: "first_party_ui",
        receipt: { ...receipt, id: "receipt_71000000-0000-7000-8000-000000000012" },
        now,
      }),
    ).resolves.toMatchObject({ receipt, delivery, inserted: false });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toEqual(receipt);
    await expect(storage.applications.getManagedDelivery(delivery.id, ownerId)).resolves.toEqual(
      delivery,
    );
    const persisted = openSqliteDatabase(filename);
    expect(
      persisted
        .prepare(
          "SELECT count(*) AS count FROM managed_application_deliveries WHERE owner_id=? AND draft_id=?",
        )
        .get(ownerId, draftId),
    ).toEqual({ count: 1 });
    persisted.close();
    storage.close();
  });
});

afterAll(async () => {
  await Promise.all(
    temporaryDirectories.map((directory) => rm(directory, { recursive: true, force: true })),
  );
});
