"use client";

import {
  ArrowRightIcon,
  BellRingingIcon,
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
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { z } from "zod";

import {
  completeEmailVerificationResultSchema,
  jobAlertScheduleSchema,
  ownerSessionResultSchema,
  savedSearchSchema,
  searchJobsResultSchema,
  startEmailVerificationResultSchema,
  verificationEndpointSummarySchema,
  type JobAlertSchedule,
  type JobSearchCriteria,
  type JobSearchInput,
  type OwnerSummary,
  type SavedSearch,
  type ScheduleRecurrence,
  type VerificationEndpointSummary,
  type Weekday,
} from "@jobbbler/contracts";
import { useToast } from "@jobbbler/ui";

import { ApiClientError, queryApi } from "@/lib/query-client";
import { searchInputToSearchParams } from "@/lib/search-url";
import { subscribeWebMcpScheduleCommit } from "@/lib/webmcp-ui-bridge";
import type { LatestSearchRun } from "@/lib/latest-run";

import { OwnerPrivacyControls } from "./owner-privacy-controls";
import {
  loadLatestSearchRuns,
  loadPrivateWorkspaceResources,
  loadSavedWorkspaceData,
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

const weekdayOptions: readonly { readonly value: Weekday; readonly label: string }[] = [
  { value: "monday", label: "Mon" },
  { value: "tuesday", label: "Tue" },
  { value: "wednesday", label: "Wed" },
  { value: "thursday", label: "Thu" },
  { value: "friday", label: "Fri" },
  { value: "saturday", label: "Sat" },
  { value: "sunday", label: "Sun" },
];

type Status = "loading" | "ready" | "working" | "error";

export function privateAccessCopy(owner: OwnerSummary | null): Readonly<{
  eyebrow: string;
  title: string;
  description: string;
}> {
  if (owner === null) {
    return {
      eyebrow: "No account required",
      title: "Save an alert without signing up",
      description:
        "Turning on an alert saves it privately in this browser. Verify an email to receive updates and restore your alerts elsewhere.",
    };
  }
  if (!owner.recoverable) {
    return {
      eyebrow: "Saved in this browser",
      title: "Verify an email for delivery",
      description:
        "This browser is the only way back to your saved work. Verification lets Jobbbler email updates and restore access elsewhere.",
    };
  }
  return {
    eyebrow: "Verified email",
    title: "Alerts can be recovered",
    description:
      "Your verified address receives updates and can restore your alerts on another device. It is never exposed to agents.",
  };
}

function message(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "Something went wrong. Your existing alerts are unchanged.";
}

function localTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

function displayInstant(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
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

function criteriaSummary(criteria: JobSearchCriteria): readonly string[] {
  const summary: string[] = [];
  if (criteria.query !== null) summary.push(criteria.query);
  summary.push(...criteria.categories.map((value) => value.replaceAll("_", " ")));
  summary.push(...criteria.workModels);
  summary.push(...criteria.seniorities);
  summary.push(...criteria.locations);
  if (criteria.salary?.minimum !== null && criteria.salary?.minimum !== undefined) {
    summary.push(
      `${criteria.salary.currency ?? ""} ${Intl.NumberFormat("en").format(criteria.salary.minimum)}+`,
    );
  }
  return summary.slice(0, 6);
}

function defaultName(criteria: JobSearchCriteria): string {
  if (criteria.query !== null) return criteria.query.slice(0, 100);
  const parts = [...criteria.seniorities, ...criteria.categories, ...criteria.locations];
  return (parts.length === 0 ? "My technology roles" : parts.join(" · ")).slice(0, 100);
}

export function SavedWorkspace({
  initialData,
}: Readonly<{ initialData?: SavedWorkspaceInitialData | null }>) {
  const searchParams = useSearchParams();
  const searchParamsKey = searchParams.toString();
  const router = useRouter();
  const toast = useToast();
  const createRequested = searchParams.get("create") === "1";
  const [status, setStatus] = useState<Status>(initialData === undefined ? "loading" : "ready");
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
  const [email, setEmail] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [verificationHint, setVerificationHint] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [frequency, setFrequency] = useState<"daily" | "weekly">("daily");
  const [time, setTime] = useState("09:00");
  const [timeZone, setTimeZone] = useState(localTimeZone);
  const [days, setDays] = useState<readonly Weekday[]>(["monday", "wednesday", "friday"]);
  const [endpointId, setEndpointId] = useState("");
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [pendingSaved, setPendingSaved] = useState<SavedSearch | null>(null);
  const [preview, setPreview] = useState<z.infer<typeof previewSchema> | null>(null);

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
    await loadPrivateResources();
    setOwner(current.owner);
    return current.owner;
  }, [loadPrivateResources]);

  useEffect(() => {
    if (initialData !== undefined && !createRequested) return undefined;
    let cancelled = false;
    async function initialize() {
      setStatus("loading");
      setError(null);
      try {
        if (createRequested) {
          const parameters = new URLSearchParams(searchParamsKey);
          parameters.delete("create");
          const result = await queryApi(
            `/api/v1/jobs/search${parameters.size === 0 ? "" : `?${parameters.toString()}`}`,
            searchJobsResultSchema,
          );
          if (!cancelled) {
            setCriteria(result.criteria);
            setName(defaultName(result.criteria));
          }
        }

        try {
          const current = await loadSavedWorkspaceData();
          if (cancelled) return;
          applyPrivateResources(current);
          setOwner(current.owner);
        } catch (identityError) {
          if (!(identityError instanceof ApiClientError) || identityError.code !== "UNAUTHORIZED") {
            throw identityError;
          }
          if (createRequested) await startPrivateWorkspace();
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
    void loadLatestSearchRuns(initialData.savedSearches)
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
      subscribeWebMcpScheduleCommit((updated) => {
        setSchedules((current) => {
          const exists = current.some(({ id }) => id === updated.id);
          return exists
            ? current.map((schedule) => (schedule.id === updated.id ? updated : schedule))
            : [updated, ...current];
        });
        toast.show({
          title: updated.enabled ? "Alert resumed by agent" : "Alert paused by agent",
          description: "This page now shows your latest saved state.",
          tone: "success",
        });
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
        title: "Destination revoked",
        description:
          "Alerts using this address were paused. Re-verification is required to resume delivery.",
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

  async function beginVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus("working");
    setError(null);
    try {
      const started = await queryApi(
        "/api/v1/owners/email/start",
        startEmailVerificationResultSchema,
        { method: "POST", body: { email } },
      );
      setChallengeId(started.challengeId);
      setVerificationHint(
        started.developmentCode === undefined
          ? `Code sent to ${started.maskedDestination}.`
          : `Local capture code: ${started.developmentCode}`,
      );
      if (started.developmentCode !== undefined) setCode(started.developmentCode);
      setStatus("ready");
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  async function completeVerification(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (challengeId === null) return;
    setStatus("working");
    setError(null);
    try {
      const completed = await queryApi(
        "/api/v1/owners/email/complete",
        completeEmailVerificationResultSchema,
        { method: "POST", body: { challengeId, code } },
      );
      setOwner(completed.owner);
      await loadPrivateResources();
      setStatus("ready");
      toast.show({
        title: "Email verified",
        description: "This private workspace is now recoverable and ready for durable alerts.",
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

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
      const saved =
        pendingSaved ??
        (await queryApi("/api/v1/saved-searches", savedSearchSchema, {
          method: "POST",
          body: { name, criteria },
        }));
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
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  async function activateAlert() {
    if (pendingSaved === null || preview === null) return;
    setStatus("working");
    setError(null);
    try {
      const scheduled = await queryApi("/api/v1/schedules", jobAlertScheduleSchema, {
        method: "POST",
        body: {
          savedSearchId: pendingSaved.id,
          expectedVersion: pendingSaved.version,
          recurrence: recurrence(),
          delivery: { channel: "email", endpointId },
        },
      });
      setSchedules((current) => [scheduled, ...current]);
      setPreview(null);
      setPendingSaved(null);
      setStatus("ready");
      router.replace("/saved");
      toast.show({
        title: "Alert activated",
        description: `The first check is scheduled for ${displayInstant(scheduled.nextRunAt)}.`,
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
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
        title: updated.enabled ? "Alert resumed" : "Alert paused",
        description: updated.enabled
          ? `Next check: ${displayInstant(updated.nextRunAt)}.`
          : "No checks or emails will run until you resume it.",
        tone: "success",
      });
    } catch (caught) {
      setError(message(caught));
      setStatus("error");
    }
  }

  const composing = createRequested && criteria !== null;
  const accessCopy = privateAccessCopy(owner);

  return (
    <div className={styles["workspace"]}>
      <section className={styles["intro"]}>
        <div>
          <h1>Alerts</h1>
          <p className={styles["lede"]}>
            Save a search once. Jobbbler checks it for meaningful changes and emails you.
          </p>
        </div>
        <aside className={styles["identityCard"]} aria-label="Private workspace status">
          <div className={styles["identityHeading"]}>
            <ShieldCheckIcon aria-hidden="true" size={22} weight="fill" />
            <div>
              <span>{accessCopy.eyebrow}</span>
              <strong>{accessCopy.title}</strong>
            </div>
          </div>
          <p>{accessCopy.description}</p>
          {owner?.recoverable === true && verifiedEndpoints.length > 0 ? (
            <div className={styles["endpointList"]} aria-label="Verified delivery destinations">
              {verifiedEndpoints.map((endpoint) => (
                <div key={endpoint.id}>
                  <span>
                    <EnvelopeSimpleIcon aria-hidden="true" size={14} />
                    {endpoint.maskedDestination}
                  </span>
                  {pendingRevokeId === endpoint.id ? (
                    <span className={styles["revokeActions"]}>
                      <button
                        aria-label={`Cancel revoking ${endpoint.maskedDestination}`}
                        onClick={() => setPendingRevokeId(null)}
                        type="button"
                      >
                        Cancel
                      </button>
                      <button
                        aria-label={`Confirm revoking ${endpoint.maskedDestination}`}
                        disabled={status === "working"}
                        onClick={() => void revokeEndpoint(endpoint)}
                        type="button"
                      >
                        Confirm revoke
                      </button>
                    </span>
                  ) : (
                    <button
                      aria-label={`Revoke ${endpoint.maskedDestination}`}
                      onClick={() => setPendingRevokeId(endpoint.id)}
                      type="button"
                    >
                      Revoke
                    </button>
                  )}
                </div>
              ))}
            </div>
          ) : null}
          {status === "loading" ? null : (
            <OwnerPrivacyControls
              onDeleted={() => {
                setOwner(null);
                setEndpoints([]);
                setSavedSearches([]);
                setSchedules([]);
                setLatestRuns(new Map());
                router.replace("/saved");
                toast.show({
                  title: "Private data deleted",
                  description: "The private workspace and its sessions were permanently removed.",
                  tone: "success",
                });
              }}
              onRecovered={(recoveredOwner) => {
                void loadPrivateResources()
                  .then(() => {
                    setOwner(recoveredOwner);
                    toast.show({
                      title: "Workspace recovered",
                      description: "A new private session is active on this browser.",
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
          Preparing your private workspace…
        </div>
      ) : null}

      <div className={styles["content"]}>
        {composing ? (
          <section className={styles["composer"]} aria-labelledby="composer-title">
            <div className={styles["sectionHeading"]}>
              <div>
                <h2 id="composer-title">Save this search as an email alert</h2>
              </div>
              <span className={styles["stepBadge"]}>
                {verifiedEndpoints.length === 0
                  ? "1 · Verify"
                  : preview === null
                    ? "2 · Shape"
                    : "3 · Confirm"}
              </span>
            </div>

            <div className={styles["criteria"]} aria-label="Alert criteria">
              {criteriaSummary(criteria).map((item) => (
                <span key={item}>{item}</span>
              ))}
            </div>

            {verifiedEndpoints.length === 0 ? (
              <div className={styles["verification"]}>
                <div className={styles["privacyNote"]}>
                  <LockKeyIcon aria-hidden="true" size={18} />
                  <p>
                    Your email is used only to confirm it is yours and to send this alert. It is
                    never shared with your browser agent or anyone else, and you can remove it
                    later.
                  </p>
                </div>
                {challengeId === null ? (
                  <form className={styles["form"]} onSubmit={beginVerification}>
                    <label>
                      <span>Delivery email</span>
                      <input
                        autoComplete="email"
                        maxLength={320}
                        onChange={(event) => setEmail(event.target.value)}
                        placeholder="you@example.com"
                        required
                        type="email"
                        value={email}
                      />
                    </label>
                    <button className={styles["primaryButton"]} disabled={status === "working"}>
                      Send verification code
                      <ArrowRightIcon aria-hidden="true" size={16} />
                    </button>
                  </form>
                ) : (
                  <form className={styles["form"]} onSubmit={completeVerification}>
                    <label>
                      <span>Six-digit code</span>
                      <input
                        autoComplete="one-time-code"
                        inputMode="numeric"
                        maxLength={6}
                        onChange={(event) => setCode(event.target.value.replace(/\D/gu, ""))}
                        pattern="[0-9]{6}"
                        required
                        value={code}
                      />
                    </label>
                    {verificationHint === null ? null : (
                      <p className={styles["hint"]}>{verificationHint}</p>
                    )}
                    <button className={styles["primaryButton"]} disabled={status === "working"}>
                      Verify and continue
                      <CheckCircleIcon aria-hidden="true" size={16} />
                    </button>
                  </form>
                )}
              </div>
            ) : preview === null ? (
              <form className={styles["form"]} onSubmit={previewAlert}>
                <label>
                  <span>Alert name</span>
                  <input
                    maxLength={100}
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                  />
                </label>
                <div className={styles["formGrid"]}>
                  <label>
                    <span>Cadence</span>
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
                    onChange={(event) => setTimeZone(event.target.value)}
                    required
                    value={timeZone}
                  />
                </label>
                <label>
                  <span>Verified destination</span>
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
                  disabled={status === "working" || (frequency === "weekly" && days.length === 0)}
                >
                  Preview exact alert
                  <EyeIcon aria-hidden="true" size={16} />
                </button>
              </form>
            ) : (
              <div className={styles["preview"]}>
                <div className={styles["previewRow"]}>
                  <CalendarDotsIcon aria-hidden="true" size={19} />
                  <span>First check</span>
                  <strong>{displayInstant(preview.nextRunAt)}</strong>
                </div>
                <div className={styles["previewRow"]}>
                  <EnvelopeSimpleIcon aria-hidden="true" size={19} />
                  <span>Destination</span>
                  <strong>{preview.delivery.maskedDestination}</strong>
                </div>
                <div className={styles["previewRow"]}>
                  <SparkleIcon aria-hidden="true" size={19} />
                  <span>Digest policy</span>
                  <strong>Only material changes</strong>
                </div>
                <p>
                  Turning this on lets Jobbbler keep checking and email you about this saved search.
                  It does not authorize an agent to apply, disclose profile data, or submit
                  anything.
                </p>
                <div className={styles["buttonRow"]}>
                  <button
                    className={styles["secondaryButton"]}
                    onClick={() => setPreview(null)}
                    type="button"
                  >
                    Edit schedule
                  </button>
                  <button
                    className={styles["primaryButton"]}
                    disabled={status === "working"}
                    onClick={() => void activateAlert()}
                    type="button"
                  >
                    Activate alert
                    <BellRingingIcon aria-hidden="true" size={16} />
                  </button>
                </div>
              </div>
            )}
          </section>
        ) : null}

        <section className={styles["library"]} aria-labelledby="library-title">
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
              <p>Search for roles first, then choose Save alert. No account is required.</p>
            </div>
          ) : savedSearches.length === 0 ? (
            <div className={styles["empty"]}>
              <BellRingingIcon aria-hidden="true" size={25} />
              <h3>No saved searches yet.</h3>
              <p>Search for roles first, then choose Save alert to set up email updates.</p>
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
                            ? `Checking ${schedule.recurrence.frequency}`
                            : "Paused"}
                      </span>
                    </div>
                    <h3>{saved.name}</h3>
                    <div className={styles["criteria"]}>
                      {criteriaSummary(saved.criteria).map((item) => (
                        <span key={item}>{item}</span>
                      ))}
                    </div>
                    <div className={styles["savedMeta"]}>
                      <span>
                        <ClockIcon aria-hidden="true" size={14} />
                        {schedule === undefined
                          ? "Not checking automatically"
                          : schedule.enabled
                            ? `Next ${displayInstant(schedule.nextRunAt)}`
                            : "Checks are stopped"}
                      </span>
                      <span>
                        <EnvelopeSimpleIcon aria-hidden="true" size={14} />
                        {schedule === undefined ? "No email updates" : "Email updates"}
                      </span>
                    </div>
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
                      <Link className={styles["secondaryButton"]} href={searchHref(saved.criteria)}>
                        View matches
                      </Link>
                      {schedule === undefined ? null : (
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
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>
      <div aria-live="polite" className="sr-only">
        {status === "working" ? "Working on your private alert settings." : ""}
      </div>
    </div>
  );
}
