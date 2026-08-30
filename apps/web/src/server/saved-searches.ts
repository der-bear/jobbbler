import {
  calculateNextRun,
  createEntityId,
  createSavedSearchService,
  deriveEvaluationJitterSeconds,
} from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";

import { getServerStorage } from "./context";
import { getIdentityRouteDependencies } from "./identity";
import type { SearchAlertAgentRouteDependencies } from "./search-alert-agent-route-handlers";
import { createSearchAlertReviewCodec } from "./search-alert-review-token";
import type { SavedSearchRouteDependencies } from "./saved-search-route-handlers";
import { createOwnerActivityPublisher } from "./owner-activity-publisher";

const EVALUATION_JITTER_MAX_SECONDS = 120;

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
    idempotency: storage.idempotency,
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

export function createSearchAlertAgentRouteDependencies(
  storage: Storage,
  identity = getIdentityRouteDependencies(),
): SearchAlertAgentRouteDependencies {
  const savedSearchDependencies = createSavedSearchRouteDependencies(storage, identity);
  return {
    identity,
    savedSearches: savedSearchDependencies.service,
    idempotency: storage.idempotency,
    ...(savedSearchDependencies.activity === undefined
      ? {}
      : { activity: savedSearchDependencies.activity }),
    reviewCodec: createSearchAlertReviewCodec(identity.environment),
    prospectiveRunAt(savedSearchId, recurrence, now) {
      const scheduled = calculateNextRun(recurrence, now);
      const jitter = deriveEvaluationJitterSeconds(savedSearchId, EVALUATION_JITTER_MAX_SECONDS);
      return new Date(Date.parse(scheduled) + jitter * 1_000).toISOString();
    },
  };
}

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerSavedSearchDependencies?: SavedSearchRouteDependencies;
  __jobbblerSearchAlertAgentDependencies?: SearchAlertAgentRouteDependencies;
};

export function getSavedSearchRouteDependencies(): SavedSearchRouteDependencies {
  const existing = globalRegistry.__jobbblerSavedSearchDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createSavedSearchRouteDependencies(getServerStorage());
  globalRegistry.__jobbblerSavedSearchDependencies = dependencies;
  return dependencies;
}

export function getSearchAlertAgentRouteDependencies(): SearchAlertAgentRouteDependencies {
  const existing = globalRegistry.__jobbblerSearchAlertAgentDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createSearchAlertAgentRouteDependencies(getServerStorage());
  globalRegistry.__jobbblerSearchAlertAgentDependencies = dependencies;
  return dependencies;
}
