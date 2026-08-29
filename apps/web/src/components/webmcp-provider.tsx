"use client";

import { usePathname, useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  compareJobsResultSchema,
  jobAlertScheduleSchema,
  jobDetailResultSchema,
  savedSearchSchema,
  searchJobsResultSchema,
  type ToolActivity,
} from "@jobbbler/contracts";
import {
  AgentActivityStore,
  isModelContextAvailable,
  registerToolSet,
  type ToolManifest,
} from "@jobbbler/webmcp";

import { createCompareToolManifests } from "@/features/compare/webmcp-tools";
import { createApplicationToolManifests } from "@/features/application/webmcp-tools";
import {
  readApplicationWebMcpSurface,
  subscribeApplicationWebMcpSurface,
} from "@/features/application/webmcp-surface";
import { compareApiUrl } from "@/features/compare/compare-state";
import { createJobDetailToolManifests } from "@/features/job-detail/webmcp-tools";
import { createSearchToolManifests } from "@/features/search/webmcp-tools";
import { createSavedToolManifests } from "@/features/saved/webmcp-tools";
import { queryApi } from "@/lib/query-client";
import { startOwnerActivityFeed } from "@/lib/owner-activity-feed";
import { searchInputToSearchParams, searchParamsToInput } from "@/lib/search-url";
import { subscribeToConfiguredSupabaseActivityWakeups } from "@/lib/supabase-activity-wakeup";
import {
  commitWebMcpJobDetail,
  commitWebMcpSchedule,
  commitWebMcpSearch,
  readSearchSurfaceState,
} from "@/lib/webmcp-ui-bridge";

import { resolveWebMcpRoute, type WebMcpRoute } from "./webmcp-route";

export type WebMcpRegistrationStatus = "checking" | "unsupported" | "preparing" | "ready" | "error";

export interface RegisteredToolSummary {
  readonly name: string;
  readonly purpose: string;
  readonly readOnly: boolean;
}

interface WebMcpContextValue {
  readonly activities: readonly ToolActivity[];
  readonly registeredToolCount: number;
  readonly registeredTools: readonly RegisteredToolSummary[];
  readonly retry: () => void;
  readonly status: WebMcpRegistrationStatus;
  readonly supported: boolean;
}

const emptyActivities: readonly ToolActivity[] = Object.freeze([]);
const emptyTools: readonly RegisteredToolSummary[] = Object.freeze([]);
const fallbackContext: WebMcpContextValue = {
  activities: emptyActivities,
  registeredToolCount: 0,
  registeredTools: emptyTools,
  retry: () => undefined,
  status: "checking",
  supported: false,
};

const WebMcpContext = createContext<WebMcpContextValue>(fallbackContext);

function currentCriteriaSearch(): string {
  const parameters = new URLSearchParams(window.location.search);
  parameters.delete("id");
  return parameters.toString();
}

function currentSearchInput() {
  return searchParamsToInput(new URLSearchParams(currentCriteriaSearch()));
}

function selectedComparisonIds(): readonly string[] {
  return new URLSearchParams(window.location.search).getAll("id");
}

function searchUrl(input: Parameters<typeof searchInputToSearchParams>[0]): string {
  const parameters = searchInputToSearchParams(input);
  return `/api/v1/jobs/search${parameters.size === 0 ? "" : `?${parameters.toString()}`}`;
}

function detailUrl(jobId: string): string {
  const parameters = searchInputToSearchParams(currentSearchInput());
  return `/api/v1/jobs/${encodeURIComponent(jobId)}${
    parameters.size === 0 ? "" : `?${parameters.toString()}`
  }`;
}

