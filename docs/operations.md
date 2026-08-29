# Operations

This runbook covers the checked-in web, worker, SQLite, and PostgreSQL/Supabase paths. It does not provide managed hosting, on-call coverage, or a public availability commitment.

## Runtime model

The web server and worker independently select SQLite when `DATABASE_URL` is absent and PostgreSQL when it is present. SQLite is for local, single-host development with a writable data volume. Production uses a server-only PostgreSQL/Supabase connection and runs the web and worker as separate services. Deployment image targets, environment boundaries, and startup order are in [Deployment](operations/deployment.md).

Run database migrations as a credentialed deployment step, not from the browser. PostgreSQL cutover, deterministic export/import verification, and the restriction on reverse import are in [PostgreSQL cutover and rollback](operations/postgres-cutover-and-rollback.md).

The worker has explicit catalog, alert, and combined modes. Use `all_service` when both catalog ingestion and alert delivery are intended. Work items persist leases and bounded retries; monitor lease conflicts, retry outcomes, and provider failures in the deployment log platform rather than treating those mechanisms as a complete operational guarantee.

## Health, logs, and log-derived metrics

- `GET /api/health/live` shows that the web process can answer requests.
- `GET /api/health/ready` checks the selected database and returns only the driver, migration count, and catalog aggregate counts. It must be ready before routing traffic or starting dependent workers.
- Run the checked-in production smoke script after deployment to verify public discovery, health, and the unauthenticated private-activity boundary. See the release script in [`package.json`](../package.json) and [Health and security operations](operations/health-and-security.md).

Web and worker processes write structured Pino records. A deployment log platform can derive cycle success/failure, source-run outcomes, lease/retry failures, delivery outcomes, and request-error rates from those records. The repository does not expose a native metrics endpoint, dashboards, paging integration, or SLO implementation; configure those in the selected platform.

## Incident triage

| Symptom                              | First checks                                                                                               | Safe response                                                                                                           |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Web unavailable                      | Liveness, readiness, deployment revision, structured error logs                                            | Keep workers from writing until the database and selected release are known healthy.                                    |
| Ready fails                          | Driver selection, migration journal, database reachability, SQLite integrity or PostgreSQL migration state | Do not bypass readiness; repair or roll back the deployment path before enabling writers.                               |
| Catalog is stale                     | Worker mode, source policy state, source-run result/error code, lease failures                             | Disable the affected connector if needed; preserve evidence and do not infer freshness from a partial run.              |
| Alert delivery fails                 | Verified endpoint state, delivery status/error code, provider configuration                                | Pause affected schedules or retry through the worker; never copy an encrypted destination into logs.                    |
| Suspected credential or PII exposure | Redacted logs, deployment environment history, provider audit trail                                        | Rotate the affected credential, revoke affected access where supported, and keep raw secrets out of incident artifacts. |

Source-specific triage and disablement are in [Sources](sources.md). Authorization and confirmation concerns should be evaluated against the exact immutable review and receipt records, not against the recent activity projection.

## Backup, restore, and recovery assumptions

SQLite backup and restore verification are implemented as local operator commands. A consistent backup runs through SQLite's backup API; restore verification checks the migration journal, database integrity, foreign keys, FTS synchronization, row ordering checksum, and catalog counts. See the backup and restore scripts referenced by [`package.json`](../package.json).

For PostgreSQL, use the deterministic SQLite export/import rehearsal before cutover and use the managed provider's backup and point-in-time recovery facilities after cutover. The repository does not implement an automatic PostgreSQL-to-SQLite reverse migration.

RPO and RTO are deployment decisions, not tested product guarantees:

- SQLite RPO is no better than the operator's backup interval and volume durability; its RTO includes restoring a verified backup and restarting web and worker.
- PostgreSQL RPO/RTO depend on the selected provider, region, backup/PITR plan, migration status, and deployment procedure.
- Record the chosen objectives, backup schedule, restore owner, and a successful rehearsal in the deployment environment. Do not state an RPO or RTO that has not been exercised there.

## Secret rotation

Keep `DATABASE_URL`, notification-provider credentials, token hashing material, and PII encryption material in the deployment secret store only. Never place them in `NEXT_PUBLIC_*`, a container image layer, browser configuration, or logs.

- Rotate notification-provider credentials at the provider, update the server/worker environment, and restart the affected service.
- Rotating `TOKEN_HASH_SECRET` invalidates existing owner sessions, verification challenges, rate-limit key continuity, and cursor signatures. Plan for sign-in/verification disruption.
- The current email envelope has no multi-key keyring or automatic re-encryption workflow. Do not rotate `PII_ENCRYPTION_KEY` in place: old encrypted endpoints would no longer decrypt. Schedule maintenance and an explicit endpoint re-verification/migration procedure first.

## Migration rollback and judging availability

Rollback after a PostgreSQL cutover is safe only before post-cutover writes. The exact maintenance, snapshot, verification, and rollback sequence is in [PostgreSQL cutover and rollback](operations/postgres-cutover-and-rollback.md). After writes begin, treat rollback as a data-migration incident rather than toggling `DATABASE_URL`.

For a judging period, run the reproducible local or deployed web-and-worker setup, keep fixture ingestion available, and record the deployed revision plus smoke result. The repository intentionally makes no claim of a permanently hosted public instance, external-source uptime, provider credits, or uninterrupted availability; live source and email behavior remain dependent on the operator's configured credentials and policies.
