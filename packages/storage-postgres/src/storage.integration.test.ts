import { afterEach, describe, expect, it } from "vitest";

import type {
  ApplicationDraft,
  Job,
  PersistSourceObservationInput,
  SourceRunRecord,
  WorkItemRecord,
} from "@jobbbler/storage";
import { storageContractSuite } from "@jobbbler/storage/contract-tests";

import { createPostgresStorage, migratePostgres, resetPostgresSchema } from "./index.js";

const databaseUrl = process.env["POSTGRES_TEST_DATABASE_URL"];
const ingestionNow = "2026-08-29T10:00:00.000Z";
const ingestionLater = "2026-08-29T11:00:00.000Z";

function ingestionRun(id: string, startedAt: string): SourceRunRecord {
  return {
    id,
    sourceKey: "jobicy",
    partition: "default",
    purpose: "production",
    status: "running",
    policyVersion: 1,
    startedAt,
    completedAt: null,
    complete: null,
    notModified: false,
    pagesFetched: 0,
    recordsFetched: 0,
    recordsAccepted: 0,
    recordsRejected: 0,
    recordsUnchanged: 0,
    responseEtag: null,
    responseLastModified: null,
    responseBytes: 0,
    errorCode: null,
  };
}

function ingestionObservation(
  runId: string,
  rawHash: string,
  applyMode: Job["applyMode"],
): PersistSourceObservationInput {
  const organization = {
    id: "org-postgres-ingestion-mode",
    name: "Postgres Ingestion Mode",
    slug: "postgres-ingestion-mode",
    website: null,
    description: applyMode === "external" ? "Original organization." : "Conflicting update.",
    createdAt: ingestionNow,
    updatedAt: applyMode === "external" ? ingestionNow : ingestionLater,
  };
  return {
    runId,
    evidence: {
      sourceKey: "jobicy",
      partition: "default",
      externalId: "postgres-mode-100",
      originalUrl: "https://jobicy.example/jobs/postgres-mode-100",
      applyUrl: "https://jobicy.example/jobs/postgres-mode-100/apply",
      sourceUpdatedAt: applyMode === "external" ? ingestionNow : ingestionLater,
      fetchedAt: applyMode === "external" ? ingestionNow : ingestionLater,
      retainedUntil: "2026-09-29T10:00:00.000Z",
      rawHash,
      payload: { id: "postgres-mode-100" },
      policyVersion: 1,
      attribution: {
        label: "Jobicy",
        url: "https://jobicy.com/",
        required: true,
        followedLinkRequired: false,
      },
    },
    normalization: {
      accepted: true,
      normalizerVersion: 1,
      recordedAt: applyMode === "external" ? ingestionNow : ingestionLater,
      organization,
      job: {
        id: "job-postgres-ingestion-mode",
        organizationId: organization.id,
        organizationName: organization.name,
        title: "Postgres ingestion mode",
        summary: "Verify atomic ingestion projection writes.",
        categories: ["software_engineering"],
        workModel: "remote",
        employmentType: "full_time",
        seniority: "senior",
        locations: ["Europe"],
        skills: ["PostgreSQL"],
        salary: null,
        source: {
          key: "jobicy",
          label: "Jobicy",
          url: "https://jobicy.example/jobs/postgres-mode-100",
        },
        applyMode,
        status: "open",
        publishedAt: ingestionNow,
        updatedAt: applyMode === "external" ? ingestionNow : ingestionLater,
      },
      sourceLink: {
        originalUrl: "https://jobicy.example/jobs/postgres-mode-100",
        applyUrl: "https://jobicy.example/jobs/postgres-mode-100/apply",
        identityBasis: "source_id",
      },
    },
  };
}