function routeManifests(
  route: WebMcpRoute,
  navigate: (href: string) => void,
): readonly ToolManifest<unknown, unknown>[] {
  if (route.kind === "search") {
    return createSearchToolManifests({
      searchJobs: (input, { signal }) =>
        queryApi(searchUrl(input), searchJobsResultSchema, { signal }),
      getSearchState: readSearchSurfaceState,
      onSearchCommitted: commitWebMcpSearch,
      onNavigate: navigate,
    });
  }

  if (route.kind === "detail") {
    return createJobDetailToolManifests({
      currentJobId: route.jobId,
      getJobDetails: (input, { signal }) =>
        queryApi(detailUrl(input.jobId), jobDetailResultSchema, { signal }),
      compareJobs: (input, { signal }) =>
        queryApi(compareApiUrl(input.jobIds, currentCriteriaSearch()), compareJobsResultSchema, {
          signal,
        }),
      onDetailCommitted: commitWebMcpJobDetail,
      onNavigate: navigate,
      getCriteriaSearch: currentCriteriaSearch,
    });
  }

  if (route.kind === "compare") {
    return createCompareToolManifests({
      selectedJobIds: selectedComparisonIds,
      getComparison: ({ signal }) =>
        queryApi(
          compareApiUrl(selectedComparisonIds(), currentCriteriaSearch()),
          compareJobsResultSchema,
          { signal },
        ),
      removeJobFromComparison: (jobId, { signal }) => {
        if (signal.aborted) return Promise.reject(new DOMException("Cancelled.", "AbortError"));
        return Promise.resolve({
          jobIds: selectedComparisonIds().filter((selectedId) => selectedId !== jobId),
        });
      },
      onComparisonCommitted: () => undefined,
      onNavigate: navigate,
      getCriteriaSearch: currentCriteriaSearch,
    });
  }

  if (route.kind === "saved") {
    return createSavedToolManifests({
      listSavedSearches: ({ signal }) =>
        queryApi("/api/v1/saved-searches", savedSearchSchema.array(), { signal }),
      listSchedules: ({ signal }) =>
        queryApi("/api/v1/schedules", jobAlertScheduleSchema.array(), { signal }),
      setScheduleEnabled: (scheduleId, input, { signal }) =>
        queryApi(`/api/v1/schedules/${encodeURIComponent(scheduleId)}`, jobAlertScheduleSchema, {
          method: "PATCH",
          body: input,
          signal,
        }),
      onScheduleCommitted: commitWebMcpSchedule,
    });
  }

  if (route.kind === "application") {
    const surface = readApplicationWebMcpSurface();
    if (surface === null || surface.currentState().draftId !== route.draftId) return [];
    return createApplicationToolManifests(surface);
  }

  return [];
}

export function WebMcpProvider({ children }: Readonly<{ children: ReactNode }>) {
  const pathname = usePathname();
  const router = useRouter();
  const [activitiesStore] = useState(() => new AgentActivityStore());
  const [status, setStatus] = useState<WebMcpRegistrationStatus>("checking");
  const [registeredTools, setRegisteredTools] = useState<readonly RegisteredToolSummary[]>(emptyTools);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  const retry = useCallback(() => setRegistrationRevision((revision) => revision + 1), []);

  useEffect(
    () =>
      subscribeApplicationWebMcpSurface(() => setRegistrationRevision((revision) => revision + 1)),
    [],
  );

  const subscribe = useCallback(
    (listener: () => void) => activitiesStore.subscribe(listener),
    [activitiesStore],
  );
  const getSnapshot = useCallback(() => activitiesStore.snapshot(), [activitiesStore]);
  const activities = useSyncExternalStore(subscribe, getSnapshot, () => emptyActivities);

  useEffect(() => {
    const feed = startOwnerActivityFeed({
      activities: activitiesStore,
      subscribeWakeups: subscribeToConfiguredSupabaseActivityWakeups,
    });
    return () => feed.stop();
  }, [activitiesStore]);

  useEffect(() => {
    setStatus("checking");
    setRegisteredTools(emptyTools);
    let modelContext: unknown;
    try {
      modelContext = (document as Document & { modelContext?: unknown }).modelContext;
      if (!isModelContextAvailable(modelContext)) throw new Error("WebMCP is unavailable.");
    } catch {
      setStatus("unsupported");
      setRegisteredTools(emptyTools);
      return;
    }

    const route = resolveWebMcpRoute(pathname);
    const manifests = routeManifests(route, (href) => router.push(href, { scroll: false }));
    if (manifests.length === 0) {
      setStatus("ready");
      setRegisteredTools(emptyTools);
      return;
    }

    let disposed = false;
    let unregister: (() => void) | undefined;
    const registrationController = new AbortController();
    setStatus("preparing");
    setRegisteredTools(emptyTools);

    void registerToolSet(manifests, {
      modelContext,
      activities: activitiesStore,
      signal: registrationController.signal,
    })
      .then((cleanup) => {
        if (disposed) {
          cleanup();
          return;
        }
        unregister = cleanup;
        setRegisteredTools(
          manifests.map((manifest) => ({
            name: manifest.name,
            purpose: manifest.purpose,
            readOnly: manifest.annotations.readOnlyHint,
          })),
        );
        setStatus("ready");
      })
      .catch(() => {
        if (disposed) return;
        setRegisteredTools(emptyTools);
        setStatus("error");
      });

    return () => {
      disposed = true;
      registrationController.abort();
      unregister?.();
    };
  }, [activitiesStore, pathname, registrationRevision, router]);

  const value = useMemo<WebMcpContextValue>(
    () => ({
      activities,
      registeredToolCount: registeredTools.length,
      registeredTools,
      retry,
      status,
      supported: status !== "checking" && status !== "unsupported",
    }),
    [activities, registeredTools, retry, status],
  );

  return <WebMcpContext.Provider value={value}>{children}</WebMcpContext.Provider>;
}

export function useWebMcp(): WebMcpContextValue {
  return useContext(WebMcpContext);
}
