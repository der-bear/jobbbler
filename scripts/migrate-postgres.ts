import { migratePostgres, openPostgresDatabase } from "../packages/storage-postgres/src/index.js";

const databaseUrl = process.env["DATABASE_URL"]?.trim();
if (databaseUrl === undefined || databaseUrl.length === 0) {
  throw new Error("DATABASE_URL is required for PostgreSQL migrations.");
}

const sql = openPostgresDatabase(databaseUrl);

try {
  const applied = await migratePostgres(sql);
  process.stdout.write(
    `${
      applied.length === 0
        ? "PostgreSQL schema is current"
        : `Applied ${String(applied.length)} PostgreSQL migrations`
    }.\n`,
  );
} finally {
  await sql.end({ timeout: 5 });
}
