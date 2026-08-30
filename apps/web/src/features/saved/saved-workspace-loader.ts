import {
  jobAlertScheduleSchema,
  ownerSessionResultSchema,
  savedSearchSchema,
  verificationEndpointSummarySchema,
  type OwnerSummary,
  type SavedSearch,
  type JobAlertSchedule,
  type VerificationEndpointSummary,
} from "@jobbbler/contracts";
import { z } from "zod";

import { latestSearchRunSchema, type LatestSearchRun } from "@/lib/latest-run";
import { queryApi } from "@/lib/query-client";

const savedSearchListSchema = z.array(savedSearchSchema);
const scheduleListSchema = z.array(jobAlertScheduleSchema);
const endpointListSchema = z.array(verificationEndpointSummarySchema);

type SavedWorkspaceRequest = typeof queryApi;

export interface SavedWorkspaceResources {
  readonly endpoints: readonly VerificationEndpointSummary[];
  readonly savedSearches: readonly SavedSearch[];
  readonly schedules: readonly JobAlertSchedule[];
  readonly latestRuns: Promise<ReadonlyMap<string, LatestSearchRun>>;
}

export interface SavedWorkspaceInitialData {
  readonly owner: OwnerSummary;
  readonly endpoints: readonly VerificationEndpointSummary[];
  readonly savedSearches: readonly SavedSearch[];
  readonly schedules: readonly JobAlertSchedule[];
}

export async function loadLatestSearchRuns(
  savedSearches: readonly SavedSearch[],
  request: SavedWorkspaceRequest = queryApi,
): Promise<ReadonlyMap<string, LatestSearchRun>> {
  const runs = await Promise.all(
    savedSearches.map(async (saved) => {
      try {
        return await request(
          `/api/v1/saved-searches/${encodeURIComponent(saved.id)}/latest-run`,
          latestSearchRunSchema,
        );
      } catch {
        return null;
      }
    }),
  );
  return new Map(
    runs
      .filter((run): run is LatestSearchRun => run !== null)
      .map((run) => [run.savedSearchId, run]),
  );
}

export async function loadPrivateWorkspaceResources(
  request: SavedWorkspaceRequest = queryApi,
): Promise<SavedWorkspaceResources> {
  const [endpoints, savedSearches, schedules] = await Promise.all([
    request("/api/v1/owners/email", endpointListSchema),
    request("/api/v1/saved-searches", savedSearchListSchema),
    request("/api/v1/schedules", scheduleListSchema),
  ]);
  const latestRuns = loadLatestSearchRuns(savedSearches, request);

  return { endpoints, savedSearches, schedules, latestRuns };
}

export async function loadSavedWorkspaceData(
  request: SavedWorkspaceRequest = queryApi,
): Promise<SavedWorkspaceResources & { readonly owner: OwnerSummary }> {
  const session = request("/api/v1/owners/session", ownerSessionResultSchema);
  const resources = loadPrivateWorkspaceResources(request);
  const [current, loaded] = await Promise.all([session, resources]);
  return { owner: current.owner, ...loaded };
}
