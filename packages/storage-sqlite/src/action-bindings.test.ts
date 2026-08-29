import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteDatabase } from "./connection.js";
import { migrateSqlite } from "./migrate.js";

const timestamp = "2026-08-29T10:00:00.000Z";

describe("application action relational bindings", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("rejects cross-owner, cross-draft review and confirmation substitution", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-action-bindings-"));
    const database = openSqliteDatabase(join(directory, "actions.sqlite"));
    migrateSqlite(database);

    const insertOwner = database.prepare(
      `INSERT INTO owners(id, kind, verified, version, created_at, updated_at)
       VALUES (?, 'guest', 1, 1, ?, ?)`,
    );
    insertOwner.run("owner_1", timestamp, timestamp);
    insertOwner.run("owner_2", timestamp, timestamp);
    database
      .prepare(
        `INSERT INTO organizations(id, name, slug, website, description, created_at, updated_at)
         VALUES ('org_1', 'Demo One', 'demo-one', NULL, 'Fictional.', ?, ?)`,
      )
      .run(timestamp, timestamp);

    const insertJob = database.prepare(
      `INSERT INTO jobs(
         id, organization_id, organization_name, title, summary, categories_json,
         work_model, employment_type, seniority, locations_json, skills_json,
         salary_minimum, salary_maximum, salary_currency, salary_period,
         source_key, source_label, source_url, apply_mode, status, published_at, updated_at
       ) VALUES (
         ?, 'org_1', 'Demo One', ?, 'Fictional role.', '["software_engineering"]',
         'remote', 'full_time', 'senior', '["Europe"]', '["TypeScript"]',
         NULL, NULL, NULL, NULL, 'jobbbler_demo', 'Jobbbler demo', NULL,
         'internal', 'open', ?, ?
       )`,
    );
    insertJob.run("job_1", "Role One", timestamp, timestamp);
    insertJob.run("job_2", "Role Two", timestamp, timestamp);

    const insertDraft = database.prepare(
      `INSERT INTO application_drafts(
         id, owner_id, job_id, state, version, answers_json, created_at, updated_at
       ) VALUES (?, ?, ?, 'reviewed', 1, '[]', ?, ?)`,
    );
    insertDraft.run("draft_1", "owner_1", "job_1", timestamp, timestamp);
    insertDraft.run("draft_2", "owner_2", "job_2", timestamp, timestamp);

    const insertReview = database.prepare(
      `INSERT INTO application_reviews(
         id, draft_id, draft_version, payload_hash, findings_json, created_at
       ) VALUES (?, ?, 1, ?, '[]', ?)`,
    );
    insertReview.run("review_1", "draft_1", "a".repeat(64), timestamp);
    insertReview.run("review_2", "draft_2", "b".repeat(64), timestamp);

    const insertConfirmation = database.prepare(
      `INSERT INTO action_confirmations(
         id, owner_id, draft_id, review_id, payload_hash, status,
         expires_at, confirmed_at, created_at, updated_at
       ) VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?, ?)`,
    );
    expect(() =>
      insertConfirmation.run(
        "confirmation_bad",
        "owner_1",
        "draft_1",
        "review_2",
        "b".repeat(64),
        "2026-08-29T11:00:00.000Z",
        timestamp,
        timestamp,
        timestamp,
      ),
    ).toThrow();

    insertConfirmation.run(
      "confirmation_1",
      "owner_1",
      "draft_1",
      "review_1",
      "a".repeat(64),
      "2026-08-29T11:00:00.000Z",
      timestamp,
      timestamp,
      timestamp,
    );
    expect(() =>
      database
        .prepare(
          `INSERT INTO application_submissions(
             id, draft_id, review_id, confirmation_id, idempotency_scope,
             idempotency_key, status, provider_receipt, safe_result_json,
             created_at, updated_at
           ) VALUES (
             'submission_bad', 'draft_2', 'review_2', 'confirmation_1',
             'application.submit', 'key-1', 'submitted', NULL, '{}', ?, ?
           )`,
        )
        .run(timestamp, timestamp),
    ).toThrow();

    expect(
      database
        .prepare(
          `INSERT INTO application_submissions(
             id, draft_id, review_id, confirmation_id, idempotency_scope,
             idempotency_key, status, provider_receipt, safe_result_json,
             created_at, updated_at
           ) VALUES (
             'submission_1', 'draft_1', 'review_1', 'confirmation_1',
             'application.submit', 'key-2', 'submitted', 'demo-receipt', '{}', ?, ?
           )`,
        )
        .run(timestamp, timestamp).changes,
    ).toBe(1);

    database.close();
  });
});
