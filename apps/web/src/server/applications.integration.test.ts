import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import type { Job } from "@jobbbler/contracts";
import { createSqliteStorage } from "@jobbbler/storage-sqlite";

import { createApplicationDataGrantAuthorizationPolicy } from "./application-authorization";
import { applicationDataGrantScope, applicationReviewPayloadHash } from "./application-policy";
import { createApplicationRouteDependencies } from "./applications";

const now = "2026-08-29T10:00:00.000Z";
const future = "2026-08-29T11:00:00.000Z";
const ownerId = "owner_81000000-0000-7000-8000-000000000001";
const organizationId = "org_81000000-0000-7000-8000-000000000001";
const jobId = "job_81000000-0000-7000-8000-000000000001";
const temporaryDirectories: string[] = [];

async function fixture() {
  const directory = await mkdtemp(join(tmpdir(), "jobbbler-application-web-"));
  temporaryDirectories.push(directory);
  const storage = createSqliteStorage(join(directory, "jobbbler.sqlite"));
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
    name: "Northstar Systems",
    slug: "northstar-systems",
    website: "https://example.com",
    description: "A fictional organization used for application integration tests.",
    createdAt: now,
    updatedAt: now,
  });
  const job: Job = {
    id: jobId,
    organizationId,
    organizationName: "Northstar Systems",
    title: "Senior Product Engineer",
    summary: "Build calm, trustworthy developer workflows.",
    categories: ["software_engineering"],
    workModel: "remote",
    employmentType: "full_time",
    seniority: "senior",
    locations: ["Europe"],
    skills: ["TypeScript", "React"],
    salary: null,
    source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
    applyMode: "internal",
    status: "open",
    publishedAt: now,
    updatedAt: now,
  };
  await storage.jobs.upsert(job);
  return {
    storage,
    job,
    operations: createApplicationRouteDependencies(storage, {} as never).operations,
  };
}

function externalVersion(job: Job): Job {
  return {
    ...job,
    applyMode: "external",
    source: {
      key: "external_source",
      label: "External source",
      url: "https://jobs.example.test/opening/42",
    },
  };
}

