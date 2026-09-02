"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import {
  applicationConsentWithdrawalSchema,
  applicationListSchema,
  applicationWorkspaceSchema,
  compareJobsResultSchema,
  completeEmailVerificationResultSchema,
  jobAlertScheduleSchema,
  jobDetailResultSchema,
  ownerSessionResultSchema,
  ownerActivityClearResultSchema,
  searchJobsResultSchema,
  startEmailVerificationResultSchema,
  startOwnerRecoveryResultSchema,
  type ToolActivity,
} from "@jobbbler/contracts";
import {
  AgentActivityStore,
  isModelContextAvailable,
  registerToolSet,
  type ToolManifest,
} from "@jobbbler/webmcp";

import { createCompareToolManifests } from "@/features/compare/webmcp-tools";
import { startApplication } from "@/features/application/start-application";
import { createStableApplicationToolManifests } from "@/features/application/webmcp-tools";
import {
  applicationAgentState,
  applicationNextAction,
  applicationReadiness,
} from "@/features/application/application-model";
import {
  readApplicationWebMcpSurface,
  waitForApplicationWebMcpSurface,
} from "@/features/application/webmcp-surface";
import { compareApiUrl } from "@/features/compare/compare-state";
import { createJobDetailToolManifests } from "@/features/job-detail/webmcp-tools";
import { createSearchToolManifests } from "@/features/search/webmcp-tools";
import {
  decideSearchAlert,
  deleteSavedSearch,
  requestSearchAlert,
} from "@/features/saved/search-alert-client";
import { createSavedWebMcpReadAdapter } from "@/features/saved/saved-webmcp-read-adapter";
import { saveJobSearchForAgent } from "@/features/saved/saved-search-client";
import { createSavedToolManifests } from "@/features/saved/webmcp-tools";
import { createSiteWideToolManifests } from "@/features/site-wide-webmcp-tools";
import { ApiClientError, queryApi } from "@/lib/query-client";
import {
  startOwnerActivityFeed,
  type OwnerActivityFeedController,
} from "@/lib/owner-activity-feed";
import {
  clearOwnerSessionMarker,
  hasOwnerSessionMarker,
  markOwnerSessionStarted,
} from "@/lib/owner-session-marker";
import { createWebMcpNavigator, type WebMcpNavigate } from "@/lib/webmcp-navigation";
import {
  searchHrefFromCriteria,
  searchInputToSearchParams,
  searchParamsToInput,
} from "@/lib/search-url";
import { subscribeToConfiguredSupabaseActivityWakeups } from "@/lib/supabase-activity-wakeup";
import {
  commitWebMcpJobDetail,
  commitWebMcpSavedSearch,
  commitWebMcpSavedSearchDeletion,
  commitWebMcpSchedule,
  commitWebMcpSearch,
  readSearchSurfaceState,
} from "@/lib/webmcp-ui-bridge";

import { latestSearchRunSchema } from "@/lib/latest-run";
import { createWorkflowPlannerTool } from "@/features/webmcp-workflows";

import { resolveWebMcpRoute, type WebMcpRoute } from "./webmcp-route";
import { composeStableWebMcpManifests, stableWebMcpCoreNames } from "./webmcp-registration";

function routeLabel(route: WebMcpRoute, pathname: string): string {
  if (route.kind === "search") return pathname === "/" ? "/" : "/jobs";
  if (route.kind === "detail") return "/jobs/:jobId";
  if (route.kind === "compare") return "/compare";
  if (route.kind === "saved") return "/saved";
  if (route.kind === "application") return "/apply/:draftId";
  return pathname;
}

export type WebMcpRegistrationStatus = "checking" | "unsupported" | "preparing" | "ready" | "error";

export interface RegisteredToolSummary {
  readonly name: string;
  readonly purpose: string;
  readonly readOnly: boolean;
}

