import type { IdempotencyRepository, SearchAlertPreparationRepository } from "@jobbbler/storage";

export async function runSearchAlertRetention(
  preparations: Pick<SearchAlertPreparationRepository, "purgeExpired">,
  idempotency: Pick<IdempotencyRepository, "purgeExpired">,
  input: { readonly now: string; readonly limit: number },
): Promise<{
  readonly purgedPreparations: number;
  readonly purgedIdempotency: number;
  readonly failed: readonly ("preparation" | "idempotency")[];
}> {
  if (!Number.isSafeInteger(input.limit) || input.limit < 1 || input.limit > 1_000) {
    throw new TypeError("Search alert verification retention limit must be between 1 and 1000.");
  }
  const [preparation, records] = await Promise.allSettled([
    Promise.resolve().then(() => preparations.purgeExpired(input)),
    Promise.resolve().then(() =>
      idempotency.purgeExpired({
        scopePrefix: "search_alert.",
        now: input.now,
        limit: input.limit,
      }),
    ),
  ]);
  return {
    purgedPreparations: preparation.status === "fulfilled" ? preparation.value : 0,
    purgedIdempotency: records.status === "fulfilled" ? records.value : 0,
    failed: [
      ...(preparation.status === "rejected" ? (["preparation"] as const) : []),
      ...(records.status === "rejected" ? (["idempotency"] as const) : []),
    ],
  };
}
