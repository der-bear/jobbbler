import type { ApplicationCommand } from "@jobbbler/core-domain";
import type { JobSearchInput, SearchJobsResult } from "@jobbbler/contracts";

import {
  defaultSearch,
  type InitialSearchState,
  type PageSearchParams,
} from "@/features/search/initial-search-state";
import { searchParamsToInput } from "@/lib/search-url";

import { getDiscoveryRouteDependencies } from "./commands";
import { createPublicCommandContext, createRequestId } from "./context";

type SearchCommand = ApplicationCommand<JobSearchInput, SearchJobsResult>;

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
  command: SearchCommand = getDiscoveryRouteDependencies().commands.searchJobs,
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
    const result = await command.execute(createPublicCommandContext(createRequestId()), input);
    return { input, result, error: null };
  } catch {
    return {
      input,
      result: null,
      error: "Search is temporarily unavailable. Please retry.",
    };
  }
}
