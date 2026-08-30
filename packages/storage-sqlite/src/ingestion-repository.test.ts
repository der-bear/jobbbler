import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";

import type {
  PersistSourceObservationInput,
  SourceRunRecord,
  SourceStateInput,
} from "@jobbbler/storage";

import { createSqliteStorage } from "./storage.js";
import { openSqliteDatabase } from "./connection.js";

const now = "2026-08-29T10:00:00.000Z";
const later = "2026-08-29T11:00:00.000Z";
const acceptedJobId = "job_550e8400-e29b-41d4-a716-446655440100";
const temporaryDirectories: string[] = [];

function run(id: string, startedAt = now): SourceRunRecord {
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

function acceptedObservation(
  runId: string,
  rawHash = "a".repeat(64),
  title = "Senior Platform Engineer",
): PersistSourceObservationInput {
  return {
    runId,
    evidence: {
      sourceKey: "jobicy",
      partition: "default",
      externalId: "jobicy-100",
      originalUrl: "https://jobicy.example/jobs/100",
      applyUrl: "https://jobicy.example/jobs/100/apply",
      sourceUpdatedAt: "2026-08-29T09:00:00.000Z",
      fetchedAt: now,
      retainedUntil: "2026-09-28T10:00:00.000Z",
      rawHash,
      payload: { id: 100, title },
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
      recordedAt: now,
      organization: {
        id: "org_550e8400-e29b-41d4-a716-446655440100",
        name: "Northstar Systems",
        slug: "northstar-systems-55440100",
        website: "https://northstar.example/",
        description: "A fictional technology organization.",
        createdAt: now,
        updatedAt: now,
      },
      job: {
        id: acceptedJobId,
        organizationId: "org_550e8400-e29b-41d4-a716-446655440100",
        organizationName: "Northstar Systems",
        title,
        summary: "Build a reliable platform for product teams.",
        categories: ["software_engineering"],
        workModel: "remote",
        employmentType: "full_time",
        seniority: "senior",
        locations: ["Europe"],
        skills: ["TypeScript"],
        salary: null,
        source: {
          key: "jobicy",
          label: "Jobicy",
          url: "https://jobicy.example/jobs/100",
        },
        applyMode: "external",
        status: "open",
        publishedAt: "2026-08-28T09:00:00.000Z",
        updatedAt: now,
      },
      sourceLink: {
        originalUrl: "https://jobicy.example/jobs/100",
        applyUrl: "https://jobicy.example/jobs/100/apply",
        identityBasis: "source_id",
      },
    },
  };
}

describe("SQLite connector ingestion repository", () => {
  afterEach(async () => {
    await Promise.all(
      temporaryDirectories
        .splice(0)
        .map((directory) => rm(directory, { recursive: true, force: true })),
    );
  });

  async function create() {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-ingestion-"));
    temporaryDirectories.push(directory);
    return createSqliteStorage(join(directory, "jobbbler.sqlite"));
  }

  it("retains rejected evidence and versions changed accepted listings idempotently", async () => {
    const storage = await create();
    await storage.ingestion.insertRun(run("run_1"));

    const rejected = await storage.ingestion.persistObservation({
      runId: "run_1",
      evidence: {
        ...acceptedObservation("run_1").evidence,
        externalId: "jobicy-invalid",
        rawHash: "0".repeat(64),
        payload: { id: "jobicy-invalid", title: null },
      },
      normalization: {
        accepted: false,
        status: "rejected",
        reason: "invalid_record",
        issues: ["A title is required."],
        normalizerVersion: 1,
        recordedAt: now,
      },
    });
    expect(rejected).toMatchObject({ sourceRecordInserted: true, jobVersionInserted: false });
    await expect(storage.ingestion.getEvidence(rejected.sourceRecordId)).resolves.toMatchObject({
      externalId: "jobicy-invalid",
      payload: { id: "jobicy-invalid", title: null },
      normalization: { status: "rejected", reason: "invalid_record" },
    });
    await expect(
      storage.ingestion.purgeExpiredPayloads("2026-09-27T10:00:00.000Z", 100),
    ).resolves.toBe(0);
    await expect(
      storage.ingestion.purgeExpiredPayloads("2026-09-29T10:00:00.000Z", 100),
    ).resolves.toBe(1);
    await expect(storage.ingestion.getEvidence(rejected.sourceRecordId)).resolves.toMatchObject({
      payload: null,
      rawHash: "0".repeat(64),
      normalization: { status: "rejected" },
    });

    const first = await storage.ingestion.persistObservation(acceptedObservation("run_1"));
    const duplicate = await storage.ingestion.persistObservation(acceptedObservation("run_1"));
    expect(first).toMatchObject({ sourceRecordInserted: true, jobVersionInserted: true });
    expect(duplicate).toMatchObject({ sourceRecordInserted: false, jobVersionInserted: false });

    const changed = await storage.ingestion.persistObservation(
      acceptedObservation("run_1", "b".repeat(64), "Principal Platform Engineer"),
    );
    expect(changed).toMatchObject({ sourceRecordInserted: true, jobVersionInserted: true });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({
      title: "Principal Platform Engineer",
    });

    const versions = await storage.ingestion.listJobVersions(acceptedJobId);
    expect(new Set(versions.map(({ job }) => job.title))).toEqual(
      new Set(["Senior Platform Engineer", "Principal Platform Engineer"]),
    );

    await storage.ingestion.insertRun(run("run_2", later));
    const seenAgain = await storage.ingestion.persistObservation({
      ...acceptedObservation("run_2", "b".repeat(64), "Principal Platform Engineer"),
      evidence: {
        ...acceptedObservation("run_2", "b".repeat(64), "Principal Platform Engineer").evidence,
        fetchedAt: later,
      },
    });
    expect(seenAgain).toMatchObject({
      sourceRecordInserted: false,
      normalizationInserted: false,
      jobVersionInserted: false,
    });

    storage.close();
  });

  it("rejects an ingestion projection that changes a job's application mode", async () => {
    const storage = await create();
    await storage.ingestion.insertRun(run("run_mode_1"));
    await storage.ingestion.persistObservation(acceptedObservation("run_mode_1"));
    await storage.ingestion.insertRun(run("run_mode_2", later));
    const changed = acceptedObservation("run_mode_2", "f".repeat(64));
    if (!changed.normalization.accepted) throw new Error("Expected an accepted fixture.");

    await expect(
      storage.ingestion.persistObservation({
        ...changed,
        evidence: {
          ...changed.evidence,
          sourceUpdatedAt: later,
          fetchedAt: later,
        },
        normalization: {
          ...changed.normalization,
          recordedAt: later,
          job: {
            ...changed.normalization.job,
            applyMode: "internal",
            updatedAt: later,
          },
        },
      }),
    ).rejects.toMatchObject({ code: "CONFLICT" });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({
      applyMode: "external",
      updatedAt: now,
    });
    storage.close();
  });

  it("rejects a stale mode-changing observation and rolls back every ingestion side effect", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-ingestion-stale-mode-"));
    temporaryDirectories.push(directory);
    const filename = join(directory, "jobbbler.sqlite");
    const storage = createSqliteStorage(filename);
    await storage.ingestion.insertRun(run("run_stale_mode_1"));
    const original = acceptedObservation("run_stale_mode_1");
    if (!original.normalization.accepted) throw new Error("Expected an accepted fixture.");
    await storage.ingestion.persistObservation(original);
    await storage.ingestion.insertRun(run("run_stale_mode_2", later));
    const stale = acceptedObservation("run_stale_mode_2", "e".repeat(64), "Stale title");
    if (!stale.normalization.accepted) throw new Error("Expected an accepted fixture.");
    const conflicting = {
      ...stale,
      evidence: {
        ...stale.evidence,
        fetchedAt: later,
        sourceUpdatedAt: "2026-08-28T09:00:00.000Z",
      },
      normalization: {
        ...stale.normalization,
        recordedAt: later,
        organization: {
          ...stale.normalization.organization,
          description: "This stale write must roll back.",
          updatedAt: later,
        },
        job: {
          ...stale.normalization.job,
          applyMode: "internal" as const,
          updatedAt: "2026-08-28T09:00:00.000Z",
        },
      },
    };
    const database = openSqliteDatabase(filename);
    const count = (table: string): number =>
      (
        database.prepare(`SELECT count(*) AS count FROM ${table}`).get() as {
          readonly count: number;
        }
      ).count;
    const tables = [
      "source_records",
      "source_payloads",
      "normalization_results",
      "source_run_records",
      "job_versions",
      "job_source_links",
    ] as const;
    const before = Object.fromEntries(tables.map((table) => [table, count(table)]));

    await expect(storage.ingestion.persistObservation(conflicting)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    expect(Object.fromEntries(tables.map((table) => [table, count(table)]))).toEqual(before);
    const rejectedSourceRecordId = `record_${createHash("sha256")
      .update(`jobicy:default:jobicy-100:${"e".repeat(64)}`)
      .digest("hex")}`;
    await expect(storage.ingestion.getEvidence(rejectedSourceRecordId)).resolves.toBeNull();
    await expect(
      storage.organizations.getById(stale.normalization.organization.id),
    ).resolves.toEqual(original.normalization.organization);
    await expect(storage.ingestion.listJobVersions(acceptedJobId)).resolves.toHaveLength(1);
    await expect(storage.ingestion.listJobSourceLinks(acceptedJobId)).resolves.toEqual([
      expect.objectContaining({ latestRawHash: "a".repeat(64) }),
    ]);
    database.close();
    storage.close();
  });

  it("finishes runs once and protects source-state updates with a version", async () => {
    const storage = await create();
    await storage.ingestion.insertRun(run("run_state"));
    const finished = await storage.ingestion.finishRun({
      ...run("run_state"),
      status: "succeeded",
      completedAt: later,
      complete: true,
      pagesFetched: 1,
      recordsFetched: 4,
      recordsAccepted: 3,
      recordsRejected: 1,
    });
    expect(finished.status).toBe("succeeded");
    await expect(storage.ingestion.finishRun(finished)).rejects.toMatchObject({ code: "CONFLICT" });

    const state: SourceStateInput = {
      sourceKey: "jobicy",
      partition: "default",
      health: "healthy",
      lastAttemptAt: now,
      lastSuccessfulAt: now,
      nextAllowedAt: later,
      consecutiveFailures: 0,
      etag: '"jobicy-v1"',
      lastModified: null,
      policyVersion: 1,
      updatedAt: now,
    };
    const inserted = await storage.ingestion.putSourceState(state, null);
    expect(inserted.version).toBe(1);
    const updated = await storage.ingestion.putSourceState(
      { ...state, health: "degraded", consecutiveFailures: 1, updatedAt: later },
      1,
    );
    expect(updated).toMatchObject({ version: 2, health: "degraded" });
    await expect(storage.ingestion.putSourceState(state, 1)).rejects.toMatchObject({
      code: "CONFLICT",
    });

    storage.close();
  });

  it("changes freshness only after complete runs and reopens a seen-again listing", async () => {
    const storage = await create();
    await storage.ingestion.insertRun(run("run_fresh_1"));
    await storage.ingestion.persistObservation(acceptedObservation("run_fresh_1"));
    await storage.ingestion.finishRun({
      ...run("run_fresh_1"),
      status: "succeeded",
      completedAt: now,
      complete: true,
      pagesFetched: 1,
      recordsFetched: 1,
      recordsAccepted: 1,
    });

    await storage.ingestion.insertRun(run("run_partial", later));
    await storage.ingestion.finishRun({
      ...run("run_partial", later),
      status: "partial",
      completedAt: later,
      complete: false,
      pagesFetched: 1,
    });
    await expect(storage.ingestion.reconcileCompletedRun("run_partial", 2)).resolves.toEqual({
      possiblyClosed: 0,
      closed: 0,
    });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({ status: "open" });

    await storage.ingestion.insertRun(run("run_not_modified", "2026-08-30T08:00:00.000Z"));
    await storage.ingestion.finishRun({
      ...run("run_not_modified", "2026-08-30T08:00:00.000Z"),
      status: "succeeded",
      completedAt: "2026-08-30T08:00:00.000Z",
      complete: true,
      notModified: true,
      pagesFetched: 1,
    });
    await expect(storage.ingestion.reconcileCompletedRun("run_not_modified", 2)).resolves.toEqual({
      possiblyClosed: 0,
      closed: 0,
    });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({ status: "open" });

    await storage.ingestion.insertRun(run("run_fresh_2", "2026-08-30T10:00:00.000Z"));
    await storage.ingestion.finishRun({
      ...run("run_fresh_2", "2026-08-30T10:00:00.000Z"),
      status: "succeeded",
      completedAt: "2026-08-30T10:00:00.000Z",
      complete: true,
      pagesFetched: 1,
    });
    await expect(storage.ingestion.reconcileCompletedRun("run_fresh_2", 2)).resolves.toEqual({
      possiblyClosed: 1,
      closed: 0,
    });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({ status: "stale" });

    await storage.ingestion.insertRun(run("run_fresh_3", "2026-08-31T10:00:00.000Z"));
    await storage.ingestion.finishRun({
      ...run("run_fresh_3", "2026-08-31T10:00:00.000Z"),
      status: "succeeded",
      completedAt: "2026-08-31T10:00:00.000Z",
      complete: true,
      pagesFetched: 1,
    });
    await expect(storage.ingestion.reconcileCompletedRun("run_fresh_3", 2)).resolves.toEqual({
      possiblyClosed: 0,
      closed: 1,
    });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({ status: "closed" });

    await storage.ingestion.insertRun(run("run_fresh_4", "2026-09-01T10:00:00.000Z"));
    const reappeared = acceptedObservation("run_fresh_4");
    await storage.ingestion.persistObservation({
      ...reappeared,
      evidence: { ...reappeared.evidence, fetchedAt: "2026-09-01T10:00:00.000Z" },
    });
    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({ status: "open" });
    await expect(storage.ingestion.listJobSourceLinks(acceptedJobId)).resolves.toEqual([
      expect.objectContaining({
        status: "active",
        missingCompleteRuns: 0,
        attributionLabel: "Jobicy",
        attributionRequired: true,
        followedLinkRequired: false,
      }),
    ]);
    storage.close();
  });

  it("keeps a delayed older observation in history without regressing the current job", async () => {
    const storage = await create();
    await storage.ingestion.insertRun(run("run_ordering"));
    const original = acceptedObservation("run_ordering");
    if (!original.normalization.accepted) throw new Error("Expected an accepted fixture.");
    await storage.ingestion.persistObservation(original);

    const newest = acceptedObservation(
      "run_ordering",
      "f".repeat(64),
      "Principal Platform Engineer",
    );
    if (!newest.normalization.accepted) throw new Error("Expected an accepted fixture.");
    await storage.ingestion.persistObservation({
      ...newest,
      evidence: {
        ...newest.evidence,
        sourceUpdatedAt: "2026-08-30T09:00:00.000Z",
      },
      normalization: {
        ...newest.normalization,
        job: { ...newest.normalization.job, updatedAt: "2026-08-30T09:00:00.000Z" },
      },
    });

    const delayed = acceptedObservation("run_ordering", "1".repeat(64), "Junior Engineer");
    if (!delayed.normalization.accepted) throw new Error("Expected an accepted fixture.");
    await storage.ingestion.persistObservation({
      ...delayed,
      evidence: {
        ...delayed.evidence,
        fetchedAt: "2026-09-01T10:00:00.000Z",
        sourceUpdatedAt: "2026-08-28T09:00:00.000Z",
      },
      normalization: {
        ...delayed.normalization,
        recordedAt: "2026-09-01T10:00:00.000Z",
        job: { ...delayed.normalization.job, updatedAt: "2026-08-28T09:00:00.000Z" },
      },
    });

    await expect(storage.jobs.getById(acceptedJobId)).resolves.toMatchObject({
      title: "Principal Platform Engineer",
      updatedAt: "2026-08-30T09:00:00.000Z",
    });
    await expect(storage.ingestion.listJobVersions(acceptedJobId)).resolves.toHaveLength(3);
    await expect(storage.ingestion.listJobSourceLinks(acceptedJobId)).resolves.toEqual([
      expect.objectContaining({
        lastSeenAt: "2026-09-01T10:00:00.000Z",
        latestSourceUpdatedAt: "2026-08-30T09:00:00.000Z",
        latestRawHash: "f".repeat(64),
      }),
    ]);
    storage.close();
  });
});
