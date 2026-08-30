import { jobAlertScheduleSchema, savedSearchSchema } from "@jobbbler/contracts";

import { ApiClientError, queryApi } from "@/lib/query-client";

type SavedWebMcpRequest = typeof queryApi;

async function readCurrentWorkspaceOrEmpty<T>(read: () => Promise<T>, empty: T): Promise<T> {
  try {
    return await read();
  } catch (error) {
    if (error instanceof ApiClientError && error.code === "UNAUTHORIZED") return empty;
    throw error;
  }
}

export function createSavedWebMcpReadAdapter(
  dependencies: Readonly<{ request?: SavedWebMcpRequest }> = {},
) {
  const request = dependencies.request ?? queryApi;
  return {
    listSavedSearches: ({ signal }: Readonly<{ signal: AbortSignal }>) =>
      readCurrentWorkspaceOrEmpty(
        () => request("/api/v1/saved-searches", savedSearchSchema.array(), { signal }),
        [],
      ),
    listSchedules: ({ signal }: Readonly<{ signal: AbortSignal }>) =>
      readCurrentWorkspaceOrEmpty(
        () => request("/api/v1/schedules", jobAlertScheduleSchema.array(), { signal }),
        [],
      ),
  };
}
