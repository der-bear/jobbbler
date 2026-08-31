import type { ZodType } from "zod";

import {
  ownerSessionResultSchema,
  savedSearchSchema,
  type JobSearchCriteria,
  type SavedSearch,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi, type QueryApiOptions } from "@/lib/query-client";
import { markOwnerSessionStarted } from "@/lib/owner-session-marker";

type SavedSearchRequest = <T>(
  url: string,
  schema: ZodType<T>,
  options?: QueryApiOptions,
) => Promise<T>;

interface AgentSavedSearchDependencies {
  readonly request: SavedSearchRequest;
  createIdempotencyKey(): string;
}

const defaultAgentDependencies: AgentSavedSearchDependencies = {
  request: queryApi,
  createIdempotencyKey: () => crypto.randomUUID(),
};

export function saveSearchWithoutDelivery(
  input: Readonly<{ name: string; criteria: JobSearchCriteria }>,
  request: SavedSearchRequest = queryApi,
): Promise<SavedSearch> {
  return request("/api/v1/saved-searches", savedSearchSchema, {
    method: "POST",
    body: input,
  });
}

function postAgentSavedSearch(
  input: Readonly<{ name: string; criteria: JobSearchCriteria }>,
  idempotencyKey: string,
  options: Readonly<{ signal: AbortSignal }>,
  dependencies: AgentSavedSearchDependencies,
): Promise<SavedSearch> {
  return dependencies.request("/api/v1/agent/saved-searches", savedSearchSchema, {
    method: "POST",
    body: input,
    headers: { "Idempotency-Key": idempotencyKey },
    signal: options.signal,
  });
}

export async function saveJobSearchForAgent(
  input: Readonly<{ name: string; criteria: JobSearchCriteria }>,
  options: Readonly<{ signal: AbortSignal }>,
  dependencies: AgentSavedSearchDependencies = defaultAgentDependencies,
): Promise<SavedSearch> {
  const idempotencyKey = dependencies.createIdempotencyKey();
  try {
    const saved = await postAgentSavedSearch(input, idempotencyKey, options, dependencies);
    markOwnerSessionStarted();
    return saved;
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "UNAUTHORIZED") throw error;
    const session = await dependencies.request("/api/v1/owners/session", ownerSessionResultSchema, {
      method: "POST",
      signal: options.signal,
    });
    const saved = await postAgentSavedSearch(input, idempotencyKey, options, dependencies);
    markOwnerSessionStarted(session.expiresAt);
    return saved;
  }
}