async function legacyExternalSubmissionFixture() {
  const current = await fixture();
  const externalJob = {
    ...externalVersion(current.job),
    id: "job_81000000-0000-7000-8000-000000000099",
  };
  await current.storage.jobs.upsert(externalJob);
  const reviewed = await current.storage.applications.insert({
    id: "application_81000000-0000-7000-8000-000000000099",
    ownerId,
    jobId: externalJob.id,
    state: "reviewed",
    version: 2,
    answers: [
      {
        fieldKey: "full_name",
        value: "Alex Morgan",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
    ],
    createdAt: now,
    updatedAt: now,
  });
  const review = {
    id: "review_81000000-0000-7000-8000-000000000099",
    ownerId,
    draftId: reviewed.id,
    draftVersion: reviewed.version,
    payloadHash: applicationReviewPayloadHash(reviewed, externalJob),
    findings: [],
    status: "active" as const,
    createdAt: now,
    invalidatedAt: null,
  };
  await current.storage.applications.insertReview(review);
  const scope = applicationDataGrantScope({ draft: reviewed, review, job: externalJob });
  const grant = await current.storage.richDataGrants.insert(
    {
      id: "grant_81000000-0000-7000-8000-000000000099",
      ownerId,
      draftId: reviewed.id,
      ...scope,
      status: "active",
      expiresAt: future,
      createdAt: now,
      approvedAt: now,
      withdrawnAt: null,
      version: 0,
    },
    now,
  );
  const confirmation = {
    id: "confirmation_81000000-0000-7000-8000-000000000099",
    ownerId,
    draftId: reviewed.id,
    reviewId: review.id,
    payloadHash: review.payloadHash,
    confirmationHash: "e".repeat(64),
    status: "active" as const,
    expiresAt: future,
    createdAt: now,
    consumedAt: null,
  };
  await current.storage.applications.insertConfirmation(confirmation);
  return { ...current, reviewed, review, grant, confirmation };
}

async function legacyExternalDraftFixture() {
  const current = await fixture();
  const externalJob = {
    ...externalVersion(current.job),
    id: "job_81000000-0000-7000-8000-000000000097",
  };
  await current.storage.jobs.upsert(externalJob);
  const draft = await current.storage.applications.insert({
    id: "application_81000000-0000-7000-8000-000000000097",
    ownerId,
    jobId: externalJob.id,
    state: "draft",
    version: 0,
    answers: [],
    createdAt: now,
    updatedAt: now,
  });
  return { ...current, externalJob, draft };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("application operations with SQLite", () => {
  it("applies an agent answer batch atomically and rejects the whole invalid batch", async () => {
    const { storage, operations } = await fixture();
    const draft = (await operations.start(ownerId, { jobId }, now)).draft;
    const answer = {
      fieldKey: "full_name",
      value: "Alex Morgan",
      provenance: "user_entered" as const,
      sensitive: true,
      acceptedByHuman: true,
    };

    await expect(
      operations.answer(
        { kind: "agent", ownerId },
        draft.id,
        { expectedVersion: 0, answers: [answer, answer] },
        now,
      ),
    ).rejects.toBeDefined();
    await expect(storage.applications.getByOwner(draft.id, ownerId)).resolves.toMatchObject({
      version: 0,
      answers: [],
    });

    const updated = await operations.answer(
      { kind: "agent", ownerId },
      draft.id,
      {
        expectedVersion: 0,
        answers: [answer, { ...answer, fieldKey: "email", value: "alex.morgan@example.com" }],
      },
      now,
    );
    expect(updated.version).toBe(1);
    expect(updated.answers).toEqual([
      expect.objectContaining({
        fieldKey: "email",
        provenance: "agent_suggestion",
        acceptedByHuman: false,
      }),
      expect.objectContaining({
        fieldKey: "full_name",
        provenance: "agent_suggestion",
        acceptedByHuman: false,
      }),
    ]);
  });

  it("completes the internal journey with exact permission and an atomic receipt", async () => {
    const { storage, job, operations } = await fixture();
    let draft = (await operations.start(ownerId, { jobId }, now)).draft;
    const answers = [
      ["full_name", "Alex Morgan", true],
      ["email", "alex.morgan@example.com", true],
      ["location", "Kyiv, Ukraine", true],
      ["motivation", "I build calm, accessible product workflows.", false],
      ["work_authorization", "Authorized to work in the European Union", true],
    ] as const;
    for (const [fieldKey, value, sensitive] of answers) {
      draft = await operations.answer(
        { kind: "human", ownerId },
        draft.id,
        {
          expectedVersion: draft.version,
          answer: {
            fieldKey,
            value,
            provenance: "user_entered",
            sensitive,
            acceptedByHuman: true,
          },
        },
        now,
      );
    }

    draft = await operations.validate({ kind: "human", ownerId }, draft.id, now);
    expect(draft.state).toBe("valid");
    const reviewSummary = await operations.review(
      { kind: "human", ownerId },
      draft.id,
      { expectedVersion: draft.version },
      now,
    );
    const reviewedDraft = await storage.applications.getByOwner(draft.id, ownerId);
    const review = await storage.applications.getReview(reviewSummary.id, ownerId);
    if (reviewedDraft === null || review === null)
      throw new Error("Missing sealed review fixture.");
    const scope = applicationDataGrantScope({ draft: reviewedDraft, review, job });
    const requested = await storage.richDataGrants.insert(
      {
        id: "grant_81000000-0000-7000-8000-000000000001",
        ownerId,
        draftId: draft.id,
        ...scope,
        status: "requested",
        expiresAt: future,
        createdAt: now,
        approvedAt: null,
        withdrawnAt: null,
        version: 0,
      },
      now,
    );
    const approvalGuard =
      await createApplicationDataGrantAuthorizationPolicy(storage).assertStoredDataGrantCurrent(
        requested,
      );
    const grant = await storage.richDataGrants.approveCurrent({
      id: requested.id,
      ownerId,
      draftId: draft.id,
      at: now,
      ...approvalGuard,
    });
    expect(grant).toMatchObject({ status: "active", version: 1 });

    const confirmationHash = "c".repeat(64);
    const confirmation = await operations.requestConfirmation(
      ownerId,
      draft.id,
      review.id,
      confirmationHash,
      now,
    );
    const receipt = await operations.submit(
      { kind: "human", ownerId },
      draft.id,
      {
        reviewId: review.id,
        confirmationId: confirmation.id,
        idempotencyKey: "550e8400-e29b-41d4-a716-446655440000",
      },
      confirmationHash,
      now,
    );
    expect(receipt).toMatchObject({ status: "submitted", externalUrl: null });

    const workspace = await operations.get(ownerId, draft.id, now);
    expect(workspace.job).toEqual(job);
    expect(workspace.draft).toMatchObject({
      state: "submitted",
      version: reviewedDraft.version + 1,
    });
    expect(workspace.receipt).toEqual(receipt);
    expect(JSON.stringify(workspace)).not.toContain(confirmationHash);
  });

  it("stores agent-provided values only as unaccepted suggestions", async () => {
    const { operations } = await fixture();
    const draft = (await operations.start(ownerId, { jobId }, now)).draft;
    const suggested = await operations.answer(
      { kind: "agent", ownerId },
      draft.id,
      {
        expectedVersion: draft.version,
        answer: {
          fieldKey: "motivation",
          value: "A polished suggestion.",
          provenance: "user_entered",
          sensitive: false,
          acceptedByHuman: true,
        },
      },
      now,
    );
    expect(suggested.answers[0]).toMatchObject({
      provenance: "agent_suggestion",
      acceptedByHuman: false,
    });
    await expect(
      operations.validate({ kind: "agent", ownerId }, draft.id, now),
    ).rejects.toMatchObject({ code: "VALIDATION" });
  });

  it("keeps external roles out of the internal application state machine", async () => {
    const { storage, job, operations } = await fixture();
    const externalJob: Job = {
      ...externalVersion(job),
      id: "job_81000000-0000-7000-8000-000000000002",
    };
    await storage.jobs.upsert(externalJob);

    await expect(operations.start(ownerId, { jobId: externalJob.id }, now)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
  });

  it("never reopens a legacy draft after its role becomes external", async () => {
    const { storage, operations, externalJob, draft } = await legacyExternalDraftFixture();

    await expect(operations.start(ownerId, { jobId: externalJob.id }, now)).rejects.toMatchObject({
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    });
    await expect(storage.applications.getByOwner(draft.id, ownerId)).resolves.toEqual(draft);
  });

  it("reopens an existing internal draft after its listing closes", async () => {
    const { storage, job, operations } = await fixture();
    const existing = (await operations.start(ownerId, { jobId }, now)).draft;
    await storage.jobs.upsert({ ...job, status: "closed", updatedAt: future });

    await expect(operations.start(ownerId, { jobId }, future)).resolves.toEqual({
      draft: existing,
      disposition: "reopened",
    });
  });

  it("does not let an apply-mode flip race an application mutation", async () => {
    const { storage, job, operations } = await fixture();
    const existing = (await operations.start(ownerId, { jobId }, now)).draft;

    const [flip, mutation] = await Promise.allSettled([
      storage.jobs.upsert(externalVersion(job)),
      operations.answer(
        { kind: "human", ownerId },
        existing.id,
        {
          expectedVersion: existing.version,
          answer: {
            fieldKey: "full_name",
            value: "Alex Morgan",
            provenance: "user_entered",
            sensitive: true,
            acceptedByHuman: true,
          },
        },
        now,
      ),
    ]);

    expect(flip).toMatchObject({ status: "rejected", reason: { code: "CONFLICT" } });
    expect(mutation).toMatchObject({ status: "fulfilled", value: { version: 1 } });
    await expect(storage.jobs.getById(jobId)).resolves.toMatchObject({ applyMode: "internal" });
  });

  it("rejects every preparation mutation for a readable legacy external draft", async () => {
    const { storage, operations, draft: existing } = await legacyExternalDraftFixture();
    const rejection = {
      code: "CONFLICT",
      message: "This role accepts applications on the employer's website.",
    };
    const commands = [
      () =>
        operations.answer(
          { kind: "human", ownerId },
          existing.id,
          {
            expectedVersion: existing.version,
            answer: {
              fieldKey: "full_name",
              value: "Alex Morgan",
              provenance: "user_entered",
              sensitive: true,
              acceptedByHuman: true,
            },
          },
          now,
        ),
      () => operations.validate({ kind: "human", ownerId }, existing.id, now),
      () =>
        operations.review(
          { kind: "human", ownerId },
          existing.id,
          { expectedVersion: existing.version },
          now,
        ),
      () =>
        operations.requestConfirmation(
          ownerId,
          existing.id,
          "review_81000000-0000-7000-8000-000000000098",
          "d".repeat(64),
          now,
        ),
      () =>
        operations.submit(
          { kind: "human", ownerId },
          existing.id,
          {
            reviewId: "review_81000000-0000-7000-8000-000000000098",
            confirmationId: "confirmation_81000000-0000-7000-8000-000000000098",
            idempotencyKey: "550e8400-e29b-41d4-a716-446655440098",
          },
          "d".repeat(64),
          now,
        ),
    ];

    for (const command of commands) {
      await expect(command()).rejects.toMatchObject(rejection);
      await expect(storage.applications.getByOwner(existing.id, ownerId)).resolves.toEqual(
        existing,
      );
    }
  });

  it.each(["human", "agent"] as const)(
    "rejects %s external finalization without consuming confirmation or grant state",
    async (kind) => {
      const { storage, operations, reviewed, review, grant, confirmation } =
        await legacyExternalSubmissionFixture();

      await expect(
        operations.submit(
          { kind, ownerId },
          reviewed.id,
          {
            reviewId: review.id,
            confirmationId: confirmation.id,
            idempotencyKey: "550e8400-e29b-41d4-a716-446655440099",
          },
          confirmation.confirmationHash,
          now,
        ),
      ).rejects.toMatchObject({
        code: "CONFLICT",
        message: "This role accepts applications on the employer's website.",
      });
      await expect(
        storage.applications.getConfirmation(confirmation.id, ownerId),
      ).resolves.toMatchObject({ status: "active", consumedAt: null });
      await expect(
        storage.richDataGrants.getById(grant.id, ownerId, reviewed.id),
      ).resolves.toMatchObject({ status: "active" });
      await expect(storage.applications.getLatestReceipt(reviewed.id, ownerId)).resolves.toBeNull();
      await expect(storage.applications.getByOwner(reviewed.id, ownerId)).resolves.toMatchObject({
        state: "reviewed",
        version: reviewed.version,
      });
    },
  );
});
