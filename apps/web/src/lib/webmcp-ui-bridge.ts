import {
  jobDetailResultSchema,
  jobSearchInputSchema,
  searchJobsResultSchema,
  type JobDetailResult,
  type JobSearchCriteria,
  type JobSearchInput,
  type SearchJobsResult,
} from "@jobbbler/contracts";

const searchCommitEvent = "jobbbler:webmcp-search-commit";
const detailCommitEvent = "jobbbler:webmcp-detail-commit";

export interface SearchSurfaceState {
  readonly criteria: JobSearchCriteria;
  readonly total: number | null;
}

export interface SearchCommit {
  readonly input: JobSearchInput;
  readonly result: SearchJobsResult;
}

let currentSearchState: SearchSurfaceState | null = null;

export function publishSearchSurfaceState(state: SearchSurfaceState | null): void {
  currentSearchState = state === null ? null : Object.freeze({ ...state });
}

export function readSearchSurfaceState(): SearchSurfaceState | null {
  return currentSearchState;
}

export function commitWebMcpSearch(input: JobSearchInput, result: SearchJobsResult): void {
  window.dispatchEvent(
    new CustomEvent<SearchCommit>(searchCommitEvent, { detail: { input, result } }),
  );
}

export function subscribeWebMcpSearchCommit(listener: (commit: SearchCommit) => void): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const detail = event.detail as Partial<SearchCommit> | null;
    if (detail === null) return;
    const input = jobSearchInputSchema.safeParse(detail.input);
    const result = searchJobsResultSchema.safeParse(detail.result);
    if (input.success && result.success) listener({ input: input.data, result: result.data });
  };
  window.addEventListener(searchCommitEvent, handler);
  return () => window.removeEventListener(searchCommitEvent, handler);
}

export function commitWebMcpJobDetail(result: JobDetailResult): void {
  window.dispatchEvent(new CustomEvent<JobDetailResult>(detailCommitEvent, { detail: result }));
}

export function subscribeWebMcpJobDetailCommit(
  listener: (result: JobDetailResult) => void,
): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const result = jobDetailResultSchema.safeParse(event.detail);
    if (result.success) listener(result.data);
  };
  window.addEventListener(detailCommitEvent, handler);
  return () => window.removeEventListener(detailCommitEvent, handler);
}
