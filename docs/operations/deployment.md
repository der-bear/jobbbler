# Web and worker deployment

Build independent immutable images from the repository root:

```bash
docker build --target web --tag jobbbler-web:local .
docker build --target worker --tag jobbbler-worker:local .
```

Run the web image with a server-only Supabase/PostgreSQL `DATABASE_URL`. Never put that URL, service-role credentials, session secrets, or encryption keys in `NEXT_PUBLIC_*` variables, an image layer, browser configuration, or logs.

```bash
docker run --rm --publish 3000:3000 \
  --env-file .env.production \
  jobbbler-web:local
```

Run the worker as a separate service using the same server-only `DATABASE_URL`. Choose `all_service` for recurring catalog and alert work, or a narrower mode only when operationally intended.

```bash
docker run --rm \
  --env-file .env.production \
  --env JOBBBLER_WORKER_MODE=all_service \
  jobbbler-worker:local
```

Before deploying either image, apply the checked-in `migrations/postgres` through a credentialed deployment migration step, then run the PostgreSQL rehearsal in [postgres-cutover-and-rollback.md](postgres-cutover-and-rollback.md). Do not run migrations with browser credentials.

Deploy web first and wait for `GET /api/health/ready` to report `driver: "postgres"` and expected migration/catalog counts. Then start one or more worker replicas. Work leases make normal retries safe, but source polling and notification delivery remain controlled by the checked-in policies and delivery provider configuration.

For SQLite-only development, omit `DATABASE_URL` and mount a writable `/app/.data` volume. Production PostgreSQL deployments do not need a SQLite volume.
