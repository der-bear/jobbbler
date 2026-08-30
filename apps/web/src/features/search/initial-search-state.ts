import type { JobSearchInput, SearchJobsResult } from "@jobbbler/contracts";

export const defaultSearch: JobSearchInput = {
  sort: "newest",
  limit: 20,
};

export interface InitialSearchState {
  readonly input: JobSearchInput;
  readonly result: SearchJobsResult | null;
  readonly error: string | null;
}

export type PageSearchParams = Readonly<Record<string, string | readonly string[] | undefined>>;
