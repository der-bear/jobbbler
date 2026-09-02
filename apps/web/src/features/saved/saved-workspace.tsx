"use client";

import {
  ArrowRightIcon,
  BellRingingIcon,
  BookmarkSimpleIcon,
  CalendarDotsIcon,
  CheckCircleIcon,
  ClockIcon,
  EnvelopeSimpleIcon,
  EyeIcon,
  LockKeyIcon,
  PauseIcon,
  PlayIcon,
  ShieldCheckIcon,
  SparkleIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { z } from "zod";

import {
  jobAlertScheduleSchema,
  ownerSessionResultSchema,
  savedSearchDeletionReceiptSchema,
  searchJobsResultSchema,
  verificationEndpointSummarySchema,
  type JobAlertSchedule,
  type JobSearchCriteria,
  type JobSearchInput,
  type OwnerSummary,
  type SavedSearch,
  type SavedSearchDeletionReceipt,
  type ScheduleRecurrence,
  type VerificationEndpointSummary,
  type Weekday,
} from "@jobbbler/contracts";
import { useToast } from "@jobbbler/ui";

import { markOwnerSessionStarted } from "@/lib/owner-session-marker";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { searchInputToSearchParams } from "@/lib/search-url";
import { categoryLabel, seniorityLabel, workModelLabel } from "@/lib/job-format";
import {
  subscribeWebMcpSavedSearch,
  subscribeWebMcpSavedSearchDeletion,
  subscribeWebMcpScheduleCommit,
} from "@/lib/webmcp-ui-bridge";
import type { LatestSearchRun } from "@/lib/latest-run";

import { EmailVerification } from "./email-verification";
import { OwnerPrivacyControls } from "./owner-privacy-controls";
import { saveSearchWithoutDelivery } from "./saved-search-client";
import {
  loadLatestSearchRuns,
  loadPrivateWorkspaceResources,
  loadSavedWorkspaceData,
  savedWorkspaceInitializationMode,
  type SavedWorkspaceInitialData,
  type SavedWorkspaceResources,
} from "./saved-workspace-loader";
import styles from "./saved-workspace.module.css";

const previewSchema = z.strictObject({
  recurrence: z.unknown(),
  nextRunAt: z.iso.datetime({ offset: true }),
  delivery: z.strictObject({
    channel: z.literal("email"),
    endpointId: z.string(),
    maskedDestination: z.string(),
  }),
});

const weekdayOptions: readonly {
  readonly value: Weekday;
  readonly label: string;
  readonly fullLabel: string;
}[] = [
  { value: "monday", label: "Mon", fullLabel: "Monday" },
  { value: "tuesday", label: "Tue", fullLabel: "Tuesday" },
  { value: "wednesday", label: "Wed", fullLabel: "Wednesday" },
  { value: "thursday", label: "Thu", fullLabel: "Thursday" },
  { value: "friday", label: "Fri", fullLabel: "Friday" },
  { value: "saturday", label: "Sat", fullLabel: "Saturday" },
  { value: "sunday", label: "Sun", fullLabel: "Sunday" },
];

interface ScheduleFormValues {
  readonly frequency: "daily" | "weekly";
  readonly time: string;
  readonly timeZone: string;
  readonly days: readonly Weekday[];
  readonly endpointId: string;
}

interface ScheduleReviewChange {
  readonly label: "Schedule" | "Destination";
  readonly previous: string;
  readonly next: string;
}

export function scheduleFormValues(schedule: JobAlertSchedule): ScheduleFormValues {
  return {
    frequency: schedule.recurrence.frequency,
    time: schedule.recurrence.time,
    timeZone: schedule.recurrence.timeZone,
    days: schedule.recurrence.frequency === "weekly" ? [...schedule.recurrence.days] : [],
    endpointId: schedule.delivery.endpointId,
  };
}

function scheduleTimingLabel(recurrence: ScheduleRecurrence): string {
  if (recurrence.frequency === "daily") {
    return `Daily at ${recurrence.time} (${recurrence.timeZone})`;
  }
  const selectedDays = weekdayOptions
    .filter(({ value }) => recurrence.days.includes(value))
    .map(({ label }) => label)
    .join(", ");
  return `Weekly on ${selectedDays} at ${recurrence.time} (${recurrence.timeZone})`;
}

export function scheduleReviewChanges(
  schedule: JobAlertSchedule,
  nextRecurrence: ScheduleRecurrence,
  nextEndpointId: string,
  previousDestination: string,
  nextDestination: string,
): readonly ScheduleReviewChange[] {
  const changes: ScheduleReviewChange[] = [];
  const previousTiming = scheduleTimingLabel(schedule.recurrence);
  const nextTiming = scheduleTimingLabel(nextRecurrence);
  if (previousTiming !== nextTiming) {
    changes.push({ label: "Schedule", previous: previousTiming, next: nextTiming });
  }
  if (schedule.delivery.endpointId !== nextEndpointId) {
    changes.push({
      label: "Destination",
      previous: previousDestination,
      next: nextDestination,
    });
  }
  return changes;
}

type Status = "loading" | "ready" | "working" | "error";

type StateUpdate<T> = (current: T) => T;

interface SavedWorkspaceCreationBindings {
  setSavedSearches(update: StateUpdate<readonly SavedSearch[]>): void;
  onCommitted(savedSearch: SavedSearch): void;
}

export function subscribeSavedWorkspaceCreation(
  bindings: SavedWorkspaceCreationBindings,
): () => void {
  return subscribeWebMcpSavedSearch((savedSearch) => {
    flushSync(() => {
      bindings.setSavedSearches((current) => [
        savedSearch,
        ...current.filter(({ id }) => id !== savedSearch.id),
      ]);
    });
    bindings.onCommitted(savedSearch);
  });
}

interface SavedWorkspaceDeletionBindings {
  setSavedSearches(update: StateUpdate<readonly SavedSearch[]>): void;
  setSchedules(update: StateUpdate<readonly JobAlertSchedule[]>): void;
  setLatestRuns(update: StateUpdate<ReadonlyMap<string, LatestSearchRun>>): void;
  onCommitted(receipt: SavedSearchDeletionReceipt): void;
}

export function subscribeSavedWorkspaceDeletion(
  bindings: SavedWorkspaceDeletionBindings,
): () => void {
  return subscribeWebMcpSavedSearchDeletion((receipt) => {
    flushSync(() => {
      bindings.setSavedSearches((current) =>
        current.filter(({ id }) => id !== receipt.savedSearchId),
      );
      bindings.setSchedules((current) =>
        current.filter(
          (schedule) =>
            schedule.savedSearchId !== receipt.savedSearchId && schedule.id !== receipt.scheduleId,
        ),
      );
      bindings.setLatestRuns((current) => {
        const next = new Map(current);
        next.delete(receipt.savedSearchId);
        return next;
      });
    });
    bindings.onCommitted(receipt);
  });
}

export function privateAccessCopy(
  owner: OwnerSummary | null,
  endpoints: readonly VerificationEndpointSummary[],
): Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}> {
  if (owner === null) {
    return {
      eyebrow: "Only you can see this",
      title: "No account needed",
      description:
        "Save searches and applications without creating an account. Add email only for updates or to restore access on another device.",
    };
  }
  if (
    !owner.verified ||
    !endpoints.some(({ status: endpointStatus }) => endpointStatus === "verified")
  ) {
    return {
      eyebrow: "Only you can see this",
      title: "Available in this browser",
      description:
        "This browser can open your saved searches and applications. Add email only for updates or to restore access on another device.",
    };
  }
  return {
    eyebrow: "Verified email",
    title: "Access from another device",
    description:
      "Use your verified email to restore saved searches and applications. Email updates are still optional.",
  };
}