function deferred(): { readonly promise: Promise<void>; readonly resolve: () => void } {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

async function waitForBlockedEntityWrite(
  sql: ReturnType<typeof createPostgresStorage>["sql"],
): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (Date.now() < deadline) {
    const rows = await sql<{ readonly blocked: boolean }[]>`
      SELECT EXISTS (
        SELECT 1 FROM pg_stat_activity
        WHERE datname = current_database()
          AND pid <> pg_backend_pid()
          AND state = 'active'
          AND wait_event_type = 'Lock'
          AND query ILIKE '%jobbbler.entity_records%'
      ) AS blocked`;
    if (rows[0]?.blocked === true) return;
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error("Timed out waiting for the stale work-item mutation to block on reclaim.");
}

describe.skipIf(databaseUrl === undefined)("PostgreSQL storage integration", () => {
  let close: (() => Promise<void>) | undefined;

  afterEach(async () => {
    await close?.();
    close = undefined;
  });

  storageContractSuite("PostgreSQL", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    close = async () => storage.close();
    return storage;
  });

  it("uses deny-by-default RLS on private tables", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const rows = await storage.sql<
      {
        readonly tablename: string;
        readonly rowsecurity: boolean;
      }[]
    >`SELECT tablename, rowsecurity FROM pg_tables WHERE schemaname = 'jobbbler'`;
    expect(rows).not.toHaveLength(0);
    expect(rows.every((row) => row.rowsecurity)).toBe(true);
    await storage.close();
  });

  it("rolls back every observation write when an ingestion projection changes apply mode", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    close = async () => storage.close();
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const original = ingestionObservation("run-postgres-mode-1", "a".repeat(64), "external");
    await storage.ingestion.insertRun(ingestionRun(original.runId, ingestionNow));
    await storage.ingestion.persistObservation(original);
    await storage.ingestion.insertRun(ingestionRun("run-postgres-mode-2", ingestionLater));
    const counts = async () =>
      storage.sql<{ readonly kind: string; readonly count: string }[]>`
        SELECT kind, count(*)::text AS count
        FROM jobbbler.entity_records
        WHERE kind IN (
          'source_evidence', 'source_run_record', 'organization',
          'job', 'job_version', 'job_source_link'
        )
        GROUP BY kind
        ORDER BY kind`;
    const before = await counts();

    await expect(
      storage.ingestion.persistObservation(
        ingestionObservation("run-postgres-mode-2", "b".repeat(64), "internal"),
      ),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    await expect(counts()).resolves.toEqual(before);
    await expect(storage.jobs.getById("job-postgres-ingestion-mode")).resolves.toMatchObject({
      applyMode: "external",
      updatedAt: ingestionNow,
    });
    await expect(
      storage.organizations.getById("org-postgres-ingestion-mode"),
    ).resolves.toMatchObject({ description: "Original organization.", updatedAt: ingestionNow });
    await expect(
      storage.ingestion.listJobVersions("job-postgres-ingestion-mode"),
    ).resolves.toHaveLength(1);
    await expect(
      storage.ingestion.listJobSourceLinks("job-postgres-ingestion-mode"),
    ).resolves.toEqual([expect.objectContaining({ latestRawHash: "a".repeat(64) })]);
  });

  it("does not overwrite a concurrent consent withdrawal with a stale application update", async () => {
    const staleWriter = createPostgresStorage(databaseUrl!);
    const withdrawalWriter = createPostgresStorage(databaseUrl!);
    close = async () => {
      await Promise.all([staleWriter.close(), withdrawalWriter.close()]);
    };
    await resetPostgresSchema(staleWriter.sql);
    await migratePostgres(staleWriter.sql);

    const now = "2026-08-29T10:00:00.000Z";
    const ownerId = "owner-postgres-consent-race";
    const draft: ApplicationDraft = {
      id: "application-postgres-consent-race",
      ownerId,
      jobId: "job-postgres-consent-race",
      state: "draft",
      version: 0,
      consentRevision: 0,
      answers: [
        {
          fieldKey: "full_name",
          value: "Ada Lovelace",
          provenance: "agent_suggestion",
          sensitive: true,
          acceptedByHuman: true,
        },
      ],
      createdAt: now,
      updatedAt: now,
    };
    await staleWriter.owners.insert({
      id: ownerId,
      kind: "guest",
      verified: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await staleWriter.applications.insert(draft);

    const rowLocked = deferred();
    const releaseWithdrawal = deferred();
    const withdrawnDraft: ApplicationDraft = {
      ...draft,
      consentRevision: 1,
      answers: draft.answers.map((answer) => ({ ...answer, acceptedByHuman: false })),
      version: 1,
      updatedAt: "2026-08-29T10:01:00.000Z",
    };
    const withdrawal = withdrawalWriter.sql.begin(async (transaction) => {
      await transaction`
        SELECT id FROM jobbbler.entity_records
        WHERE kind = 'application' AND id = ${draft.id}
        FOR UPDATE`;
      rowLocked.resolve();
      await releaseWithdrawal.promise;
      await transaction`
        UPDATE jobbbler.entity_records
        SET body = ${transaction.json(withdrawnDraft)},
            version = ${withdrawnDraft.version},
            updated_at = ${withdrawnDraft.updatedAt}
        WHERE kind = 'application' AND id = ${draft.id}`;
    });
    await rowLocked.promise;

    const staleUpdate = staleWriter.applications.update(
      {
        ...draft,
        state: "valid",
        version: 1,
        updatedAt: "2026-08-29T10:02:00.000Z",
      },
      0,
    );
    await waitForBlockedEntityWrite(withdrawalWriter.sql);
    releaseWithdrawal.resolve();
    await withdrawal;

    await expect(staleUpdate).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(staleWriter.applications.getById(draft.id)).resolves.toMatchObject({
      consentRevision: 1,
      answers: [{ acceptedByHuman: false }],
      version: 1,
    });
  });

  it.each(["renew", "complete", "fail"] as const)(
    "fences a stale %s after another worker reclaims the lease",
    async (transition) => {
      const staleWorker = createPostgresStorage(databaseUrl!);
      const reclaimingWorker = createPostgresStorage(databaseUrl!);
      const releaseReclaim = deferred();
      let reclaim: Promise<unknown> | undefined;
      try {
        await resetPostgresSchema(staleWorker.sql);
        await migratePostgres(staleWorker.sql);
        const now = "2026-08-29T10:00:00.000Z";
        const staleNow = "2026-08-29T10:01:00.000Z";
        const originalLease = "2026-08-29T10:05:00.000Z";
        const reclaimedAt = originalLease;
        const reclaimedLease = "2026-08-29T10:10:00.000Z";
        const work: WorkItemRecord = {
          id: `work-postgres-stale-${transition}`,
          kind: "catalog_ingest",
          payload: { source: "fixture" },
          status: "pending",
          availableAt: now,
          attempt: 0,
          maxAttempts: 3,
          leaseOwner: null,
          leaseExpiresAt: null,
          lastErrorCode: null,
          createdAt: now,
          updatedAt: now,
        };
        await staleWorker.workItems.insert(work);
        await staleWorker.workItems.claimDue({
          workerId: "worker-a",
          now,
          leaseExpiresAt: originalLease,
          limit: 1,
        });

        const reclaimReady = deferred();
        reclaim = reclaimingWorker.sql.begin(async (transaction) => {
          await transaction`
            UPDATE jobbbler.entity_records
            SET body = body || ${transaction.json({
              status: "running",
              attempt: 2,
              leaseOwner: "worker-b",
              leaseExpiresAt: reclaimedLease,
              updatedAt: reclaimedAt,
            })}::jsonb,
                updated_at = ${reclaimedAt}
            WHERE kind = 'work_item' AND id = ${work.id}`;
          reclaimReady.resolve();
          await releaseReclaim.promise;
        });
        await reclaimReady.promise;

        const staleMutation =
          transition === "renew"
            ? staleWorker.workItems.renewLease({
                id: work.id,
                workerId: "worker-a",
                now: staleNow,
                leaseExpiresAt: "2026-08-29T10:07:00.000Z",
              })
            : transition === "complete"
              ? staleWorker.workItems.complete(work.id, "worker-a", staleNow)
              : staleWorker.workItems.fail({
                  id: work.id,
                  workerId: "worker-a",
                  now: staleNow,
                  retryAt: "2026-08-29T10:08:00.000Z",
                  errorCode: "DEPENDENCY",
                  terminal: false,
                });
        const staleAssertion = expect(staleMutation).rejects.toMatchObject({ code: "CONFLICT" });
        await waitForBlockedEntityWrite(reclaimingWorker.sql);
        releaseReclaim.resolve();
        await reclaim;
        await staleAssertion;
        await expect(staleWorker.workItems.getById(work.id)).resolves.toMatchObject({
          status: "running",
          attempt: 2,
          leaseOwner: "worker-b",
          leaseExpiresAt: reclaimedLease,
          updatedAt: reclaimedAt,
        });
      } finally {
        releaseReclaim.resolve();
        await Promise.allSettled([reclaim, staleWorker.close(), reclaimingWorker.close()]);
      }
    },
  );

  it("rejects a delegation after its bound agent session is revoked", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);

    const now = "2026-08-29T10:00:00.000Z";
    const ownerId = "owner-postgres-auth";
    const draftId = "application-postgres-auth";
    const sessionId = "agent-session-postgres-auth";
    const organizationId = "organization-postgres-auth";
    const jobId = "job-postgres-auth";
    const job: Job = {
      id: jobId,
      organizationId,
      organizationName: "PostgreSQL Authorization Lab",
      title: "Platform Engineer",
      summary: "Test fixture.",
      categories: ["software_engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Europe"],
      skills: ["TypeScript"],
      salary: null,
      source: { key: "test", label: "Test", url: null },
      applyMode: "internal",
      status: "open",
      publishedAt: now,
      updatedAt: now,
    };
    const draft: ApplicationDraft = {
      id: draftId,
      ownerId,
      jobId,
      state: "draft",
      version: 0,
      answers: [],
      createdAt: now,
      updatedAt: now,
    };

    await storage.owners.insert({
      id: ownerId,
      kind: "guest",
      verified: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await storage.organizations.upsert({
      id: organizationId,
      name: "PostgreSQL Authorization Lab",
      slug: "postgres-auth-lab",
      website: null,
      description: "Test fixture.",
      createdAt: now,
      updatedAt: now,
    });
    await storage.jobs.upsert(job);
    await storage.applications.insert(draft);
    const review = {
      id: "review-postgres-auth",
      ownerId,
      draftId,
      draftVersion: 1,
      payloadHash: "c".repeat(64),
      findings: [],
      status: "active" as const,
      createdAt: now,
      invalidatedAt: null,
    };
    await expect(
      storage.applications.sealReview({
        ownerId,
        expectedVersion: 0,
        draft: { ...draft, state: "reviewed", version: 1 },
        review,
      }),
    ).resolves.toMatchObject({ draft: { state: "reviewed", version: 1 }, review });
    await expect(storage.applications.getLatestReview(draftId, ownerId)).resolves.toEqual(review);
    await storage.agentSessions.insert({
      id: sessionId,
      ownerId,
      draftId,
      tokenHash: "a".repeat(64),
      expiresAt: "2026-08-29T11:00:00.000Z",
      revokedAt: null,
      createdAt: now,
    });
    const delegation = {
      id: "delegation-postgres-auth",
      ownerId,
      agentSessionId: sessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operations: ["edit_application"] as const,
      purpose: "Prepare the selected application.",
      status: "requested" as const,
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      approvedAt: null,
      revokedAt: null,
    };
    await storage.delegations.insert(delegation);
    await storage.delegations.approve(delegation.id, ownerId, now, {
      channel: "agent_client",
      requestId: delegation.id,
      action: "approved",
      evidenceVersion: "agent-interaction-v1",
    });

    const expiredDelegation = {
      ...delegation,
      id: "delegation-postgres-auth-expired",
      expiresAt: now,
    };
    await storage.delegations.insert(expiredDelegation);
    await expect(
      storage.delegations.approve(expiredDelegation.id, ownerId, now),
    ).rejects.toMatchObject({ code: "CONFLICT" });

    const newerDelegation = {
      ...delegation,
      id: "delegation-postgres-auth-newer",
      operations: ["read_application"] as const,
      status: "requested" as const,
      createdAt: "2026-08-29T10:01:00.000Z",
    };
    await storage.delegations.insert(newerDelegation);
    await expect(storage.delegations.listByResource(ownerId, draftId)).resolves.toEqual([
      newerDelegation,
      expiredDelegation,
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
    await expect(storage.delegations.listByResource("other-owner", draftId)).resolves.toEqual([]);

    const grant = {
      id: "rich-data-grant-postgres-auth",
      ownerId,
      draftId,
      recipientId: sessionId,
      purpose: "Tailor the selected application.",
      payloadHash: "b".repeat(64),
      categories: ["identity"] as const,
      fieldKeys: ["full_name"] as const,
      documentIds: [] as const,
      noticeVersion: "privacy-2026-08",
      legalBasis: "consent" as const,
      status: "requested" as const,
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      approvedAt: null,
      withdrawnAt: null,
    };
    await expect(storage.richDataGrants.insert(grant)).resolves.toEqual({ ...grant, version: 0 });
    await expect(storage.richDataGrants.listByDraft(ownerId, draftId)).resolves.toEqual([
      { ...grant, version: 0 },
    ]);
    await expect(storage.richDataGrants.listByDraft("other-owner", draftId)).resolves.toEqual([]);
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
      version: 1,
      withdrawalChannel: "agent_client",
      withdrawalRequestId: withdrawalEvidence.requestId,
      withdrawalAction: "withdrawn",
      withdrawalEvidenceVersion: "agent-interaction-v1",
    });
    await expect(
      storage.richDataGrants.withdraw(grant.id, ownerId, draftId, now),
    ).resolves.toMatchObject({ status: "withdrawn", version: 1 });

    const match = {
      ownerId,
      agentSessionId: sessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operation: "edit_application" as const,
      now,
    };
    await expect(storage.delegations.getActiveMatch(match)).resolves.toMatchObject({
      id: delegation.id,
    });
    await storage.agentSessions.revoke(sessionId, ownerId, draftId, now);
    await expect(storage.delegations.getActiveMatch(match)).resolves.toBeNull();
    await expect(storage.delegations.revoke(delegation.id, ownerId, now)).resolves.toMatchObject({
      status: "revoked",
    });
    await expect(storage.delegations.revoke(delegation.id, ownerId, now)).resolves.toMatchObject({
      status: "revoked",
    });

    const confirmation = {
      id: "confirmation-postgres-auth",
      ownerId,
      draftId,
      reviewId: review.id,
      payloadHash: review.payloadHash,
      confirmationHash: "d".repeat(64),
      status: "active" as const,
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      consumedAt: null,
    };
    const submissionGrant = {
      id: "rich-data-grant-postgres-submission",
      ownerId,
      draftId,
      recipientId: sessionId,
      purpose: "Submit the selected application.",
      payloadHash: review.payloadHash,
      categories: ["identity"] as const,
      fieldKeys: ["full_name"] as const,
      documentIds: [] as const,
      noticeVersion: "privacy-2026-08",
      legalBasis: "consent" as const,
      status: "active" as const,
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      approvedAt: now,
      withdrawnAt: null,
      version: 0,
    };
    const receipt = {
      id: "receipt-postgres-auth",
      ownerId,
      draftId,
      reviewId: review.id,
      confirmationId: confirmation.id,
      idempotencyKey: "postgres-submit-once",
      status: "submitted" as const,
      externalUrl: null,
      createdAt: now,
    };
    await storage.applications.insertConfirmation(confirmation);
    await storage.richDataGrants.insert(submissionGrant);
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: 1,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: submissionGrant,
        receipt: {
          ...receipt,
          id: "receipt-postgres-auth-handoff",
          status: "handed_off",
          externalUrl: "https://jobs.example.test/opening/42",
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
        expectedDraftVersion: 1,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: submissionGrant,
        receipt,
        now,
      }),
    ).resolves.toMatchObject({
      draft: { state: "submitted", version: 2 },
      receipt,
      inserted: true,
    });
    await expect(
      storage.applications.completeSubmission({
        ownerId,
        draftId,
        expectedDraftVersion: 1,
        reviewId: review.id,
        reviewPayloadHash: review.payloadHash,
        confirmationId: confirmation.id,
        confirmationHash: confirmation.confirmationHash,
        grant: submissionGrant,
        receipt: { ...receipt, id: "receipt-postgres-auth-retry" },
        now,
      }),
    ).resolves.toMatchObject({ receipt, inserted: false });
    await expect(storage.applications.getLatestReceipt(draftId, ownerId)).resolves.toEqual(receipt);
    await storage.close();
  });

  it("never reactivates a delegation when approval and revocation race", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    close = async () => storage.close();

    const now = "2026-08-29T10:00:00.000Z";
    const ownerId = "owner-postgres-delegation-race";
    const draftId = "application-postgres-delegation-race";
    const sessionId = "agent-session-postgres-delegation-race";
    await storage.owners.insert({
      id: ownerId,
      kind: "guest",
      verified: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    });
    await storage.applications.insert({
      id: draftId,
      ownerId,
      jobId: "job-postgres-delegation-race",
      state: "draft",
      version: 0,
      answers: [],
      createdAt: now,
      updatedAt: now,
    });
    await storage.agentSessions.insert({
      id: sessionId,
      ownerId,
      draftId,
      tokenHash: "d".repeat(64),
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      revokedAt: null,
    });
    const delegation = {
      id: "delegation-postgres-race",
      ownerId,
      agentSessionId: sessionId,
      resourceType: "application_draft" as const,
      resourceId: draftId,
      operations: ["edit_application"] as const,
      purpose: "Prepare the selected application.",
      status: "requested" as const,
      expiresAt: "2026-08-29T11:00:00.000Z",
      createdAt: now,
      approvedAt: null,
      revokedAt: null,
    };
    await storage.delegations.insert(delegation);

    await Promise.allSettled([
      storage.delegations.approve(delegation.id, ownerId, now, {
        channel: "agent_client",
        requestId: delegation.id,
        action: "approved",
        evidenceVersion: "agent-interaction-v1",
      }),
      storage.delegations.revoke(delegation.id, ownerId, now, {
        channel: "agent_client",
        requestId: delegation.id,
        action: "declined",
        evidenceVersion: "agent-interaction-v1",
      }),
    ]);

    await expect(storage.delegations.getById(delegation.id, ownerId)).resolves.toMatchObject({
      status: "revoked",
    });
  });

  it("serializes verification and recovery consumption while rotating exactly one session", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const now = "2026-08-29T10:00:00.000Z";
    const owner = {
      id: "owner-postgres-recovery",
      kind: "guest" as const,
      verified: false,
      version: 0,
      createdAt: now,
      updatedAt: now,
    };
    const originalSession = {
      id: "session-postgres-recovery-original",
      ownerId: owner.id,
      tokenHash: "original-session-hash",
      status: "active" as const,
      expiresAt: "2026-09-05T10:00:00.000Z",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.createOwnerWithSession({ owner, session: originalSession });
    const endpoint = {
      id: "endpoint-postgres-recovery",
      ownerId: owner.id,
      kind: "email" as const,
      addressHash: "verified-address-hash",
      addressCiphertext: "sealed-address",
      maskedAddress: "p•••••@example.com",
      status: "pending" as const,
      verifiedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    const verification = {
      id: "challenge-postgres-recovery",
      ownerId: owner.id,
      endpointId: endpoint.id,
      tokenHash: "verification-token-hash",
      status: "pending" as const,
      attempts: 0,
      maxAttempts: 5,
      expiresAt: "2026-08-29T10:10:00.000Z",
      consumedAt: null,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.beginEmailVerification({ endpoint, challenge: verification });
    const invalidVerificationResults = await Promise.all([
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: verification.id,
        tokenHash: "wrong-verification-token-a",
        now,
      }),
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: verification.id,
        tokenHash: "wrong-verification-token-b",
        now,
      }),
    ]);
    expect(invalidVerificationResults.map(({ status }) => status)).toEqual(["invalid", "invalid"]);
    const verificationAttempts = await storage.sql<{ readonly attempts: string }[]>`
      SELECT body->>'attempts' AS attempts
      FROM jobbbler.entity_records
      WHERE kind = 'verification_challenge' AND id = ${verification.id}`;
    expect(verificationAttempts[0]?.attempts).toBe("2");
    const verificationResults = await Promise.all([
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: verification.id,
        tokenHash: verification.tokenHash,
        now,
      }),
      storage.identity.consumeEmailVerification({
        ownerId: owner.id,
        challengeId: verification.id,
        tokenHash: verification.tokenHash,
        now,
      }),
    ]);
    expect(verificationResults.map(({ status }) => status).sort()).toEqual([
      "consumed",
      "verified",
    ]);

    const recovery = await storage.identity.beginOwnerRecovery({
      addressHash: endpoint.addressHash,
      challenge: {
        id: "recovery-postgres",
        tokenHash: "recovery-token-hash",
        status: "pending",
        attempts: 0,
        maxAttempts: 5,
        expiresAt: "2026-08-29T10:10:00.000Z",
        consumedAt: null,
        createdAt: now,
        updatedAt: now,
      },
    });
    expect(recovery).not.toBeNull();
    const invalidRecoveryResults = await Promise.all([
      storage.identity.consumeOwnerRecovery({
        challengeId: "recovery-postgres",
        tokenHash: "wrong-recovery-token-a",
        now,
        session: {
          id: "session-postgres-recovery-unused-a",
          tokenHash: "unused-session-hash-a",
          status: "active",
          expiresAt: "2026-09-05T10:00:00.000Z",
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
      storage.identity.consumeOwnerRecovery({
        challengeId: "recovery-postgres",
        tokenHash: "wrong-recovery-token-b",
        now,
        session: {
          id: "session-postgres-recovery-unused-b",
          tokenHash: "unused-session-hash-b",
          status: "active",
          expiresAt: "2026-09-05T10:00:00.000Z",
          lastSeenAt: now,
          createdAt: now,
          updatedAt: now,
        },
      }),
    ]);
    expect(invalidRecoveryResults.map(({ status }) => status)).toEqual(["invalid", "invalid"]);
    const recoveryAttempts = await storage.sql<{ readonly attempts: string }[]>`
      SELECT body->>'attempts' AS attempts
      FROM jobbbler.entity_records
      WHERE kind = 'owner_recovery_challenge' AND id = 'recovery-postgres'`;
    expect(recoveryAttempts[0]?.attempts).toBe("2");
    const sessionInput = {
      tokenHash: "rotated-session-hash-a",
      status: "active" as const,
      expiresAt: "2026-09-05T10:00:00.000Z",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    const recoveryResults = await Promise.all([
      storage.identity.consumeOwnerRecovery({
        challengeId: "recovery-postgres",
        tokenHash: "recovery-token-hash",
        now,
        session: { ...sessionInput, id: "session-postgres-recovery-a" },
      }),
      storage.identity.consumeOwnerRecovery({
        challengeId: "recovery-postgres",
        tokenHash: "recovery-token-hash",
        now,
        session: {
          ...sessionInput,
          id: "session-postgres-recovery-b",
          tokenHash: "rotated-session-hash-b",
        },
      }),
    ]);
    expect(recoveryResults.map(({ status }) => status).sort()).toEqual(["consumed", "recovered"]);
    const active = await storage.sql<{ readonly count: string }[]>`
      SELECT count(*)::text AS count
      FROM jobbbler.entity_records
      WHERE kind = 'owner_session' AND owner_id = ${owner.id} AND body->>'status' = 'active'`;
    expect(active[0]?.count).toBe("1");
    await storage.close();
  });

  it("deletes only through a live owner-bound intent and retains scrubbed audit integrity", async () => {
    const storage = createPostgresStorage(databaseUrl!);
    await resetPostgresSchema(storage.sql);
    await migratePostgres(storage.sql);
    const now = "2026-08-29T10:00:00.000Z";
    const owner = {
      id: "owner-postgres-deletion",
      kind: "guest" as const,
      verified: true,
      version: 1,
      createdAt: now,
      updatedAt: now,
    };
    const session = {
      id: "session-postgres-deletion",
      ownerId: owner.id,
      tokenHash: "deletion-session-hash",
      status: "active" as const,
      expiresAt: "2026-09-05T10:00:00.000Z",
      lastSeenAt: now,
      createdAt: now,
      updatedAt: now,
    };
    await storage.identity.createOwnerWithSession({ owner, session });
    await storage.savedSearches.insert({
      id: "search-postgres-deletion",
      ownerId: owner.id,
      name: "Private search",
      criteria: {
        query: null,
        categories: [],
        workModels: [],
        seniorities: [],
        locations: [],
        skills: [],
        excludeKeywords: [],
        salary: null,
        postedWithinDays: null,
        sort: "relevance",
        limit: 25,
        cursor: null,
        unresolvedAssumptions: [],
      },
      version: 0,
      createdAt: now,
      updatedAt: now,
    });
    await storage.audit.append({
      id: "audit-postgres-deletion",
      type: "saved_search.created",
      actorKind: "human",
      actorId: owner.id,
      aggregateType: "saved_search",
      aggregateId: "search-postgres-deletion",
      correlationId: "correlation-postgres-deletion",
      safeMetadata: { privateName: "Private search" },
      occurredAt: now,
    });
    await storage.identity.beginOwnerDeletion({
      id: "deletion-postgres",
      ownerId: owner.id,
      status: "pending",
      expiresAt: "2026-08-29T10:05:00.000Z",
      createdAt: now,
      updatedAt: now,
    });

    await expect(
      storage.identity.deleteOwnerPrivateData({
        ownerId: owner.id,
        sessionId: session.id,
        deletionId: "deletion-postgres",
        now,
      }),
    ).resolves.toBe(true);
    const privateRows = await storage.sql<{ readonly count: string }[]>`
      SELECT count(*)::text AS count FROM jobbbler.entity_records WHERE owner_id = ${owner.id}`;
    expect(privateRows[0]?.count).toBe("0");
    await expect(
      storage.audit.listForAggregate("saved_search", "deleted", 10),
    ).resolves.toMatchObject([
      {
        id: "audit-postgres-deletion",
        actorId: null,
        aggregateId: "deleted",
        correlationId: "deleted",
        safeMetadata: { redacted: true },
      },
    ]);
    await storage.close();
  });
});
