import type { ZodType } from "zod";

import { savedSearchSchema, type JobSearchCriteria, type SavedSearch } from "@jobbbler/contracts";

import { queryApi, type QueryApiOptions } from "@/lib/query-client";

type SavedSearchRequest = <T>(
  url: string,
  schema: ZodType<T>,
  options?: QueryApiOptions,
) => Promise<T>;

export function saveSearchWithoutDelivery(
  input: Readonly<{ name: string; criteria: JobSearchCriteria }>,
  request: SavedSearchRequest = queryApi,
): Promise<SavedSearch> {
  return request("/api/v1/saved-searches", savedSearchSchema, {
    method: "POST",
    body: input,
  });
}
