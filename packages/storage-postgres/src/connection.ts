import postgres, { type Sql, type TransactionSql } from "postgres";

export type PostgresSql = Sql<Record<string, never>>;
export type PostgresExecutor = PostgresSql | TransactionSql<Record<string, never>>;

export function openPostgresDatabase(databaseUrl: string): PostgresSql {
  if (databaseUrl.trim().length === 0) throw new Error("PostgreSQL database URL is required.");
  return postgres(databaseUrl, {
    // A small pool keeps horizontally scaled web and worker replicas within
    // Supabase pooler limits. Transaction poolers do not support named
    // prepared statements, so portable execution deliberately disables them.
    max: 5,
    idle_timeout: 20,
    connect_timeout: 10,
    prepare: false,
  });
}
