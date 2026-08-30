import { unstable_cache } from "next/cache";

import type { ApplicationCommand } from "@jobbbler/core-domain";
import {
  jobSearchInputSchema,
  type JobSearchInput,
  type SearchJobsResult,
} from "@jobbbler/contracts";

import {
  defaultSearch,
  type InitialSearchState,
  type PageSearchParams,
} from "@/features/search/initial-search-state";
import { searchParamsToInput } from "@/lib/search-url";

import { getDiscoveryRouteDependencies, type DiscoveryRouteDependencies } from "./commands";
import { createPublicCommandContext, createRequestId } from "./context";
import { checkDiscoveryRateLimit, publicJobSearchPolicy } from "./discovery-request";

type SearchCommand = ApplicationCommand<JobSearchInput, SearchJobsResult>;

interface InitialSearchLoadOptions {
  readonly request: Request;
  readonly command?: SearchCommand;
  readonly dependencies?: DiscoveryRouteDependencies;
}

const executeCachedProductionSearch = unstable_cache(
  async (serializedInput: string): Promise<SearchJobsResult> => {
    const input = jobSearchInputSchema.parse(JSON.parse(serializedInput));
    return getDiscoveryRouteDependencies().commands.searchJobs.execute(
      createPublicCommandContext(createRequestId()),
      input,
    );
  },
  ["initial-public-job-search-v1"],
  { revalidate: publicJobSearchPolicy.revalidateSeconds },
);

function toUrlSearchParams(searchParams: PageSearchParams): URLSearchParams {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(searchParams)) {
    if (typeof value === "string") parameters.append(key, value);
    else if (value !== undefined) {
      for (const item of value) parameters.append(key, item);
    }
  }
  return parameters;
}

export async function loadInitialSearch(
  searchParams: PageSearchParams,
  options: InitialSearchLoadOptions,
): Promise<InitialSearchState> {
  const parameters = toUrlSearchParams(searchParams);
  let input: JobSearchInput;
  try {
    input = parameters.size === 0 ? defaultSearch : searchParamsToInput(parameters);
  } catch {
    return {
      input: defaultSearch,
      result: null,
      error: "Some search filters are invalid. Adjust them and search again.",
    };
  }

  try {
    const dependencies = options.dependencies ?? getDiscoveryRouteDependencies();
    const requestId = createRequestId();
    const rateLimit = await checkDiscoveryRateLimit(
      options.request,
      requestId,
      publicJobSearchPolicy.scope,
      dependencies,
      publicJobSearchPolicy.limit,
    );
    if (rateLimit.response !== null) {
      return {
        input,
        result: null,
        error: "Search is briefly busy. Please retry in a moment.",
      };
    }
    const result =
      options.command !== undefined || options.dependencies !== undefined
        ? await (options.command ?? dependencies.commands.searchJobs).execute(
            createPublicCommandContext(requestId),
            input,
          )
        : await executeCachedProductionSearch(JSON.stringify(input));
    return { input, result, error: null };
  } catch {
    return {
      input,
      result: null,
      error: "Search is temporarily unavailable. Please retry.",
    };
  }
}
