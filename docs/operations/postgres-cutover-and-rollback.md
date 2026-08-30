# PostgreSQL migration rehearsal and rollback

1. Put web and worker into maintenance mode and confirm no SQLite writer remains.
2. Run `pnpm db:export-sqlite <sqlite-path> <snapshot.ndjson>`; preserve the safe manifest and checksum printed by the command. Format 2 binds the schema version, table classification, per-table counts, and canonical rows to one checksum. SQLite journals, virtual tables, and FTS shadow tables are never exported.
3. Confirm every staged-only table in the manifest has a zero count. The superseded tables are `agent_sessions`, `agent_delegations`, `data_grants`, `outbox_events`, `search_runs`, `search_deltas`, `application_reviews`, `action_confirmations`, and `application_submissions`. They remain classified for forensic compatibility, but a non-empty table blocks automated cutover because it has no lossless current Storage mapping.
4. With deployment credentials, ensure the Supabase-compatible RLS roles exist before applying migrations. Supabase already provides them; a disposable vanilla PostgreSQL rehearsal needs the following idempotent preflight:

   ```sql
   DO $$
   BEGIN
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
       CREATE ROLE anon NOLOGIN;
     END IF;
     IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'authenticated') THEN
       CREATE ROLE authenticated NOLOGIN;
     END IF;
   END
   $$;
   ```

5. Run `DATABASE_URL=... pnpm db:import-postgres <snapshot.ndjson>`, then `DATABASE_URL=... pnpm db:verify-postgres <snapshot.ndjson> <snapshot-id>`. Import stages every portable row and materializes current entities, alert baselines, ingestion evidence/version/link state, identity and application authorization records, durable rate-limit windows, and owner activity.
6. Treat `verified` as stronger than a staging-count check. The verifier checks the stored manifest, checksum, every per-table count, planned entity IDs and bodies, rate-limit rows, preserved owner-activity sequences, full-text search for a representative job, and representative owner-private state. Verification errors never render record bodies, addresses, tokens, ciphertext, or rate-limit keys.
7. Run the opt-in repository/RLS suite with `POSTGRES_TEST_DATABASE_URL` against a disposable database, then run production smoke checks using the server-only PostgreSQL credentials.
8. Only after the snapshot verifies, set the server-only `DATABASE_URL` in web and worker deployment configuration. Run one worker cycle so the shared database has a fresh heartbeat, then start the recurring worker and web services.

Rollback is permitted only before post-cutover writes. Put PostgreSQL writers in maintenance mode, remove `DATABASE_URL` so the previous SQLite configuration resumes, restart the previous web/worker release, and keep the verified NDJSON snapshot plus PostgreSQL snapshot ID for incident analysis. Do not import PostgreSQL changes back into SQLite automatically: that would be an unverified reverse migration.
