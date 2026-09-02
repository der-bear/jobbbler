type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

/**
 * DATABASE_URL remains the portable override. POSTGRES_URL is the server-only
 * name installed by Supabase's official Vercel integration.
 */
export function configuredDatabaseUrl(environment: RuntimeEnvironment): string | undefined {
  const explicit = environment["DATABASE_URL"]?.trim();
  if (explicit !== undefined && explicit.length > 0) return explicit;
  const integrated = environment["POSTGRES_URL"]?.trim();
  return integrated === undefined || integrated.length === 0 ? undefined : integrated;
}
