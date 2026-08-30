import { z } from "zod";

import { locationSuggestionsResultSchema } from "@jobbbler/contracts";

import { searchParamsToInput } from "@/lib/search-url";

import { apiErrorResponse, apiSuccessResponse } from "./api-response";
import { getDiscoveryRouteDependencies, type DiscoveryRouteDependencies } from "./commands";
import { createPublicCommandContext, createRequestId } from "./context";
import { checkDiscoveryRateLimit, rateLimitHeaders } from "./discovery-request";

export interface JobDetailRouteContext {
  readonly params: Promise<{ readonly id: string }>;
}

const locationSuggestionQuerySchema = z.strictObject({
  q: z.string().trim().min(1).max(120),
  limit: z.coerce.number().int().min(1).max(20).default(8),
});

export async function handleSearchRequest(
  request: Request,
  dependencies?: DiscoveryRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const currentDependencies = dependencies ?? getDiscoveryRouteDependencies();
    const rateLimit = await checkDiscoveryRateLimit(
      request,
      requestId,
      "jobs.search",
      currentDependencies,
      60,
    );
    if (rateLimit.response !== null) return rateLimit.response;

    const input = searchParamsToInput(new URL(request.url).searchParams);
    const result = await currentDependencies.commands.searchJobs.execute(
      createPublicCommandContext(requestId),
      input,
    );
    return apiSuccessResponse(result, {
      requestId,
      cacheControl: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      headers: rateLimitHeaders(rateLimit.decision),
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleLocationSuggestionsRequest(
  request: Request,
  dependencies?: DiscoveryRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const currentDependencies = dependencies ?? getDiscoveryRouteDependencies();
    const rateLimit = await checkDiscoveryRateLimit(
      request,
      requestId,
      "jobs.locations",
      currentDependencies,
      120,
    );
    if (rateLimit.response !== null) return rateLimit.response;

    const url = new URL(request.url);
    const query = locationSuggestionQuerySchema.parse({
      q: url.searchParams.get("q") ?? undefined,
      limit: url.searchParams.get("limit") ?? undefined,
    });
    const locations = await currentDependencies.jobs.suggestLocations(query.q, query.limit);
    return apiSuccessResponse(locationSuggestionsResultSchema.parse({ locations }), {
      requestId,
      cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=1800",
      headers: rateLimitHeaders(rateLimit.decision),
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleCompareRequest(
  request: Request,
  dependencies?: DiscoveryRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const currentDependencies = dependencies ?? getDiscoveryRouteDependencies();
    const rateLimit = await checkDiscoveryRateLimit(
      request,
      requestId,
      "jobs.compare",
      currentDependencies,
      60,
    );
    if (rateLimit.response !== null) return rateLimit.response;

    const parameters = new URL(request.url).searchParams;
    const result = await currentDependencies.commands.compareJobs.execute(
      createPublicCommandContext(requestId),
      { jobIds: parameters.getAll("id"), criteria: searchParamsToInput(parameters) },
    );
    return apiSuccessResponse(result, {
      requestId,
      cacheControl: "public, max-age=0, s-maxage=60, stale-while-revalidate=300",
      headers: rateLimitHeaders(rateLimit.decision),
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}

export async function handleJobDetailRequest(
  request: Request,
  routeContext: JobDetailRouteContext,
  dependencies?: DiscoveryRouteDependencies,
): Promise<Response> {
  const requestId = createRequestId();
  try {
    const currentDependencies = dependencies ?? getDiscoveryRouteDependencies();
    const rateLimit = await checkDiscoveryRateLimit(
      request,
      requestId,
      "jobs.detail",
      currentDependencies,
      120,
    );
    if (rateLimit.response !== null) return rateLimit.response;

    const { id } = await routeContext.params;
    const criteria = searchParamsToInput(new URL(request.url).searchParams);
    const result = await currentDependencies.commands.getJob.execute(
      createPublicCommandContext(requestId),
      { jobId: id, criteria },
    );
    return apiSuccessResponse(result, {
      requestId,
      cacheControl: "public, max-age=60, s-maxage=300, stale-while-revalidate=600",
      headers: rateLimitHeaders(rateLimit.decision),
    });
  } catch (error) {
    return apiErrorResponse(error, { requestId });
  }
}
