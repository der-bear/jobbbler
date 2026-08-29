import { describe, expect, it } from "vitest";

import { postgresMigrationManifest } from "./index.js";

describe("PostgreSQL migration manifest", () => {
  it("contains sequential checksummed migrations including authorization bindings", () => {
    const migrations = postgresMigrationManifest();
    expect(migrations.map((migration) => migration.version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
    expect(migrations.at(-1)?.name).toBe("owner_recovery_privacy");
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
});
