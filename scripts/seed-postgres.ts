import { resolve } from "node:path";

import { createPostgresStorage } from "../packages/storage-postgres/src/index.js";
import { seedDemoCatalogInto } from "../packages/storage-sqlite/src/seed.js";

// Refreshes the demo catalog in a PostgreSQL deployment: organizations and jobs
// are upserted by id, so a changed fixture (new roles, revised salaries) lands in
// place without touching owners, saved searches, applications, or receipts.
// Usage: DATABASE_URL=postgres://... pnpm db:seed-postgres [fixtures/demo-catalog.json]
const databaseUrl = (process.env["DATABASE_URL"] ?? process.env["POSTGRES_URL"])?.trim();
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL (or POSTGRES_URL) is required to seed PostgreSQL.");
}
const fixturePath = resolve(process.argv[2] ?? "fixtures/demo-catalog.json");

const storage = createPostgresStorage(databaseUrl);
try {
  const result = await seedDemoCatalogInto(storage, fixturePath);
  process.stdout.write(
    `Seeded ${result.jobs} jobs across ${result.organizations} organizations into PostgreSQL from ${fixturePath}\n`,
  );
} finally {
  await storage.close();
}
