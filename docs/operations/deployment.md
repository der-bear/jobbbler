# Web and worker deployment

Build independent immutable images from a clean repository checkout. Realtime wake-ups are optional; when enabled, pass the public Supabase URL and anon key at build time because Next.js embeds `NEXT_PUBLIC_*` values into the browser bundle. These values are public configuration, never service-role credentials.

```bash
docker build --target web --tag jobbbler-web:local \
  --build-arg NEXT_PUBLIC_SUPABASE_URL="$NEXT_PUBLIC_SUPABASE_URL" \
  --build-arg NEXT_PUBLIC_SUPABASE_ANON_KEY="$NEXT_PUBLIC_SUPABASE_ANON_KEY" \
  --build-arg NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS="$NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS" \
  .
docker build --target worker --tag jobbbler-worker:local .
```

Run both images with the same server-only PostgreSQL `DATABASE_URL`. Never put that URL, service-role credentials, token-hash secrets, or encryption keys in `NEXT_PUBLIC_*` variables, an image layer, browser configuration, or logs.

Production web traffic must enter through a trusted ingress that terminates HTTPS and replaces, rather than appends to, client-IP forwarding headers. Set `TRUST_PROXY_HEADERS=true` only behind that boundary. Do not expose the production container directly with `docker run --publish`; direct exposure either fails runtime validation or lets clients influence the rate-limit identity.

Before either runtime starts, apply the checked-in PostgreSQL migrations and run the verified import from [postgres-cutover-and-rollback.md](postgres-cutover-and-rollback.md). The migration job needs deployment credentials; browser credentials are never sufficient.

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
  --env JOBBBLER_WORKER_MODE=all_service \
  jobbbler-worker:local

docker run --rm \
  --env-file .env.production \
  jobbbler-web:local
```

Through the public HTTPS ingress, wait for `GET /api/health/live`, then `GET /api/health/ready` to report `driver: "postgres"`, the release migration count, and the expected catalog counts. Work leases make normal worker retries safe, but source polling and notification delivery remain controlled by the checked-in policies and delivery provider configuration.

For SQLite-only development, omit `DATABASE_URL` and mount a writable `/app/.data` volume. Production PostgreSQL deployments do not need a SQLite volume.
