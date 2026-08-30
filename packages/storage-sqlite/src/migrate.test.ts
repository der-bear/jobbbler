import { afterEach, describe, expect, it } from "vitest";
import { copyFile, mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openSqliteDatabase } from "./connection.js";
import {
  defaultMigrationDirectory,
  migrateSqlite,
  verifySqliteMigrationJournal,
} from "./migrate.js";

describe("migrateSqlite", () => {
  let directory: string | undefined;

  afterEach(async () => {
    if (directory !== undefined) await rm(directory, { recursive: true, force: true });
  });

  it("applies every migration once", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-migrations-"));
    const database = openSqliteDatabase(join(directory, "migrations.sqlite"));

    const applied = migrateSqlite(database);
    expect(applied).toContainEqual(
      expect.objectContaining({ version: 21, name: "job_search_document" }),
    );
    expect(applied).toContainEqual(
      expect.objectContaining({ version: 24, name: "managed_application_delivery" }),
    );
    expect(migrateSqlite(database)).toEqual([]);
    expect(database.prepare("SELECT count(*) AS count FROM schema_migrations").get()).toEqual({
      count: applied.length,
    });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='table' AND name='managed_application_deliveries'",
        )
        .get(),
    ).toEqual({ name: "managed_application_deliveries" });
    expect(
      database
        .prepare(
          "SELECT name FROM sqlite_master WHERE type='trigger' AND name='application_receipts_require_managed_delivery'",
        )
        .get(),
    ).toEqual({ name: "application_receipts_require_managed_delivery" });

    database.close();
  });

  it("rejects migration journal drift", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-migration-drift-"));
    const database = openSqliteDatabase(join(directory, "drift.sqlite"));
    migrateSqlite(database);
    database
      .prepare("UPDATE schema_migrations SET checksum = ? WHERE version = 3")
      .run("0".repeat(64));

    expect(() => migrateSqlite(database)).toThrowError(
      expect.objectContaining({ code: "CONFLICT" }),
    );

    database.close();
  });

  it("upgrades a v23 database without inventing receipt facts and freezes the v24 checksum", async () => {
    directory = await mkdtemp(join(tmpdir(), "jobbbler-v23-upgrade-"));
    const v23Directory = join(directory, "v23");
    await mkdir(v23Directory);
    const sourceDirectory = defaultMigrationDirectory();
    for (const filename of await readdir(sourceDirectory)) {
      if (/^\d{4}_[a-z0-9_]+\.sql$/u.test(filename) && Number(filename.slice(0, 4)) <= 23) {
        await copyFile(join(sourceDirectory, filename), join(v23Directory, filename));
      }
    }

    const database = openSqliteDatabase(join(directory, "upgrade.sqlite"));
    expect(migrateSqlite(database, { directory: v23Directory }).at(-1)).toMatchObject({
      version: 23,
    });
    database.exec(`
      INSERT INTO owners(id,kind,verified,version,created_at,updated_at)
      VALUES('owner_upgrade','guest',1,0,'2026-08-29T10:00:00.000Z','2026-08-29T10:00:00.000Z');
      INSERT INTO organizations(id,name,slug,website,description,created_at,updated_at)
      VALUES('org_upgrade','Upgrade Org','upgrade-org',NULL,'Fixture','2026-08-29T10:00:00.000Z','2026-08-29T10:00:00.000Z');
      INSERT INTO jobs(
        id,organization_id,organization_name,title,summary,categories_json,work_model,
        employment_type,seniority,locations_json,skills_json,source_key,source_label,source_url,
        apply_mode,status,published_at,updated_at
      ) VALUES(
        'job_upgrade','org_upgrade','Upgrade Org','Engineer','Fixture','[]','remote',
        'full_time','senior','[]','[]','jobbbler_demo','Jobbbler demo',NULL,'internal','open',
        '2026-08-29T10:00:00.000Z','2026-08-29T10:00:00.000Z'
      );
      INSERT INTO application_drafts(
        id,owner_id,job_id,state,version,answers_json,created_at,updated_at
      ) VALUES(
        'draft_upgrade','owner_upgrade','job_upgrade','submitted',2,'[]',
        '2026-08-29T10:00:00.000Z','2026-08-29T10:00:00.000Z'
      );
      INSERT INTO application_review_records(
        id,owner_id,draft_id,draft_version,payload_hash,findings_json,status,created_at,invalidated_at
      ) VALUES(
        'review_upgrade','owner_upgrade','draft_upgrade',1,'payload','[]','active',
        '2026-08-29T10:00:00.000Z',NULL
      );
      INSERT INTO application_confirmation_records(
        id,owner_id,draft_id,review_id,payload_hash,confirmation_hash,status,expires_at,created_at,
        consumed_at
      ) VALUES(
        'confirmation_upgrade','owner_upgrade','draft_upgrade','review_upgrade','payload','hash',
        'consumed','2026-08-29T11:00:00.000Z','2026-08-29T10:00:00.000Z',
        '2026-08-29T10:00:00.000Z'
      );
      INSERT INTO application_submission_receipts(
        id,owner_id,draft_id,review_id,confirmation_id,idempotency_key,status,external_url,created_at
      ) VALUES(
        'receipt_upgrade','owner_upgrade','draft_upgrade','review_upgrade','confirmation_upgrade',
        'legacy-once','submitted',NULL,'2026-08-29T10:00:00.000Z'
      );
    `);

    expect(migrateSqlite(database)).toEqual([
      expect.objectContaining({ version: 24, name: "managed_application_delivery" }),
    ]);
    expect(() => verifySqliteMigrationJournal(database)).not.toThrow();
    expect(
      database
        .prepare("SELECT submission_json AS submission FROM application_submission_receipts")
        .get(),
    ).toEqual({ submission: null });
    expect(migrateSqlite(database)).toEqual([]);
    database.close();
  });
});