interface WebMcpContextValue {
  readonly activities: readonly ToolActivity[];
  readonly clearActivities: () => Promise<void>;
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
  clearActivities: async () => undefined,
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

function searchManifests(navigate: WebMcpNavigate): readonly ToolManifest<unknown, unknown>[] {
  return createSearchToolManifests({
    searchJobs: (input, { signal }) =>
      queryApi(searchUrl(input), searchJobsResultSchema, { signal }),
    getSearchState: readSearchSurfaceState,
    onSearchCommitted: commitWebMcpSearch,
    onNavigate: navigate,
    getCriteriaSearch: currentCriteriaSearch,
  });
}

function detailManifests(
  currentJobId: string | undefined,
  navigate: WebMcpNavigate,
): readonly ToolManifest<unknown, unknown>[] {
  return createJobDetailToolManifests({
    ...(currentJobId === undefined ? {} : { currentJobId }),
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

function comparisonManifests(navigate: WebMcpNavigate): readonly ToolManifest<unknown, unknown>[] {
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

function savedManifests(navigate: WebMcpNavigate): readonly ToolManifest<unknown, unknown>[] {
  const reads = createSavedWebMcpReadAdapter();
  return createSavedToolManifests({
    listSavedSearches: reads.listSavedSearches,
    listSchedules: reads.listSchedules,
    saveSearch: saveJobSearchForAgent,
    requestSearchAlert,
    decideSearchAlert,
    setScheduleEnabled: (scheduleId, input, { signal }) =>
      queryApi(
        `/api/v1/agent/schedules/${encodeURIComponent(scheduleId)}/state`,
        jobAlertScheduleSchema,
        {
          method: "PATCH",
          body: input,
          signal,
        },
      ),
    deleteSavedSearch,
    onScheduleCommitted: commitWebMcpSchedule,
    onSavedSearchCommitted: commitWebMcpSavedSearch,
    onSavedSearchDeleted: commitWebMcpSavedSearchDeletion,
    savedSearchHref: (savedSearch) => searchHrefFromCriteria(savedSearch.criteria),
    onNavigate: navigate,
    getLatestRun: (savedSearchId, { signal }) =>
      queryApi(
        `/api/v1/saved-searches/${encodeURIComponent(savedSearchId)}/latest-run`,
        latestSearchRunSchema,
        { signal },
      ),
  });
}

export function WebMcpProvider({ children }: Readonly<{ children: ReactNode }>) {
  const router = useRouter();
  const [activitiesStore] = useState(() => new AgentActivityStore());
  const [status, setStatus] = useState<WebMcpRegistrationStatus>("checking");
  const [registeredTools, setRegisteredTools] =
    useState<readonly RegisteredToolSummary[]>(emptyTools);
  const [registrationRevision, setRegistrationRevision] = useState(0);
  const [activityFeedRevision, setActivityFeedRevision] = useState(0);
  const activityFeedRef = useRef<OwnerActivityFeedController | null>(null);
  const retry = useCallback(() => setRegistrationRevision((revision) => revision + 1), []);

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
    activityFeedRef.current = feed;
    return () => {
      if (activityFeedRef.current === feed) activityFeedRef.current = null;
      feed.stop();
    };
  }, [activitiesStore, activityFeedRevision]);

  const clearActivities = useCallback(async () => {
    activityFeedRef.current?.stop();
    try {
      if (hasOwnerSessionMarker()) {
        await queryApi("/api/v1/owners/activity", ownerActivityClearResultSchema, {
          method: "DELETE",
        });
      }
      activitiesStore.clear();
    } catch (error) {
      if (!(error instanceof ApiClientError) || error.code !== "UNAUTHORIZED") throw error;
      clearOwnerSessionMarker();
      activitiesStore.clear();
    } finally {
      setActivityFeedRevision((revision) => revision + 1);
    }
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

    const navigate = createWebMcpNavigator({
      navigate: (href) => router.push(href, { scroll: false }),
      // Native agent hosts clear a document's discovered-tool snapshot when
      // client-side navigation commits. Re-register the same global catalog so
      // the next agent turn sees every tool without requiring a full reload.
      onCommitted: retry,
    });
    const publicSearchTools = searchManifests(navigate);
    const publicDetailTools = detailManifests(undefined, navigate);
    const publicComparisonTools = comparisonManifests(navigate);
    const privateSavedTools = savedManifests(navigate);
    const privateApplicationTools = createStableApplicationToolManifests({
      currentSurface: readApplicationWebMcpSurface,
      async readApplication(draftId, { signal }) {
        try {
          const workspace = await queryApi(
            `/api/v1/applications/${encodeURIComponent(draftId)}`,
            applicationWorkspaceSchema,
            { signal },
          );
          const progress = applicationReadiness(workspace);
          const roleStatus = workspace.job?.status ?? "closed";
          const state = applicationAgentState(workspace, false, workspace.serverNow, roleStatus);
          return {
            state,
            roleStatus,
            missingFieldKeys: progress.missingFieldKeys,
            missingFieldLabels: progress.missingFieldKeys.map(
              (fieldKey) =>
                workspace.requirements.find((field) => field.fieldKey === fieldKey)?.label ??
                fieldKey,
            ),
            nextAction: applicationNextAction(workspace, workspace.serverNow, false, roleStatus),
          };
        } catch (error) {
          if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
            return null;
          }
          throw error;
        }
      },
      async withdrawConsent(draftId, { signal }) {
        return queryApi(
          `/api/v1/applications/${encodeURIComponent(draftId)}/consent`,
          applicationConsentWithdrawalSchema,
          {
            method: "DELETE",
            body: {
              interaction: {
                channel: "agent_client",
                requestId: `interaction_${crypto.randomUUID()}`,
                affirmation: "withdrawn",
                evidenceVersion: "agent-interaction-v1",
              },
            },
            signal,
          },
        );
      },
      onNavigate: navigate,
      waitForSurface: waitForApplicationWebMcpSurface,
    });
    const siteWideManifests = createSiteWideToolManifests({
      onNavigate: navigate,
      startApplication: async (jobId, { signal }) => {
        const result = await startApplication(
          jobId,
          { request: queryApi, navigate: (href) => navigate(href, { signal }) },
          { signal },
        );
        return {
          draftId: result.draft.id,
          href: `/apply/${encodeURIComponent(result.draft.id)}`,
          disposition: result.disposition,
          nextTool: "get_application_readiness" as const,
        };
      },
      startOwnerRecovery: (input, { signal }) =>
        queryApi("/api/v1/owners/recovery/start", startOwnerRecoveryResultSchema, {
          method: "POST",
          body: input,
          signal,
        }),
      completeOwnerRecovery: (input, { signal }) =>
        queryApi("/api/v1/owners/recovery/complete", ownerSessionResultSchema, {
          method: "POST",
          body: input,
          signal,
        }),
      startEmailVerification: (input, { signal }) =>
        queryApi("/api/v1/owners/email/start", startEmailVerificationResultSchema, {
          method: "POST",
          body: input,
          signal,
        }),
      completeEmailVerification: (input, { signal }) =>
        queryApi("/api/v1/owners/email/complete", completeEmailVerificationResultSchema, {
          method: "POST",
          body: input,
          signal,
        }),
      listApplications: ({ signal }) =>
        queryApi("/api/v1/applications", applicationListSchema, { signal }),
      onWorkspaceRecovered: markOwnerSessionStarted,
    });
    let manifests: readonly ToolManifest<unknown, unknown>[] = [];
    const planner = createWorkflowPlannerTool({
      route: () => {
        const currentPathname = window.location.pathname;
        return routeLabel(resolveWebMcpRoute(currentPathname), currentPathname);
      },
      availableTools: () => manifests.map(({ name }) => name),
    });
    const candidates = [planner, ...siteWideManifests, ...publicSearchTools];
    const candidateByName = new Map(candidates.map((manifest) => [manifest.name, manifest]));
    const coreManifests = stableWebMcpCoreNames.map((name) => {
      const manifest = candidateByName.get(name);
      if (manifest === undefined) throw new Error(`Missing stable WebMCP core tool: ${name}`);
      return manifest;
    });
    manifests = composeStableWebMcpManifests({
      core: coreManifests,
      search: publicSearchTools,
      detail: publicDetailTools,
      comparison: publicComparisonTools,
      saved: privateSavedTools,
      application: privateApplicationTools,
    });

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
  }, [activitiesStore, registrationRevision, retry, router]);

  const value = useMemo<WebMcpContextValue>(
    () => ({
      activities,
      clearActivities,
      registeredToolCount: registeredTools.length,
      registeredTools,
      retry,
      status,
      supported: status !== "checking" && status !== "unsupported",
    }),
    [activities, clearActivities, registeredTools, retry, status],
  );

  return <WebMcpContext.Provider value={value}>{children}</WebMcpContext.Provider>;
}

export function useWebMcp(): WebMcpContextValue {
  return useContext(WebMcpContext);
}
