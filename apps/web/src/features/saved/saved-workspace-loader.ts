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

export type SavedWorkspaceInitializationMode = "none" | "reuse" | "load" | "create";

/**
 * Server-rendered saved-search data is authoritative for the first paint. A
 * create request still needs the current search criteria, but it must not
 * refetch the same private workspace and hold the whole page behind that
 * redundant request.
 */
export function savedWorkspaceInitializationMode(
  initialData: SavedWorkspaceInitialData | null | undefined,
  createRequested: boolean,
): SavedWorkspaceInitializationMode {
  if (initialData === undefined) return "load";
  if (!createRequested) return "none";
  return initialData === null ? "create" : "reuse";
}

export async function loadLatestSearchRuns(
  savedSearches: readonly SavedSearch[],
  schedules: readonly JobAlertSchedule[],
  request: SavedWorkspaceRequest = queryApi,
): Promise<ReadonlyMap<string, LatestSearchRun>> {
  const scheduledSearchIds = new Set(schedules.map((schedule) => schedule.savedSearchId));
  const runs = await Promise.all(
    savedSearches
      .filter((saved) => scheduledSearchIds.has(saved.id))
      .map(async (saved) => {
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
  const latestRuns = loadLatestSearchRuns(savedSearches, schedules, request);

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