export function savedComposerPresentation({
  hasExistingSavedSearch,
  isEditingSchedule,
}: Readonly<{
  hasExistingSavedSearch: boolean;
  isEditingSchedule: boolean;
}>): Readonly<{
  title: "Save this search" | "Add email updates" | "Edit email updates";
  showSearchSetup: boolean;
}> {
  if (isEditingSchedule) {
    return { title: "Edit email updates", showSearchSetup: false };
  }
  if (hasExistingSavedSearch) {
    return { title: "Add email updates", showSearchSetup: false };
  }
  return { title: "Save this search", showSearchSetup: true };
}

function message(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "Something went wrong. Your saved searches are unchanged.";
}

/*
 * Every zone the browser knows, for the picker under the time-zone field. The
 * field is prefilled with the browser's own zone, so most people never open
 * it; the list is there so nobody has to type "Europe/Kyiv" from memory.
 */
function knownTimeZones(): readonly string[] {
  try {
    return typeof Intl.supportedValuesOf === "function" ? Intl.supportedValuesOf("timeZone") : [];
  } catch {
    return [];
  }
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

export function displayInstant(value: string, timeZone = "UTC"): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function deliveryLabel(status: string): string {
  switch (status) {
    case "pending":
      return "Email queued";
    case "sending":
      return "Sending the email…";
    case "accepted":
      return "Email sent";
    case "failed":
      return "Email failed — retrying";
    case "dead":
      return "Email could not be delivered";
    default:
      return "Email cancelled";
  }
}

function criteriaInput(criteria: JobSearchCriteria): JobSearchInput {
  return {
    ...(criteria.query === null ? {} : { query: criteria.query }),
    categories: criteria.categories,
    workModels: criteria.workModels,
    seniorities: criteria.seniorities,
    locations: criteria.locations,
    skills: criteria.skills,
    excludeKeywords: criteria.excludeKeywords,
    ...(criteria.salary === null
      ? {}
      : {
          salary: {
            ...(criteria.salary.minimum === null ? {} : { minimum: criteria.salary.minimum }),
            ...(criteria.salary.maximum === null ? {} : { maximum: criteria.salary.maximum }),
            ...(criteria.salary.currency === null ? {} : { currency: criteria.salary.currency }),
            period: criteria.salary.period,
            unknownPolicy: criteria.salary.unknownPolicy,
          },
        }),
    ...(criteria.postedWithinDays === null ? {} : { postedWithinDays: criteria.postedWithinDays }),
    sort: criteria.sort,
    limit: criteria.limit,
  };
}

function searchHref(criteria: JobSearchCriteria): string {
  const parameters = searchInputToSearchParams(criteriaInput(criteria));
  return parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
}

export function savedSearchCriteriaSummary(criteria: JobSearchCriteria): readonly string[] {
  const summary: string[] = [];
  if (criteria.query !== null) summary.push(criteria.query);
  summary.push(...criteria.categories.map(categoryLabel));
  summary.push(...criteria.workModels.map(workModelLabel));
  summary.push(...criteria.seniorities.map(seniorityLabel));
  summary.push(...criteria.locations);
  if (criteria.salary?.minimum !== null && criteria.salary?.minimum !== undefined) {
    summary.push(
      `${criteria.salary.currency ?? ""} ${Intl.NumberFormat("en").format(criteria.salary.minimum)}+`,
    );
  }
  return summary.slice(0, 6);
}

function compactGroup<T>(values: readonly T[], label: (value: T) => string): string {
  const visible = values.slice(0, 3).map(label);
  if (values.length > visible.length) visible.push(`+${String(values.length - visible.length)}`);
  return visible.join(" / ");
}

export function defaultSavedSearchName(criteria: JobSearchCriteria): string {
  const query = criteria.query?.trim();
  if (query !== undefined && query.length > 0) return query.slice(0, 100);

  const seniority = compactGroup(criteria.seniorities, seniorityLabel);
  const category = compactGroup(criteria.categories, categoryLabel) || "Technology";
  const workModel = compactGroup(criteria.workModels, workModelLabel);
  const location = compactGroup(criteria.locations, (value) => value);
  const focus = [seniority, category].filter(Boolean).join(" ");
  const context = [workModel, location].filter(Boolean);
  return `${focus} roles${context.length === 0 ? "" : ` · ${context.join(" · ")}`}`.slice(0, 100);
}

export function SavedWorkspace({
  initialData,
  searchParamsKey = "",
}: Readonly<{ initialData?: SavedWorkspaceInitialData | null; searchParamsKey?: string }>) {
  const router = useRouter();
  const toast = useToast();
  const createRequested = new URLSearchParams(searchParamsKey).get("create") === "1";
  const [status, setStatus] = useState<Status>(
    initialData === undefined || createRequested ? "loading" : "ready",
  );
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<OwnerSummary | null>(initialData?.owner ?? null);
  const [endpoints, setEndpoints] = useState<readonly VerificationEndpointSummary[]>(
    initialData?.endpoints ?? [],
  );
  const [savedSearches, setSavedSearches] = useState<readonly SavedSearch[]>(
    initialData?.savedSearches ?? [],
  );
  const [schedules, setSchedules] = useState<readonly JobAlertSchedule[]>(
    initialData?.schedules ?? [],
  );
  const [latestRuns, setLatestRuns] = useState<ReadonlyMap<string, LatestSearchRun>>(new Map());
  const [criteria, setCriteria] = useState<JobSearchCriteria | null>(null);
  const [name, setName] = useState("");
  const [emailUpdates, setEmailUpdates] = useState(false);
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [time, setTime] = useState("09:00");
  const [timeZone, setTimeZone] = useState(localTimeZone);
  const timeZoneOptions = useMemo(knownTimeZones, []);
  const [days, setDays] = useState<readonly Weekday[]>(["monday", "wednesday", "friday"]);
  const [endpointId, setEndpointId] = useState("");
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const removeEmailButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const [pendingSaved, setPendingSaved] = useState<SavedSearch | null>(null);
  const [editingSchedule, setEditingSchedule] = useState<JobAlertSchedule | null>(null);
  const [pendingRemoveId, setPendingRemoveId] = useState<string | null>(null);
  const [removePhrase, setRemovePhrase] = useState("");
  const removeInputRef = useRef<HTMLInputElement | null>(null);
  const removeButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const editUpdatesButtonRefs = useRef(new Map<string, HTMLButtonElement>());
  const previewRef = useRef<HTMLDivElement | null>(null);
  const libraryRef = useRef<HTMLElement | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);

  useEffect(() => {
    if (initialData !== null && initialData !== undefined) markOwnerSessionStarted();
  }, [initialData]);

  const applyPrivateResources = useCallback((resources: SavedWorkspaceResources) => {
    setEndpoints(resources.endpoints);
    setSavedSearches(resources.savedSearches);
    setSchedules(resources.schedules);
    void resources.latestRuns.then(setLatestRuns);
    const verified = resources.endpoints.find(
      ({ status: endpointStatus }) => endpointStatus === "verified",
    );
    if (verified !== undefined) setEndpointId(verified.id);
  }, []);

  const loadPrivateResources = useCallback(async () => {
    applyPrivateResources(await loadPrivateWorkspaceResources());
  }, [applyPrivateResources]);

  const startPrivateWorkspace = useCallback(async () => {
    const current = await queryApi("/api/v1/owners/session", ownerSessionResultSchema, {
      method: "POST",
    });
    markOwnerSessionStarted(current.expiresAt);
    await loadPrivateResources();
    setOwner(current.owner);
    return current.owner;
  }, [loadPrivateResources]);

  useEffect(() => {
    const initializationMode = savedWorkspaceInitializationMode(initialData, createRequested);
    if (initializationMode === "none") return undefined;
    let cancelled = false;
    async function initialize() {
      setStatus("loading");
      setError(null);
      try {
        const criteriaRequest = createRequested
          ? (() => {
              const parameters = new URLSearchParams(searchParamsKey);
              parameters.delete("create");
              return queryApi(
                `/api/v1/jobs/search${parameters.size === 0 ? "" : `?${parameters.toString()}`}`,
                searchJobsResultSchema,
              );
            })()
          : Promise.resolve(null);
        const workspaceRequest =
          initializationMode === "load"
            ? loadSavedWorkspaceData().then((value) => ({ kind: "loaded" as const, value }))
            : initializationMode === "create"
              ? startPrivateWorkspace().then(() => ({ kind: "created" as const }))
              : Promise.resolve({ kind: "reused" as const });
        const [criteriaResult, workspaceResult] = await Promise.allSettled([
          criteriaRequest,
          workspaceRequest,
        ]);
        if (cancelled) return;
        if (criteriaResult.status === "rejected") throw criteriaResult.reason;
        if (criteriaResult.value !== null) {
          setCriteria(criteriaResult.value.criteria);
          setName(defaultSavedSearchName(criteriaResult.value.criteria));
        }
        if (workspaceResult.status === "fulfilled") {
          if (workspaceResult.value.kind === "loaded") {
            applyPrivateResources(workspaceResult.value.value);
            setOwner(workspaceResult.value.value.owner);
          }
        } else if (
          initializationMode === "load" &&
          workspaceResult.reason instanceof ApiClientError &&
          workspaceResult.reason.code === "UNAUTHORIZED"
        ) {
          if (createRequested) await startPrivateWorkspace();
        } else {
          throw workspaceResult.reason;
        }
        if (!cancelled) setStatus("ready");
      } catch (caught) {
        if (!cancelled) {
          setError(message(caught));
          setStatus("error");
        }
      }
    }
    void initialize();
    return () => {
      cancelled = true;
    };
  }, [applyPrivateResources, createRequested, initialData, searchParamsKey, startPrivateWorkspace]);

  useEffect(() => {
    if (initialData === undefined || initialData === null || createRequested) return undefined;
    let cancelled = false;
    void loadLatestSearchRuns(initialData.savedSearches, initialData.schedules)
      .then((runs) => {
        if (!cancelled) setLatestRuns(runs);
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [createRequested, initialData]);

  useEffect(
    () =>
      subscribeSavedWorkspaceCreation({
        setSavedSearches,
        onCommitted: () => {
          toast.show({
            title: "Search saved by agent",
            description: "Email updates are off.",
            tone: "success",
          });
        },
      }),
    [toast],
  );

  useEffect(
    () =>
      subscribeWebMcpScheduleCommit((updated) => {
        setSchedules((current) => {
          const exists = current.some(({ id }) => id === updated.id);
          return exists
            ? current.map((schedule) => (schedule.id === updated.id ? updated : schedule))
            : [updated, ...current];
        });
        toast.show({
          title: updated.enabled ? "Email updates resumed" : "Email updates paused",
          description: "This page now shows your latest saved state.",
          tone: "success",
        });
      }),
    [toast],
  );

  useEffect(
    () =>
      subscribeSavedWorkspaceDeletion({
        setSavedSearches,
        setSchedules,
        setLatestRuns,
        onCommitted: () => {
          toast.show({
            title: "Saved search deleted by agent",
            description: "This page now shows your latest saved state.",
            tone: "success",
          });
        },
      }),
    [toast],
  );

  const verifiedEndpoints = useMemo(
    () => endpoints.filter(({ status: endpointStatus }) => endpointStatus === "verified"),
    [endpoints],
  );

  async function revokeEndpoint(endpoint: VerificationEndpointSummary) {
    setStatus("working");
    setError(null);
    try {
      const revoked = await queryApi(
        `/api/v1/owners/email/${encodeURIComponent(endpoint.id)}`,
        verificationEndpointSummarySchema,
        { method: "DELETE" },
      );
      setEndpoints((current) => current.map((item) => (item.id === revoked.id ? revoked : item)));
      setPendingRevokeId(null);
      if (endpointId === revoked.id) setEndpointId("");
      await loadPrivateResources();
      setStatus("ready");
      toast.show({
        title: "Email removed",
        description: "Email updates to this address were paused. Verify an email to resume them.",
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }
  const scheduleBySearch = useMemo(
    () => new Map(schedules.map((schedule) => [schedule.savedSearchId, schedule])),
    [schedules],
  );

  function recurrence(): ScheduleRecurrence {
    return frequency === "daily"
      ? { frequency, time, timeZone }
      : { frequency, time, timeZone, days: [...days] };
  }

  async function previewAlert(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (criteria === null || endpointId.length === 0) return;
    setStatus("working");
    setError(null);
    try {
      const saved = pendingSaved ?? (await saveSearchWithoutDelivery({ name, criteria }));
      setPendingSaved(saved);
      if (!savedSearches.some(({ id }) => id === saved.id)) {
        setSavedSearches((current) => [saved, ...current]);
      }
      const nextPreview = await queryApi("/api/v1/schedules/preview", previewSchema, {
        method: "POST",
        body: {
          savedSearchId: saved.id,
          expectedVersion: saved.version,
          recurrence: recurrence(),
          delivery: { channel: "email", endpointId },
        },
      });
      setPreview(nextPreview);
      setStatus("ready");
      window.requestAnimationFrame(() => previewRef.current?.focus());
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  async function activateAlert() {
    if (pendingSaved === null || preview === null) return;
    const nextRecurrence = recurrence();
    const previousDestination =
      endpoints.find(({ id }) => id === editingSchedule?.delivery.endpointId)?.maskedDestination ??
      "Previous email destination";
    const nextDestination =
      endpoints.find(({ id }) => id === endpointId)?.maskedDestination ??
      "Selected email destination";
    const changes =
      editingSchedule === null
        ? []
        : scheduleReviewChanges(
            editingSchedule,
            nextRecurrence,
            endpointId,
            previousDestination,
            nextDestination,
          );
    if (editingSchedule !== null && changes.length === 0) return;
    setStatus("working");
    setError(null);
    try {
      const scheduled =
        editingSchedule === null
          ? await queryApi("/api/v1/schedules", jobAlertScheduleSchema, {
              method: "POST",
              body: {
                savedSearchId: pendingSaved.id,
                expectedVersion: pendingSaved.version,
                recurrence: nextRecurrence,
                delivery: { channel: "email", endpointId },
              },
            })
          : await queryApi(
              `/api/v1/schedules/${encodeURIComponent(editingSchedule.id)}`,
              jobAlertScheduleSchema,
              {
                method: "PATCH",
                body: {
                  expectedVersion: editingSchedule.version,
                  ...(changes.some(({ label }) => label === "Schedule")
                    ? { recurrence: nextRecurrence }
                    : {}),
                  ...(changes.some(({ label }) => label === "Destination")
                    ? { delivery: { channel: "email", endpointId } }
                    : {}),
                },
              },
            );
      setSchedules((current) =>
        editingSchedule === null
          ? [scheduled, ...current]
          : current.map((item) => (item.id === scheduled.id ? scheduled : item)),
      );
      setPreview(null);
      setPendingSaved(null);
      setEditingSchedule(null);
      setCriteria(null);
      setEmailUpdates(false);
      setStatus("ready");
      window.history.replaceState({}, "", "/saved");
      toast.show({
        title: editingSchedule === null ? "Email updates are on" : "Email updates changed",
        description: `${editingSchedule === null ? "The first" : "The next"} check is scheduled for ${displayInstant(scheduled.nextRunAt, scheduled.recurrence.timeZone)}.`,
        tone: "success",
      });
      if (editingSchedule !== null) {
        window.requestAnimationFrame(() =>
          editUpdatesButtonRefs.current.get(editingSchedule.id)?.focus(),
        );
      }
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  async function saveCurrentSearch(): Promise<void> {
    if (criteria === null || name.trim().length === 0 || status === "working") return;
    setStatus("working");
    setError(null);
    try {
      if (owner === null) await startPrivateWorkspace();
      const saved = pendingSaved ?? (await saveSearchWithoutDelivery({ name, criteria }));
      setSavedSearches((current) =>
        current.some(({ id }) => id === saved.id) ? current : [saved, ...current],
      );
      setPendingSaved(null);
      setEditingSchedule(null);
      setPreview(null);
      setCriteria(null);
      setEmailUpdates(false);
      setStatus("ready");
      window.history.replaceState({}, "", "/saved");
      toast.show({
        title: "Search saved",
        description: "You can reopen it anytime. Email updates stay off until you turn them on.",
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  function configureEmailUpdates(saved: SavedSearch): void {
    setCriteria(saved.criteria);
    setName(saved.name);
    setPendingSaved(saved);
    setEditingSchedule(null);
    setPreview(null);
    setEmailUpdates(true);
    setError(null);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-saved-composer]`)?.focus(),
    );
  }

  function editEmailUpdates(saved: SavedSearch, schedule: JobAlertSchedule): void {
    const values = scheduleFormValues(schedule);
    const availableEndpointId = verifiedEndpoints.some(({ id }) => id === values.endpointId)
      ? values.endpointId
      : (verifiedEndpoints[0]?.id ?? values.endpointId);
    setCriteria(saved.criteria);
    setName(saved.name);
    setPendingSaved(saved);
    setEditingSchedule(schedule);
    setFrequency(values.frequency);
    setTime(values.time);
    setTimeZone(values.timeZone);
    setDays(values.days);
    setEndpointId(availableEndpointId);
    setPreview(null);
    setEmailUpdates(true);
    setError(null);
    window.requestAnimationFrame(() =>
      document.querySelector<HTMLElement>(`[data-saved-composer]`)?.focus(),
    );
  }

  async function toggleSchedule(schedule: JobAlertSchedule) {
    setStatus("working");
    setError(null);
    try {
      const updated = await queryApi(`/api/v1/schedules/${schedule.id}`, jobAlertScheduleSchema, {
        method: "PATCH",
        body: { expectedVersion: schedule.version, enabled: !schedule.enabled },
      });
      setSchedules((current) => current.map((item) => (item.id === updated.id ? updated : item)));
      setStatus("ready");
      toast.show({
        title: updated.enabled ? "Email updates resumed" : "Email updates paused",
        description: updated.enabled
          ? `Next check: ${displayInstant(updated.nextRunAt, updated.recurrence.timeZone)}.`
          : "No checks or emails will run until you resume it.",
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  function beginRemoveSavedSearch(saved: SavedSearch): void {
    setPendingRemoveId(saved.id);
    setRemovePhrase("");
    window.requestAnimationFrame(() => removeInputRef.current?.focus());
  }

  function cancelRemoveSavedSearch(savedSearchId: string): void {
    setPendingRemoveId(null);
    setRemovePhrase("");
    window.requestAnimationFrame(() => removeButtonRefs.current.get(savedSearchId)?.focus());
  }

  async function removeSavedSearch(saved: SavedSearch): Promise<void> {
    if (removePhrase !== saved.name || status === "working") return;
    setStatus("working");
    setError(null);
    try {
      const receipt = await queryApi(
        `/api/v1/saved-searches/${encodeURIComponent(saved.id)}`,
        savedSearchDeletionReceiptSchema,
        { method: "DELETE" },
      );
      setSavedSearches((current) => current.filter(({ id }) => id !== receipt.savedSearchId));
      setSchedules((current) =>
        current.filter(
          (schedule) =>
            schedule.savedSearchId !== receipt.savedSearchId && schedule.id !== receipt.scheduleId,
        ),
      );
      setLatestRuns((current) => {
        const next = new Map(current);
        next.delete(receipt.savedSearchId);
        return next;
      });
      setPendingRemoveId(null);
      setRemovePhrase("");
      setStatus("ready");
      toast.show({
        title: "Saved search removed",
        description:
          receipt.scheduleId === null
            ? "Everything else you saved is unchanged."
            : "Its email updates are off. Everything else you saved is unchanged.",
        tone: "success",
      });
      window.requestAnimationFrame(() => libraryRef.current?.focus());
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  const composing = criteria !== null;
  const accessCopy = privateAccessCopy(owner, endpoints);
  const composerPresentation = savedComposerPresentation({
    hasExistingSavedSearch: pendingSaved !== null,
    isEditingSchedule: editingSchedule !== null,
  });
  const nextRecurrence = recurrence();
  const previousDestination =
    endpoints.find(({ id }) => id === editingSchedule?.delivery.endpointId)?.maskedDestination ??
    "Previous email destination";
  const nextDestination =
    endpoints.find(({ id }) => id === endpointId)?.maskedDestination ??
    "Selected email destination";
  const reviewChanges =
    editingSchedule === null
      ? []
      : scheduleReviewChanges(
          editingSchedule,
          nextRecurrence,
          endpointId,
          previousDestination,
          nextDestination,
        );

  return (
    <div className={styles["workspace"]}>
      <section className={styles["intro"]}>
        <div>
          <h1>Saved searches</h1>
          <p className={styles["lede"]}>
            Keep useful searches in one place. Email updates are optional.
          </p>
        </div>
        <aside className={styles["identityCard"]} aria-label="Saved search access">
          <div className={styles["identityHeading"]}>
            <ShieldCheckIcon aria-hidden="true" size={22} weight="fill" />
            <div>
              <span>{accessCopy.eyebrow}</span>
              <strong>{accessCopy.title}</strong>
            </div>
          </div>
          <p>{accessCopy.description}</p>
          {owner !== null && verifiedEndpoints.length > 0 ? (
            <div className={styles["endpointList"]} aria-label="Verified emails">
              {verifiedEndpoints.map((endpoint) => (
                <div
                  data-confirming={pendingRevokeId === endpoint.id || undefined}
                  key={endpoint.id}
                >
                  <span>
                    <EnvelopeSimpleIcon aria-hidden="true" size={14} />
                    {endpoint.maskedDestination}
                  </span>
                  {pendingRevokeId === endpoint.id ? (
                    <div
                      aria-label="Remove verified email"
                      className={styles["revokePrompt"]}
                      role="group"
                    >
                      <strong>Remove this email?</strong>
                      <p>
                        Email updates using it will stop, and you will no longer be able to restore
                        with it.
                      </p>
                      <span className={styles["revokeActions"]}>
                        <button
                          onClick={() => {
                            setPendingRevokeId(null);
                            window.requestAnimationFrame(() =>
                              removeEmailButtonRefs.current.get(endpoint.id)?.focus(),
                            );
                          }}
                          type="button"
                        >
                          Keep email
                        </button>
                        <button
                          aria-label={`Remove verified email ${endpoint.maskedDestination}`}
                          disabled={status === "working"}
                          onClick={() => void revokeEndpoint(endpoint)}
                          type="button"
                        >
                          Remove email
                        </button>
                      </span>
                    </div>
                  ) : (
                    <button
                      aria-label={`Remove verified email ${endpoint.maskedDestination}`}
                      onClick={() => setPendingRevokeId(endpoint.id)}
                      ref={(node) => {
                        if (node === null) removeEmailButtonRefs.current.delete(endpoint.id);
                        else removeEmailButtonRefs.current.set(endpoint.id, node);
                      }}
                      type="button"
                    >
                      Remove email
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {status === "loading" ? null : (
            <OwnerPrivacyControls
              hasVerifiedRecoveryEmail={verifiedEndpoints.length > 0}
              onDeleted={() => {
                setOwner(null);
                setEndpoints([]);
                setSavedSearches([]);
                setSchedules([]);
                setLatestRuns(new Map());
                router.replace("/saved");
                toast.show({
                  title: "Private data deleted",
                  description: "Everything you saved here has been deleted.",
                  tone: "success",
                });
              }}
              onRecovered={(recoveredOwner) => {
                void loadPrivateResources()
                  .then(() => {
                    setOwner(recoveredOwner);
                    toast.show({
                      title: "Saved items restored",
                      description: "Your saved searches and applications are back on this browser.",
                      tone: "success",
                    });
                  })
                  .catch((caught: unknown) => setError(message(caught)));
              }}
              onRecoveryEmailEnabled={(verifiedOwner) => {
                void loadPrivateResources()
                  .then(() => {
                    setOwner(verifiedOwner);
                    toast.show({
                      title: "Email added",
                      description:
                        "You can now restore saved searches and applications on another device.",
                      tone: "success",
                    });
                  })
                  .catch((caught: unknown) => setError(message(caught)));
              }}
              owner={owner}
            />
          )}
        </aside>
      </section>

      {error !== null ? (
        <div className={styles["error"]} role="alert">
          <WarningCircleIcon aria-hidden="true" size={20} />
          <span>{error}</span>
        </div>
      ) : null}

      {status === "loading" ? (
        <div className={styles["loading"]} role="status">
          <span />
          Loading saved searches…
        </div>
      ) : null}

      {status === "loading" ? null : (
        <div className={styles["content"]}>
          {composing ? (
            <section
              aria-labelledby="composer-title"
              className={styles["composer"]}
              data-saved-composer
              tabIndex={-1}
            >
              <div className={styles["sectionHeading"]}>
                <h2 id="composer-title">{composerPresentation.title}</h2>
                <button
                  className={styles["quietButton"]}
                  onClick={() => {
                    const scheduleId = editingSchedule?.id;
                    setCriteria(null);
                    setPendingSaved(null);
                    setEditingSchedule(null);
                    setPreview(null);
                    setEmailUpdates(false);
                    router.replace("/saved");
                    if (scheduleId !== undefined) {
                      window.requestAnimationFrame(() =>
                        editUpdatesButtonRefs.current.get(scheduleId)?.focus(),
                      );
                    }
                  }}
                  type="button"
                >
                  Cancel
                </button>
              </div>

              <div className={styles["criteria"]} aria-label="Search criteria">
                {savedSearchCriteriaSummary(criteria).map((item) => (
                  <span key={item}>{item}</span>
                ))}
              </div>

              {composerPresentation.showSearchSetup ? (
                <div className={styles["form"]}>
                  <label>
                    <span>Search name</span>
                    <input
                      maxLength={100}
                      onChange={(event) => setName(event.target.value)}
                      required
                      value={name}
                    />
                  </label>
                  <label className={styles["choice"]}>
                    <input
                      checked={emailUpdates}
                      onChange={(event) => {
                        setEmailUpdates(event.target.checked);
                        setPreview(null);
                      }}
                      type="checkbox"
                    />
                    <span>
                      <strong>Email me when results change</strong>
                      <small>Optional. Your saved search works without email.</small>
                    </span>
                  </label>
                </div>
              ) : null}

              {!emailUpdates ? (
                <button
                  className={styles["primaryButton"]}
                  disabled={status === "working" || name.trim().length === 0}
                  onClick={() => void saveCurrentSearch()}
                  type="button"
                >
                  Save search
                  <BookmarkSimpleIcon aria-hidden="true" size={16} />
                </button>
              ) : verifiedEndpoints.length === 0 ? (
                <div className={styles["verification"]}>
                  <div className={styles["privacyNote"]}>
                    <LockKeyIcon aria-hidden="true" size={18} />
                    <p>
                      We use this address only for email updates and to get you back in. You can
                      remove it at any time.
                    </p>
                  </div>
                  <EmailVerification
                    classNames={{
                      error: styles["verificationError"],
                      form: styles["form"],
                      hint: styles["hint"],
                      submitButton: styles["primaryButton"],
                    }}
                    disabled={status === "working"}
                    intent="updates"
                    onBusyChange={(busy) => setStatus(busy ? "working" : "ready")}
                    onVerified={async (verifiedOwner) => {
                      setOwner(verifiedOwner);
                      await loadPrivateResources();
                      toast.show({
                        title: "Email verified",
                        description:
                          "Saved searches can now be restored and sent as email updates.",
                        tone: "success",
                      });
                    }}
                    sendIcon={<ArrowRightIcon aria-hidden="true" size={16} />}
                    toErrorMessage={message}
                    verifyIcon={<CheckCircleIcon aria-hidden="true" size={16} />}
                  />
                </div>
              ) : preview === null ? (
                <form className={styles["form"]} onSubmit={previewAlert}>
                  <div className={styles["formGrid"]}>
                    <label>
                      <span>How often</span>
                      <select
                        onChange={(event) => setFrequency(event.target.value as "daily" | "weekly")}
                        value={frequency}
                      >
                        <option value="daily">Daily</option>
                        <option value="weekly">Weekly</option>
                      </select>
                    </label>
                    <label>
                      <span>Local time</span>
                      <input
                        onChange={(event) => setTime(event.target.value)}
                        required
                        type="time"
                        value={time}
                      />
                    </label>
                  </div>
                  {frequency === "weekly" ? (
                    <fieldset className={styles["weekdayFieldset"]}>
                      <legend>Days</legend>
                      <div>
                        {weekdayOptions.map((option) => (
                          <label key={option.value}>
                            <input
                              aria-label={option.fullLabel}
                              checked={days.includes(option.value)}
                              onChange={() =>
                                setDays((current) =>
                                  current.includes(option.value)
                                    ? current.filter((day) => day !== option.value)
                                    : [...current, option.value],
                                )
                              }
                              type="checkbox"
                            />
                            <span>{option.label}</span>
                          </label>
                        ))}
                      </div>
                    </fieldset>
                  ) : null}
                  {frequency === "weekly" && days.length === 0 ? (
                    <p className={styles["fieldError"]} role="alert">
                      Select at least one day.
                    </p>
                  ) : null}
                  <label>
                    <span>Time zone</span>
                    <input
                      list="saved-search-time-zones"
                      onChange={(event) => setTimeZone(event.target.value)}
                      required
                      value={timeZone}
                    />
                    <datalist id="saved-search-time-zones">
                      {timeZoneOptions.map((zone) => (
                        <option key={zone} value={zone} />
                      ))}
                    </datalist>
                  </label>
                  <label>
                    <span>Send updates to</span>
                    <select
                      onChange={(event) => setEndpointId(event.target.value)}
                      value={endpointId}
                    >
                      {verifiedEndpoints.map((endpoint) => (
                        <option key={endpoint.id} value={endpoint.id}>
                          {endpoint.maskedDestination}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    className={styles["primaryButton"]}
                    disabled={
                      status === "working" ||
                      name.trim().length === 0 ||
                      (frequency === "weekly" && days.length === 0)
                    }
                  >
                    {editingSchedule === null ? "Review email updates" : "Review changes"}
                    <EyeIcon aria-hidden="true" size={16} />
                  </button>
                </form>
              ) : (
                <div
                  aria-label={editingSchedule === null ? "Review email updates" : "Review changes"}
                  className={styles["preview"]}
                  ref={previewRef}
                  role="region"
                  tabIndex={-1}
                >
                  <div className={styles["previewRow"]}>
                    <CalendarDotsIcon aria-hidden="true" size={19} />
                    <span>{editingSchedule === null ? "First check" : "Next check"}</span>
                    <strong>{displayInstant(preview.nextRunAt, timeZone)}</strong>
                  </div>
                  {editingSchedule === null ? (
                    <div className={styles["previewRow"]}>
                      <EnvelopeSimpleIcon aria-hidden="true" size={19} />
                      <span>Destination</span>
                      <strong>{preview.delivery.maskedDestination}</strong>
                    </div>
                  ) : (
                    reviewChanges.map((change) => (
                      <div className={styles["previewRow"]} key={change.label}>
                        {change.label === "Schedule" ? (
                          <ClockIcon aria-hidden="true" size={19} />
                        ) : (
                          <EnvelopeSimpleIcon aria-hidden="true" size={19} />
                        )}
                        <span>{change.label}</span>
                        <strong
                          aria-label={`${change.label} changes from ${change.previous} to ${change.next}`}
                          className={styles["changeValue"]}
                        >
                          <s aria-hidden="true">{change.previous}</s>
                          <ArrowRightIcon aria-hidden="true" size={13} />
                          <span aria-hidden="true">{change.next}</span>
                        </strong>
                      </div>
                    ))
                  )}
                  <div className={styles["previewRow"]}>
                    <SparkleIcon aria-hidden="true" size={19} />
                    <span>We email you</span>
                    <strong>Only when something changes</strong>
                  </div>
                  <p>
                    {editingSchedule !== null && reviewChanges.length === 0
                      ? "Nothing has changed yet. Go back to edit the schedule."
                      : "Jobbbler checks this search for you and emails only when the results change. You can pause or delete it any time, here or from your agent."}
                  </p>
                  <div className={styles["buttonRow"]}>
                    <button
                      className={styles["secondaryButton"]}
                      onClick={() => {
                        setPreview(null);
                        window.requestAnimationFrame(() =>
                          document.querySelector<HTMLElement>(`[data-saved-composer]`)?.focus(),
                        );
                      }}
                      type="button"
                    >
                      Back to edit
                    </button>
                    <button
                      className={styles["primaryButton"]}
                      disabled={
                        status === "working" ||
                        (editingSchedule !== null && reviewChanges.length === 0)
                      }
                      onClick={() => void activateAlert()}
                      type="button"
                    >
                      {editingSchedule === null ? "Turn on email updates" : "Save changes"}
                      <BellRingingIcon aria-hidden="true" size={16} />
                    </button>
                  </div>
                </div>
              )}
            </section>
          ) : null}

          <section
            aria-labelledby="library-title"
            className={styles["library"]}
            ref={libraryRef}
            tabIndex={-1}
          >
            <div className={styles["sectionHeading"]}>
              <div>
                <h2 id="library-title">Your saved searches</h2>
              </div>
              <Link className={styles["textLink"]} href="/jobs">
                Find another search <ArrowRightIcon aria-hidden="true" size={14} />
              </Link>
            </div>

            {owner === null ? (
              <div className={styles["empty"]}>
                <LockKeyIcon aria-hidden="true" size={25} />
                <h3>Nothing saved yet.</h3>
                <p>Search for roles first, then choose Save search. No account is required.</p>
                <Link className={styles["emptyAction"]} href="/jobs">
                  Browse roles <ArrowRightIcon aria-hidden="true" size={14} />
                </Link>
              </div>
            ) : savedSearches.length === 0 ? (
              <div className={styles["empty"]}>
                <BookmarkSimpleIcon aria-hidden="true" size={25} />
                <h3>No saved searches yet.</h3>
                <p>Search for roles first, then choose Save search.</p>
                <Link className={styles["emptyAction"]} href="/jobs">
                  Browse roles <ArrowRightIcon aria-hidden="true" size={14} />
                </Link>
              </div>
            ) : (
              <div className={styles["savedList"]}>
                {savedSearches.map((saved) => {
                  const schedule = scheduleBySearch.get(saved.id);
                  const latestRun = latestRuns.get(saved.id);
                  return (
                    <article className={styles["savedCard"]} key={saved.id}>
                      <div className={styles["savedTopline"]}>
                        <span data-active={String(schedule?.enabled === true)}>
                          {schedule === undefined
                            ? "Saved"
                            : schedule.enabled
                              ? "Email updates on"
                              : "Email updates paused"}
                        </span>
                      </div>
                      <h3>{saved.name}</h3>
                      <div className={styles["criteria"]}>
                        {savedSearchCriteriaSummary(saved.criteria).map((item) => (
                          <span key={item}>{item}</span>
                        ))}
                      </div>
                      {schedule === undefined ? null : (
                        <div className={styles["savedMeta"]}>
                          <span>
                            <ClockIcon aria-hidden="true" size={14} />
                            {schedule.enabled
                              ? `Next check ${displayInstant(schedule.nextRunAt, schedule.recurrence.timeZone)}`
                              : "Checks are paused"}
                          </span>
                        </div>
                      )}
                      {schedule !== undefined ? (
                        <div className={styles["latestRun"]} aria-live="polite">
                          {latestRun?.evaluation === null || latestRun === undefined ? (
                            <span>Waiting for the first check.</span>
                          ) : (
                            <span>
                              {latestRun.evaluation.changes.total === 0
                                ? `No changes · ${String(latestRun.evaluation.baselineCount)} matching`
                                : `${String(latestRun.evaluation.changes.total)} change${latestRun.evaluation.changes.total === 1 ? "" : "s"} since the last check · ${String(latestRun.evaluation.baselineCount)} matching`}
                            </span>
                          )}
                          {latestRun?.delivery === null || latestRun === undefined ? null : (
                            <span data-status={latestRun.delivery.status}>
                              {deliveryLabel(latestRun.delivery.status)}
                            </span>
                          )}
                        </div>
                      ) : null}
                      <div className={styles["savedActions"]}>
                        <Link className={styles["quietButton"]} href={searchHref(saved.criteria)}>
                          View matches
                        </Link>
                        {schedule === undefined ? (
                          <button
                            className={styles["quietButton"]}
                            onClick={() => configureEmailUpdates(saved)}
                            type="button"
                          >
                            <EnvelopeSimpleIcon aria-hidden="true" size={15} />
                            Add email updates
                          </button>
                        ) : (
                          <>
                            <button
                              aria-label={`Edit updates for ${saved.name}`}
                              className={styles["quietButton"]}
                              disabled={status === "working"}
                              onClick={() => editEmailUpdates(saved, schedule)}
                              ref={(node) => {
                                if (node === null)
                                  editUpdatesButtonRefs.current.delete(schedule.id);
                                else editUpdatesButtonRefs.current.set(schedule.id, node);
                              }}
                              type="button"
                            >
                              Edit updates
                            </button>
                            <button
                              className={styles["quietButton"]}
                              disabled={status === "working"}
                              onClick={() => void toggleSchedule(schedule)}
                              type="button"
                            >
                              {schedule.enabled ? (
                                <PauseIcon aria-hidden="true" size={15} />
                              ) : (
                                <PlayIcon aria-hidden="true" size={15} />
                              )}
                              {schedule.enabled ? "Pause" : "Resume"}
                            </button>
                          </>
                        )}
                        <button
                          aria-label={`Remove ${saved.name}`}
                          className={styles["quietButton"]}
                          disabled={status === "working"}
                          onClick={() => beginRemoveSavedSearch(saved)}
                          ref={(node) => {
                            if (node === null) removeButtonRefs.current.delete(saved.id);
                            else removeButtonRefs.current.set(saved.id, node);
                          }}
                          type="button"
                        >
                          Remove
                        </button>
                      </div>
                      {pendingRemoveId === saved.id ? (
                        <form
                          aria-label={`Remove ${saved.name}`}
                          className={styles["removeConfirmation"]}
                          onSubmit={(event) => {
                            event.preventDefault();
                            void removeSavedSearch(saved);
                          }}
                        >
                          <p>Remove this saved search?</p>
                          <label>
                            <span>
                              Type <strong>{saved.name}</strong> to confirm
                            </span>
                            <input
                              aria-label={`Type ${saved.name} to confirm removal`}
                              autoComplete="off"
                              onChange={(event) => setRemovePhrase(event.target.value)}
                              ref={removeInputRef}
                              required
                              value={removePhrase}
                            />
                          </label>
                          <div>
                            <button
                              className={styles["quietButton"]}
                              disabled={status === "working"}
                              onClick={() => cancelRemoveSavedSearch(saved.id)}
                              type="button"
                            >
                              Cancel
                            </button>
                            <button
                              className={styles["dangerButton"]}
                              disabled={status === "working" || removePhrase !== saved.name}
                              type="submit"
                            >
                              Remove saved search
                            </button>
                          </div>
                        </form>
                      ) : null}
                    </article>
                  );
                })}
              </div>
            )}
          </section>
        </div>
      )}
      <div aria-live="polite" className="sr-only">
        {status === "working" ? "Updating your saved searches." : ""}
      </div>
    </div>
  );
}
