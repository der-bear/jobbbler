import { ownerSummary } from "@jobbbler/core-domain";

import type { SavedWorkspaceInitialData } from "@/features/saved/saved-workspace-loader";

import { getIdentityRouteDependencies } from "./identity";
import { requireOwnerSession, type IdentityRouteDependencies } from "./identity-route-handlers";
import { getSavedSearchRouteDependencies } from "./saved-searches";
import type { SavedSearchRouteDependencies } from "./saved-search-route-handlers";

interface InitialSavedWorkspaceOptions {
  readonly request: Request;
  readonly identity?: IdentityRouteDependencies;
  readonly savedSearches?: SavedSearchRouteDependencies;
}

export async function loadInitialSavedWorkspace(
  options: InitialSavedWorkspaceOptions,
): Promise<SavedWorkspaceInitialData | null> {
  try {
    const identity = options.identity ?? getIdentityRouteDependencies();
    const savedSearches = options.savedSearches ?? getSavedSearchRouteDependencies();
    const current = await requireOwnerSession(options.request, identity);
    const ownerId = current.owner.id;
    const [endpointRecords, searches, schedules] = await Promise.all([
      identity.identity.listVerificationEndpoints(ownerId),
      savedSearches.service.listSavedSearches(ownerId),
      savedSearches.service.listSchedules(ownerId),
    ]);
    return {
      owner: ownerSummary(current.owner),
      endpoints: endpointRecords.map((endpoint) => ({
        id: endpoint.id,
        kind: endpoint.kind,
        maskedDestination: endpoint.maskedAddress,
        status: endpoint.status,
        verifiedAt: endpoint.verifiedAt,
      })),
      savedSearches: searches,
      schedules,
    };
  } catch {
    return null;
  }
}
