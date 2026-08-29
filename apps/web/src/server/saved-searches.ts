import { createEntityId, createSavedSearchService } from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";

import { getServerStorage } from "./context";
import { getIdentityRouteDependencies } from "./identity";
import type { SavedSearchRouteDependencies } from "./saved-search-route-handlers";
import { createOwnerActivityPublisher } from "./owner-activity-publisher";

function scheduleFromStorage(record: Awaited<ReturnType<Storage["schedules"]["getById"]>>) {
  if (record === null) return null;
  return {
    id: record.id,
    ownerId: record.ownerId,
    savedSearchId: record.savedSearchId,
    recurrence: record.recurrence,
    delivery: { channel: record.deliveryChannel, endpointId: record.deliveryEndpointId },
    enabled: record.enabled,
    nextRunAt: record.nextRunAt,
    version: record.version,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

export function createSavedSearchRouteDependencies(
  storage: Storage,
  identity = getIdentityRouteDependencies(),
): SavedSearchRouteDependencies {
  return {
    identity,
    activity: createOwnerActivityPublisher(storage.ownerActivity),
    latestRun: {
      getEvaluation: (savedSearchId) => storage.alerts.getLatestEvaluation(savedSearchId),
      listChanges: (evaluationId) => storage.alerts.listChanges(evaluationId),
      getLatestDelivery: (scheduleId) => storage.alerts.getLatestDelivery(scheduleId),
    },
    service: createSavedSearchService({
      savedSearches: storage.savedSearches,
      schedules: {
        async insert(record) {
          const stored = await storage.schedules.insert({
            id: record.id,
            ownerId: record.ownerId,
            savedSearchId: record.savedSearchId,
            recurrence: record.recurrence,
            deliveryChannel: record.delivery.channel,
            deliveryEndpointId: record.delivery.endpointId,
            enabled: record.enabled,
            nextRunAt: record.nextRunAt,
            version: record.version,
            createdAt: record.createdAt,
            updatedAt: record.updatedAt,
          });
          return scheduleFromStorage(stored)!;
        },
        async getById(id) {
          return scheduleFromStorage(await storage.schedules.getById(id));
        },
        async listByOwner(ownerId) {
          return Promise.all(
            (await storage.schedules.listByOwner(ownerId)).map(async (record) =>
              scheduleFromStorage(record),
            ),
          ).then((records) => records.filter((record) => record !== null));
        },
        async update(record, expectedVersion) {
          const stored = await storage.schedules.update(
            {
              id: record.id,
              ownerId: record.ownerId,
              savedSearchId: record.savedSearchId,
              recurrence: record.recurrence,
              deliveryChannel: record.delivery.channel,
              deliveryEndpointId: record.delivery.endpointId,
              enabled: record.enabled,
              nextRunAt: record.nextRunAt,
              version: record.version,
              createdAt: record.createdAt,
              updatedAt: record.updatedAt,
            },
            expectedVersion,
          );
          return scheduleFromStorage(stored)!;
        },
      },
      endpoints: storage.identity,
      ids: {
        savedSearch: () => createEntityId("saved"),
        schedule: () => createEntityId("schedule"),
      },
    }),
  };
}

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerSavedSearchDependencies?: SavedSearchRouteDependencies;
};

export function getSavedSearchRouteDependencies(): SavedSearchRouteDependencies {
  const existing = globalRegistry.__jobbblerSavedSearchDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createSavedSearchRouteDependencies(getServerStorage());
  globalRegistry.__jobbblerSavedSearchDependencies = dependencies;
  return dependencies;
}
