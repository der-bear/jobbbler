# Jobbbler

Jobbbler is an agent-native job discovery, alerting, and safe-application workspace built for the OpenAI WebMCP Challenge.

The product is under active implementation. The committed [production design](docs/superpowers/specs/2026-08-29-jobbbler-production-design.md) and [implementation plan](docs/superpowers/plans/2026-08-29-jobbbler-production.md) define the release gates.

## Local development

Requirements: Node.js 24 and pnpm 11.19.0.

```bash
cp .env.example .env
pnpm install
pnpm db:seed
pnpm ingest -- --source all --limit 50
pnpm dev
```

Fixture ingestion is the default and does not contact upstream providers. Live ingestion is explicit (`pnpm ingest:live`) and remains subject to the checked-in source policies. See [Source ingestion and governance](docs/architecture/source-ingestion.md).

The final local environment uses SQLite by default and the production environment uses Supabase PostgreSQL through equivalent repository contracts.

## Verification

```bash
pnpm verify
```

## License

[MIT](LICENSE)
