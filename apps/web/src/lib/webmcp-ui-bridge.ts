import {
  jobDetailResultSchema,
  jobAlertScheduleSchema,
  jobSearchInputSchema,
  savedSearchSchema,
  savedSearchDeletionReceiptSchema,
  searchJobsResultSchema,
  type JobDetailResult,
  type JobAlertSchedule,
  type JobSearchCriteria,
  type JobSearchInput,
  type SavedSearch,
  type SavedSearchDeletionReceipt,
  type SearchJobsResult,
} from "@jobbbler/contracts";

const searchCommitEvent = "jobbbler:webmcp-search-commit";
const detailCommitEvent = "jobbbler:webmcp-detail-commit";
const scheduleCommitEvent = "jobbbler:webmcp-schedule-commit";
const savedSearchCommitEvent = "jobbbler:webmcp-saved-search-commit";
const savedSearchDeletionCommitEvent = "jobbbler:webmcp-saved-search-deletion-commit";

export interface SearchSurfaceState {
  readonly criteria: JobSearchCriteria;
  readonly total: number | null;
  readonly presentation: "headless" | "follow";
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
  publishSearchSurfaceState({
    criteria: result.criteria,
    total: result.total,
    presentation: "follow",
  });
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

export function commitWebMcpSchedule(schedule: JobAlertSchedule): void {
  window.dispatchEvent(
    new CustomEvent<JobAlertSchedule>(scheduleCommitEvent, { detail: schedule }),
  );
}

export function subscribeWebMcpScheduleCommit(
  listener: (schedule: JobAlertSchedule) => void,
): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const schedule = jobAlertScheduleSchema.safeParse(event.detail);
    if (schedule.success) listener(schedule.data);
  };
  window.addEventListener(scheduleCommitEvent, handler);
  return () => window.removeEventListener(scheduleCommitEvent, handler);
}

export function commitWebMcpSavedSearch(savedSearch: SavedSearch): void {
  window.dispatchEvent(
    new CustomEvent<SavedSearch>(savedSearchCommitEvent, { detail: savedSearch }),
  );
}

export function subscribeWebMcpSavedSearch(
  listener: (savedSearch: SavedSearch) => void,
): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const savedSearch = savedSearchSchema.safeParse(event.detail);
    if (savedSearch.success) listener(savedSearch.data);
  };
  window.addEventListener(savedSearchCommitEvent, handler);
  return () => window.removeEventListener(savedSearchCommitEvent, handler);
}

export function commitWebMcpSavedSearchDeletion(receipt: SavedSearchDeletionReceipt): void {
  window.dispatchEvent(
    new CustomEvent<SavedSearchDeletionReceipt>(savedSearchDeletionCommitEvent, {
      detail: receipt,
    }),
  );
}

export function subscribeWebMcpSavedSearchDeletion(
  listener: (receipt: SavedSearchDeletionReceipt) => void,
): () => void {
  const handler = (event: Event) => {
    if (!(event instanceof CustomEvent)) return;
    const receipt = savedSearchDeletionReceiptSchema.safeParse(event.detail);
    if (receipt.success) listener(receipt.data);
  };
  window.addEventListener(savedSearchDeletionCommitEvent, handler);
  return () => window.removeEventListener(savedSearchDeletionCommitEvent, handler);
}
