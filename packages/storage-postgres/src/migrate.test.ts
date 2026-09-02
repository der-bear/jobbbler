import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { postgresMigrationManifest, resolvePostgresMigrationDirectory } from "./index.js";

describe("PostgreSQL migration manifest", () => {
  it("finds traced migration files from a Vercel monorepo function working directory", () => {
    const root = mkdtempSync(join(tmpdir(), "jobbbler-migrations-"));
    try {
      const webDirectory = join(root, "apps", "web");
      const migrationDirectory = join(root, "migrations", "postgres");
      mkdirSync(webDirectory, { recursive: true });
      mkdirSync(migrationDirectory, { recursive: true });

      expect(
        resolvePostgresMigrationDirectory(
          "file:///var/task/apps/web/.next/server/chunks/runtime.js",
          webDirectory,
        ),
      ).toBe(migrationDirectory);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("contains sequential checksummed migrations including authorization bindings", () => {
    const migrations = postgresMigrationManifest();
    const versions = migrations.map((migration) => migration.version);
    expect(versions).toEqual(Array.from({ length: versions.at(-1) ?? 0 }, (_, index) => index + 1));
    expect(migrations.find((migration) => migration.version === 14)?.name).toBe(
      "job_search_parity",
    );
    expect(migrations.every((migration) => /^[a-f0-9]{64}$/.test(migration.checksum))).toBe(true);
  });

  it("declares PostgreSQL-native search and deny-by-default RLS", () => {
    const sql = postgresMigrationManifest()
      .map((migration) => migration.sql)
      .join("\n");

    expect(sql).toContain("tsvector");
    expect(sql).toContain("ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("REVOKE ALL ON ALL TABLES");
  });

  it("maintains a typed open-job projection with bounded-sort indexes", () => {
    const sql = postgresMigrationManifest()
      .map((migration) => migration.sql)
      .join("\n");

    expect(sql).toContain("ADD COLUMN body jsonb");
    expect(sql).toContain("job_search_documents_open_newest_idx");
    expect(sql).toContain("job_search_documents_open_salary_idx");
    expect(sql).toContain("job_search_documents_open_work_model_idx");
    expect(sql).toContain("job_search_documents_open_seniority_idx");
    expect(sql).toContain("job_search_documents_open_categories_idx");
    expect(sql).toContain("published_at_ms");
  });

  it("gates the transactional search-index replacement to an empty catalog", () => {
    const parity = postgresMigrationManifest().find((migration) => migration.version === 14);

    expect(parity?.sql).toContain("requires an empty job catalog");
    expect(parity?.sql).toContain("ERRCODE = '55000'");
    expect(parity?.sql).not.toContain("UPDATE jobbbler.job_search_documents");
  });

  it("indexes agent-session tokens and authorization lookups without storing bearer tokens", () => {
    const sql = postgresMigrationManifest()
      .map((migration) => migration.sql)
      .join("\n");

    expect(sql).toContain("entity_records_agent_session_token_unique");
    expect(sql).toContain("entity_records_delegation_active_match_idx");
    expect(sql).toContain("entity_records_rich_data_grant_current_idx");
    expect(sql).not.toContain("bearer_token");
  });

  it("keeps realtime activity in an owner-scoped redacted table with deny-by-default RLS", () => {
    const sql = postgresMigrationManifest()
      .map((migration) => migration.sql)
      .join("\n");

    expect(sql).toContain("CREATE TABLE jobbbler.owner_activity_events");
    expect(sql).toContain("owner_activity_events_owner_sequence_idx");
    expect(sql).toContain("owner_activity_events_owner_only");
    expect(sql).toContain("ALTER TABLE jobbbler.owner_activity_events ENABLE ROW LEVEL SECURITY");
    expect(sql).toContain("jobbbler_owner_activity_wakeup_read");
    expect(sql).toContain("jobbbler_owner_id");
    expect(sql).toContain("realtime.send('{}'::jsonb, 'changed'");
    expect(sql).toContain("owner_activity_events_after_insert_wakeup");
    expect(sql).not.toContain("raw_source");
    expect(sql).not.toContain("token_value");
  });

  it("indexes only hashed recovery material and live owner-bound deletion intents", () => {
    const sql = postgresMigrationManifest()
      .map((migration) => migration.sql)
      .join("\n");

    expect(sql).toContain("entity_records_verified_endpoint_address_unique");
    expect(sql).toContain("entity_records_owner_recovery_token_unique");
    expect(sql).toContain("entity_records_owner_recovery_live_idx");
    expect(sql).toContain("entity_records_owner_deletion_intent_live_idx");
    expect(sql).toContain("entity_records_session_token_unique");
    expect(sql).not.toContain("rawRecoveryCode");
    expect(sql).not.toContain("rawSessionToken");
  });

  it("hardens Supabase advisor findings without broadening public access", () => {
    const migration = postgresMigrationManifest().find(({ version }) => version === 17);

    expect(migration?.name).toBe("supabase_advisor_hardening");
    expect(migration?.sql).toContain("ALTER FUNCTION jobbbler.current_owner_id()");
    expect(migration?.sql).toContain("SET search_path = ''");
    expect(migration?.sql).toContain("(SELECT auth.jwt())");
    expect(migration?.sql).toContain("TO anon");
    expect(migration?.sql).toContain("TO authenticated");
  });

  it("reconciles only synthetic demo openings as first-party application roles", () => {
    const migration = postgresMigrationManifest().find(({ version }) => version === 18);

    expect(migration?.name).toBe("internal_demo_catalog");
    expect(migration?.sql).toContain("body #>> '{source,key}' = 'jobbbler_demo'");
    expect(migration?.sql).toContain("'{applyMode}'");
    expect(migration?.sql).toContain("'\"internal\"'::jsonb");
  });

  it("uniquely indexes durable managed-delivery acknowledgements", () => {
    const migration = postgresMigrationManifest().find(({ version }) => version === 19);

    expect(migration?.name).toBe("managed_application_delivery");
    expect(migration?.sql).toContain("entity_records_managed_delivery_provider_reference_unique");
    expect(migration?.sql).toContain("entity_records_managed_delivery_idempotency_unique");
    expect(migration?.sql).toContain("entity_records_managed_delivery_confirmation_unique");
    expect(migration?.sql).toContain("entity_records_application_receipt_delivery_unique");
    expect(migration?.sql).toContain("entity_records_application_receipt_confirmation_unique");
    expect(migration?.sql).toContain("kind = 'managed_application_delivery'");
    expect(migration?.sql).toContain("enforce_application_receipt_managed_delivery");
    expect(migration?.sql).toContain("CREATE CONSTRAINT TRIGGER");
    expect(migration?.sql).toContain("DEFERRABLE INITIALLY DEFERRED");
    expect(migration?.sql).toContain("delivery.body->'fields' = NEW.body #> '{submission,fields}'");
  });
});
