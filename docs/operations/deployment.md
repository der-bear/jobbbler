# Web and worker deployment

Build independent immutable images from a clean repository checkout. Realtime wake-ups are optional; when enabled, pass the public Supabase URL and anon key at build time because Next.js embeds `NEXT_PUBLIC_*` values into the browser bundle. These values are public configuration, never service-role credentials.

Before building the public release, enroll the exact clean HTTPS
`PUBLIC_BASE_URL` in Chrome's WebMCP origin trial and pass the issued token as
`WEBMCP_ORIGIN_TRIAL_TOKEN`. The web build emits it only as the public
`Origin-Trial` response header. The token is origin-bound and is not an
application credential, but it must not be checked into the repository. A
redeploy is required after issuing or renewing it because Next.js resolves the
header configuration during the web build.

```bash
docker build --target web --tag jobbbler-web:local \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS="$NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS" \
  --build-arg WEBMCP_ORIGIN_TRIAL_TOKEN="$WEBMCP_ORIGIN_TRIAL_TOKEN" \
  .
docker build --target worker --tag jobbbler-worker:local .
```

Run both images with the same server-only PostgreSQL `DATABASE_URL` and set
`PUBLIC_BASE_URL` to the deployed clean HTTPS origin. That origin identifies
Jobbbler in canonical links and outbound provider requests; production startup
fails closed when it is absent or unsafe. Never put the database URL,
service-role credentials, token-hash secrets, or encryption keys in
`NEXT_PUBLIC_*` variables, an image layer, browser configuration, or logs.

Production web traffic must enter through a trusted ingress that terminates HTTPS and replaces, rather than appends to, client-IP forwarding headers. Set `TRUST_PROXY_HEADERS=true` only behind that boundary. Do not expose the production container directly with `docker run --publish`; direct exposure either fails runtime validation or lets clients influence the rate-limit identity.

Before either runtime starts, apply the checked-in PostgreSQL migrations with
`DATABASE_URL=... pnpm db:migrate-postgres` and run the verified import from
[postgres-cutover-and-rollback.md](postgres-cutover-and-rollback.md). The migration job needs deployment credentials; browser credentials are never sufficient. The command is checksum-bound and exits without opening a fallback database when `DATABASE_URL` is absent.

Start one worker cycle before asking the web service to become ready. A fresh production database intentionally reports web readiness as unavailable until a recent worker heartbeat proves that background processing can reach the same database.

```bash
docker run --rm \
  --env-file .env.production \
  --env JOBBBLER_WORKER_MODE=alert_once \
  jobbbler-worker:local
```

Then start the recurring worker service and the web service behind the trusted ingress:

```bash
docker run --rm \
  --env-file .env.production \
  --env JOBBBLER_WORKER_MODE=alert_service \
  jobbbler-worker:local

docker run --rm \
  --env-file .env.production \
  jobbbler-web:local
```

For the challenge-hosted topology, the Next.js web app can run on Vercel while
the checked-in [alert worker workflow](../../.github/workflows/alert-worker.yml)
runs one bounded `alert_once` cycle every ten minutes and can also be started
manually. Configure the workflow with repository secrets named `DATABASE_URL`,
`PUBLIC_BASE_URL`, `PII_ENCRYPTION_KEY`, `RESEND_API_KEY`, and `EMAIL_FROM`.
The web deployment uses the same database, origin, encryption key, provider
credentials, plus its server-only `TOKEN_HASH_SECRET`. The workflow never uses
a catalog or combined worker mode, so the first-party demonstration catalog
cannot be mixed with live external feeds.

The official Supabase integration may expose the web app's connection as
`POSTGRES_URL`; Jobbbler accepts that server-only name automatically while
keeping `DATABASE_URL` as the explicit portable override. The independent
GitHub Actions worker still uses its documented `DATABASE_URL` repository
secret.

Connect the repository as a monorepo and set the Vercel project's Root
Directory to `apps/web`. The checked-in `apps/web/vercel.json` runs installation
and the filtered build from the repository root so pnpm can resolve every
workspace package; Next.js keeps its normal `.next` output contract. Do not add
a Vercel cron for the worker: Hobby schedules are not frequent enough for the
ten-minute readiness and alert interval, and a serverless request is not a
long-lived worker.

The scheduled workflow is a deployment adapter for the same idempotent worker,
not a second implementation of alert logic. Its concurrency group prevents
overlapping cycles; the database leases and provider idempotency keys remain the
authoritative retry boundary. Keep the web readiness heartbeat window longer
than the external scheduler's normal interval, but short enough to fail closed
when the worker has actually stopped.

Through the public HTTPS ingress, wait for `GET /api/health/live`, then
`GET /api/health/ready` to report `driver: "postgres"`, the release migration
count, exactly 300 jobs and 30 organizations. Work leases make normal worker
retries safe. The release worker evaluates saved searches and notification
delivery only; every checked-in live-source policy is disabled.

Before browser testing, inspect one document response and confirm
`Origin-Trial`, `Origin-Agent-Cluster: ?1`, and a `Permissions-Policy` containing
`tools=(self)`. Then open the origin in Chrome 149 or later without the local
development flag and verify that `document.modelContext` exists, the Agent
activity panel reports the complete tool count, and a read-only tool can be
discovered and executed. The origin-trial token must match this exact origin;
staging and production origins need separate enrollments.

For SQLite-only development, omit `DATABASE_URL` and mount a writable `/app/.data` volume. Production PostgreSQL deployments do not need a SQLite volume.
