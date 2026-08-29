"use client";

import {
  ArrowClockwiseIcon,
  BriefcaseIcon,
  BellSimpleIcon,
  CircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  MapPinIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  jobCategorySchema,
  searchJobsResultSchema,
  searchSortSchema,
  senioritySchema,
  workModelSchema,
  type JobCategory,
  type JobSearchCriteria,
  type JobSearchInput,
  type JobSummary,
  type SearchJobsResult,
  type Seniority,
  type WorkModel,
} from "@jobbbler/contracts";
import { MultiSelect } from "@jobbbler/ui";

import { AgentActivityRail } from "@/components/agent-activity-rail";
import { AgentGuide, AgentTools } from "@/components/agent-guide";
import { useWebMcp } from "@/components/webmcp-provider";
import { WebMcpStatus } from "@/components/webmcp-status";
import {
  categoryLabel,
  relativeFreshness,
  salaryLabel,
  seniorityLabel,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { searchInputToSearchParams, searchParamsToInput } from "@/lib/search-url";
import { publishSearchSurfaceState, subscribeWebMcpSearchCommit } from "@/lib/webmcp-ui-bridge";

import styles from "./search-workspace.module.css";

const defaultSearch: JobSearchInput = {
  sort: "newest",
  limit: 20,
};

interface SearchDraft {
  readonly query: string;
  readonly categories: readonly JobCategory[];
  readonly workModels: readonly WorkModel[];
  readonly seniorities: readonly Seniority[];
  readonly location: string;
  readonly postedWithinDays: string;
  readonly minimumSalary: string;
  readonly currency: string;
  readonly excludeKeywords: string;
  readonly sort: JobSearchCriteria["sort"];
}

function draftFromInput(input: JobSearchInput): SearchDraft {
  return {
    query: input.query ?? "",
    categories: input.categories ?? [],
    workModels: input.workModels ?? [],
    seniorities: input.seniorities ?? [],
    location: input.locations?.[0] ?? "",
    postedWithinDays: input.postedWithinDays === undefined ? "" : String(input.postedWithinDays),
    minimumSalary: input.salary?.minimum === undefined ? "" : String(input.salary.minimum),
    currency: input.salary?.currency ?? "EUR",
    excludeKeywords: input.excludeKeywords?.join(", ") ?? "",
    sort: input.sort ?? "relevance",
  };
}

function inputFromDraft(draft: SearchDraft): JobSearchInput {
  const minimumSalary = draft.minimumSalary.trim();
  const salaryAmount = minimumSalary.length === 0 ? undefined : Number(minimumSalary);
  return {
    ...(draft.query.trim().length === 0 ? {} : { query: draft.query.trim() }),
    categories: [...draft.categories],
    workModels: [...draft.workModels],
    seniorities: [...draft.seniorities],
    locations: draft.location.trim().length === 0 ? [] : [draft.location.trim()],
    ...(draft.postedWithinDays === "" ? {} : { postedWithinDays: Number(draft.postedWithinDays) }),
    excludeKeywords: draft.excludeKeywords
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0),
    ...(salaryAmount === undefined
      ? {}
      : {
          salary: {
            minimum: salaryAmount,
            currency: draft.currency,
            period: "year" as const,
            unknownPolicy: "include" as const,
          },
        }),
    sort: draft.sort,
    limit: 20,
  };
}

function searchFromLocation(): JobSearchInput {
  const parameters = new URLSearchParams(window.location.search);
  return parameters.size === 0 ? defaultSearch : searchParamsToInput(parameters);
}

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) {
    if (error.code === "RATE_LIMITED") {
      return "Search is briefly busy. Your current results are safe; retry in a moment.";
    }
    return error.message;
  }
  return "Search is temporarily unavailable. Please retry.";
}

function SearchFilters({
  className,
  draft,
  onDraftChange,
  onCommit,
}: Readonly<{
  className?: string;
  draft: SearchDraft;
  onDraftChange: (next: SearchDraft) => void;
  onCommit: (next: SearchDraft) => void;
}>) {
  function toggleWorkModel(value: WorkModel) {
    const workModels = draft.workModels.includes(value)
      ? draft.workModels.filter((item) => item !== value)
      : [...draft.workModels, value];
    onCommit({ ...draft, workModels });
  }

  function commitOnEnter(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key !== "Enter") return;
    event.preventDefault();
    onCommit(draft);
  }

  return (
    <form
      aria-label="Job search filters"
      className={`${styles["filterBar"]} ${className ?? ""}`}
      onSubmit={(event) => {
        event.preventDefault();
        onCommit(draft);
      }}
    >
      <p className={styles["railTitle"]}>Filters</p>
      <fieldset className={styles["choiceRow"]}>
        <legend>Work model</legend>
        <div>
          {workModelSchema.options.map((value) => (
            <button
              aria-pressed={draft.workModels.includes(value)}
              key={value}
              onClick={() => toggleWorkModel(value)}
              type="button"
            >
              {workModelLabel(value)}
            </button>
          ))}
        </div>
      </fieldset>
      <div className={styles["filterRow"]}>
        <span>Function</span>
        <MultiSelect
          label="Function"
          onChange={(categories) =>
            onCommit({ ...draft, categories: categories as readonly JobCategory[] })
          }
          options={jobCategorySchema.options.map((value) => ({
            value,
            label: categoryLabel(value),
          }))}
          placeholder="Any function"
          searchable
          selected={draft.categories}
        />
      </div>
      <div className={styles["filterRow"]}>
        <span>Seniority</span>
        <MultiSelect
          label="Seniority"
          onChange={(seniorities) =>
            onCommit({ ...draft, seniorities: seniorities as readonly Seniority[] })
          }
          options={senioritySchema.options.map((value) => ({
            value,
            label: seniorityLabel(value),
          }))}
          placeholder="Any level"
          selected={draft.seniorities}
        />
      </div>
      <label className={styles["filterRow"]}>
        <span>Date posted</span>
        <select
          onChange={(event) => onCommit({ ...draft, postedWithinDays: event.target.value })}
          value={draft.postedWithinDays}
        >
          <option value="">Any time</option>
          <option value="1">Past 24 hours</option>
          <option value="7">Past week</option>
          <option value="30">Past month</option>
        </select>
      </label>
      <div className={styles["filterRow"]}>
        <span className={styles["salaryLabel"]}>
          Minimum salary
          <strong>
            {draft.minimumSalary === "" || draft.minimumSalary === "0"
              ? "Any"
              : `${draft.currency} ${Intl.NumberFormat("en").format(Number(draft.minimumSalary))}+`}
          </strong>
        </span>
        <span className={styles["salaryInput"]}>
          <select
            aria-label="Salary currency"
            onChange={(event) => onCommit({ ...draft, currency: event.target.value })}
            value={draft.currency}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
            <option value="GBP">GBP</option>
          </select>
          <input
            aria-label="Minimum annual salary"
            className="jb-range"
            max="250000"
            min="0"
            onChange={(event) => onDraftChange({ ...draft, minimumSalary: event.target.value })}
            onKeyUp={() => onCommit(draft)}
            onPointerUp={() => onCommit(draft)}
            step="10000"
            style={
              {
                "--jb-range-progress": `${String((Number(draft.minimumSalary || "0") / 250000) * 100)}%`,
              } as React.CSSProperties
            }
            type="range"
            value={draft.minimumSalary === "" ? "0" : draft.minimumSalary}
          />
        </span>
      </div>
      <label className={styles["filterRow"]}>
        <span>Exclude</span>
        <input
          maxLength={240}
          onBlur={() => onCommit(draft)}
          onChange={(event) => onDraftChange({ ...draft, excludeKeywords: event.target.value })}
          onKeyDown={commitOnEnter}
          placeholder="agency, crypto"
          value={draft.excludeKeywords}
        />
      </label>
    </form>
  );
}

function SearchSkeleton() {
  return (
    <div aria-label="Loading jobs" className={styles["skeletonList"]} role="status">
      {[0, 1, 2].map((value) => (
        <div className={styles["skeletonRow"]} key={value}>
          <span />
          <span />
          <span />
        </div>
      ))}
      <span className="sr-only">Loading matching jobs.</span>
    </div>
  );
}

function JobResult({
  job,
  detailSearch,
}: Readonly<{
  job: JobSummary;
  detailSearch: string;
}>) {
  return (
    <article aria-label={`${job.title} at ${job.organizationName}`} className={styles["jobResult"]}>
      <div className={styles["jobSummary"]}>
        <Link
          aria-label={`View details for ${job.title} at ${job.organizationName}`}
          className={styles["jobTitleLink"]}
          href={`/jobs/${job.id}${detailSearch}`}
        >
          <strong>{job.title}</strong>
          <small>{job.organizationName}</small>
          <span className={styles["jobMeta"]}>
            {workModelLabel(job.workModel)} · {job.locations[0]}
          </span>
        </Link>
        <div className={styles["jobSalary"]}>
          <strong>{salaryLabel(job.salary)}</strong>
          <small>{relativeFreshness(job.updatedAt)}</small>
        </div>
      </div>
    </article>
  );
}

export function SearchWorkspace() {
  const webMcp = useWebMcp();
  const [applied, setApplied] = useState<JobSearchInput>(defaultSearch);
  const [draft, setDraft] = useState<SearchDraft>(() => draftFromInput(defaultSearch));
  const [result, setResult] = useState<SearchJobsResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [activityOpen, setActivityOpen] = useState(true);
  const [panelTab, setPanelTab] = useState<"guide" | "tools" | "activity">("guide");
  const [activityPanelWidth, setActivityPanelWidth] = useState(360);
  const [activityResizing, setActivityResizing] = useState(false);
  const activityCount = webMcp.activities.length;
  const seenActivityCount = useRef(0);
  const userChoseTab = useRef(false);

  const [agentPulse, setAgentPulse] = useState(false);

  useEffect(() => {
    if (activityCount > seenActivityCount.current) {
      setPanelTab("activity");
      setAgentPulse(true);
      const timer = window.setTimeout(() => setAgentPulse(false), 900);
      seenActivityCount.current = activityCount;
      return () => window.clearTimeout(timer);
    }
    seenActivityCount.current = activityCount;
    return undefined;
  }, [activityCount]);

  useEffect(() => {
    if (userChoseTab.current) return;
    if (webMcp.status === "ready" && webMcp.registeredToolCount > 0) setPanelTab("activity");
  }, [webMcp.registeredToolCount, webMcp.status]);

  function startActivityResize(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = activityPanelWidth;
    setActivityResizing(true);
    const onMove = (moveEvent: PointerEvent) => {
      setActivityPanelWidth(Math.min(680, Math.max(280, startWidth + startX - moveEvent.clientX)));
    };
    const onUp = () => {
      setActivityResizing(false);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
  const requestSequence = useRef(0);

  const runSearch = useCallback(async (input: JobSearchInput, history: "push" | "replace") => {
    const sequence = requestSequence.current + 1;
    requestSequence.current = sequence;
    const parameters = searchInputToSearchParams(input);
    const target = parameters.size === 0 ? "/" : `/?${parameters.toString()}`;
    window.history[history === "push" ? "pushState" : "replaceState"]({}, "", target);
    setStatus("loading");
    setError(null);

    try {
      const next = await queryApi(
        `/api/v1/jobs/search${parameters.size === 0 ? "" : `?${parameters.toString()}`}`,
        searchJobsResultSchema,
      );
      if (requestSequence.current !== sequence) return;
      setResult(next);
      setStatus("ready");
    } catch (searchError) {
      if (requestSequence.current !== sequence) return;
      setError(errorMessage(searchError));
      setStatus("error");
    }
  }, []);

  useEffect(() => {
    const initial = searchFromLocation();
    setApplied(initial);
    setDraft(draftFromInput(initial));
    void runSearch(initial, "replace");

    const restore = () => {
      const restored = searchFromLocation();
      setApplied(restored);
      setDraft(draftFromInput(restored));
      void runSearch(restored, "replace");
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [runSearch]);

  useEffect(
    () =>
      subscribeWebMcpSearchCommit(({ input, result: committedResult }) => {
        requestSequence.current += 1;
        publishSearchSurfaceState({
          criteria: committedResult.criteria,
          total: committedResult.total,
        });
        flushSync(() => {
          setApplied(input);
          setDraft(draftFromInput(input));
          setResult(committedResult);
          setError(null);
          setStatus("ready");
        });
      }),
    [],
  );

  useEffect(() => {
    publishSearchSurfaceState(
      result === null ? null : { criteria: result.criteria, total: result.total },
    );
  }, [result]);

  useEffect(() => () => publishSearchSurfaceState(null), []);

  const filterSummary = useMemo(() => {
    const items: { readonly id: string; readonly label: string }[] = [];
    for (const value of applied.categories ?? []) {
      items.push({ id: `category:${value}`, label: categoryLabel(value) });
    }
    for (const value of applied.workModels ?? []) {
      items.push({ id: `work:${value}`, label: workModelLabel(value) });
    }
    for (const value of applied.seniorities ?? []) {
      items.push({ id: `seniority:${value}`, label: seniorityLabel(value) });
    }
    for (const value of applied.locations ?? []) {
      items.push({ id: `location:${value}`, label: value });
    }
    if (applied.salary?.minimum !== undefined) {
      items.push({
        id: "salary:minimum",
        label: `Min ${applied.salary.currency ?? "EUR"} ${Intl.NumberFormat("en").format(applied.salary.minimum)}`,
      });
    }
    for (const value of applied.excludeKeywords ?? []) {
      items.push({ id: `exclude:${value}`, label: `No ${value}` });
    }
    return items;
  }, [applied]);

  const landing = (applied.query ?? "") === "" && filterSummary.length === 0;

  const appliedSearch = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    return parameters.size === 0 ? "" : `?${parameters.toString()}`;
  }, [applied]);

  const saveAlertHref = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    parameters.set("create", "1");
    return `/saved?${parameters.toString()}`;
  }, [applied]);

  function commitDraft(next: SearchDraft) {
    setDraft(next);
    const input = inputFromDraft(next);
    if (
      searchInputToSearchParams(input).toString() === searchInputToSearchParams(applied).toString()
    ) {
      return;
    }
    setApplied(input);
    void runSearch(input, "push");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    commitDraft(draft);
  }

  function changeSort(sort: JobSearchCriteria["sort"]) {
    const next = { ...applied, sort, cursor: undefined };
    setApplied(next);
    setDraft((current) => ({ ...current, sort }));
    void runSearch(next, "push");
  }

  const activityStatus =
    webMcp.status === "error"
      ? "Needs attention"
      : webMcp.status === "checking"
        ? "Checking"
        : webMcp.status === "preparing"
          ? "Preparing"
          : webMcp.status === "unsupported"
            ? "Browser mode"
            : `${String(webMcp.activities.length)} ${webMcp.activities.length === 1 ? "event" : "events"}`;

  return (
    <div
      className={styles["workspace"]}
      data-activity-open={String(activityOpen)}
      style={{ "--activity-panel-size": `${String(activityPanelWidth)}px` } as React.CSSProperties}
    >
      {activityOpen ? null : (
        <button
          aria-expanded={activityOpen}
          aria-label={`Agent activity — ${activityStatus}`}
          className={styles["activityTrigger"]}
          data-status={webMcp.status}
          onClick={() => setActivityOpen(true)}
          type="button"
        >
          <CircleIcon aria-hidden="true" size={8} weight="fill" />
          Agent activity
          <span>{activityStatus}</span>
        </button>
      )}

      <header className={styles["hero"]} data-compact={String(!landing)}>
        <h1>Find your next technology role</h1>
        <p className={styles["heroSub"]}>
          Search yourself or ask your browser agent. No setup required.
        </p>
        <form className={styles["heroSearch"]} onSubmit={submit} role="search">
          <label className={styles["heroField"]}>
            <MagnifyingGlassIcon aria-hidden="true" size={17} />
            <input
              aria-label="Search jobs"
              maxLength={500}
              onChange={(event) => setDraft({ ...draft, query: event.target.value })}
              placeholder="Job title, skill, or company"
              type="search"
              value={draft.query}
            />
          </label>
          <span aria-hidden="true" className={styles["heroDivider"]} />
          <label className={styles["heroField"]}>
            <MapPinIcon aria-hidden="true" size={17} />
            <input
              aria-label="Location"
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, location: event.target.value })}
              placeholder="Location"
              value={draft.location}
            />
          </label>
          <button type="submit">Search</button>
        </form>
      </header>

      <aside aria-label="Filters" className={styles["filterRail"]}>
        <SearchFilters draft={draft} onCommit={commitDraft} onDraftChange={setDraft} />
      </aside>

      <section className={styles["results"]} aria-labelledby="results-heading">
        <div className={styles["resultsHeader"]} data-agent-pulse={String(agentPulse)}>
          <div aria-label="Search status" role="status">
            <h2 id="results-heading">
              {result === null
                ? "Latest roles"
                : filterSummary.length === 0 && (applied.query ?? "") === ""
                  ? `Latest roles · ${String(result.total)}`
                  : `${String(result.total)} matches`}
            </h2>
          </div>
          <div className={styles["resultsControls"]}>
            <Link className={styles["saveAlertLink"]} href={saveAlertHref}>
              <BellSimpleIcon aria-hidden="true" size={16} />
              Save alert
            </Link>
            <label>
              <span className="sr-only">Sort jobs</span>
              <select
                onChange={(event) => changeSort(searchSortSchema.parse(event.target.value))}
                value={applied.sort ?? "relevance"}
              >
                <option value="relevance">Best match</option>
                <option value="newest">Newest</option>
                <option value="salary_desc">Highest salary</option>
              </select>
            </label>
          </div>
        </div>

        <div aria-atomic="true" aria-live="polite" className="sr-only">
          {status === "ready" && result !== null
            ? `${String(result.total)} matching jobs loaded.`
            : status === "error"
              ? error
              : ""}
        </div>

        {status === "loading" && result === null ? <SearchSkeleton /> : null}

        {error !== null ? (
          <div className={styles["errorState"]} role="alert">
            <WarningCircleIcon aria-hidden="true" size={22} />
            <div>
              <strong>We could not refresh this search.</strong>
              <p>{error}</p>
            </div>
            <button onClick={() => void runSearch(applied, "replace")} type="button">
              <ArrowClockwiseIcon aria-hidden="true" size={16} />
              Retry
            </button>
          </div>
        ) : null}

        {result !== null && result.jobs.length === 0 ? (
          <div className={styles["emptyState"]}>
            <BriefcaseIcon aria-hidden="true" size={30} />
            <h3>No exact matches yet</h3>
            <p>Broaden one constraint. Your search remains visible and editable on the left.</p>
          </div>
        ) : null}

        {result !== null && result.jobs.length > 0 ? (
          <div className={styles["resultList"]} data-loading={String(status === "loading")}>
            {result.jobs.map((job) => (
              <JobResult detailSearch={appliedSearch} job={job} key={job.id} />
            ))}
          </div>
        ) : null}

        {result !== null ? (
          <footer className={styles["resultsFooter"]}>
            <span>
              <ClockIcon aria-hidden="true" size={15} />
              Catalog updated {relativeFreshness(result.catalogUpdatedAt).replace("Updated ", "")}
            </span>
          </footer>
        ) : null}
      </section>

      {activityOpen ? (
        <aside aria-label="Agent activity" className={styles["activityPanel"]}>
          <div
            aria-hidden="true"
            className={styles["activityResizer"]}
            data-resizing={String(activityResizing)}
            onPointerDown={startActivityResize}
          />
          <div className={styles["activityPanelHeader"]}>
            <div>
              <h2>Agent panel</h2>
              <p>What an AI assistant can do on this page and what it changed.</p>
            </div>
            <button
              aria-label="Close agent panel"
              className={styles["activityPanelClose"]}
              onClick={() => setActivityOpen(false)}
              type="button"
            >
              <XIcon aria-hidden="true" size={15} />
            </button>
          </div>
          <div className={styles["panelStatus"]}>
            <WebMcpStatus />
            <span>
              {webMcp.registeredToolCount === 0
                ? "No tools registered on this page"
                : `${String(webMcp.registeredToolCount)} tool${webMcp.registeredToolCount === 1 ? "" : "s"} available on this page`}
            </span>
          </div>
          <div aria-label="Agent panel sections" className={styles["panelTabs"]} role="tablist">
            {(
              [
                ["activity", `Activity${activityCount > 0 ? ` · ${String(activityCount)}` : ""}`],
                ["tools", "Tools"],
                ["guide", "Guide"],
              ] as const
            ).map(([tab, label]) => (
              <button
                aria-selected={panelTab === tab}
                key={tab}
                onClick={() => {
                  userChoseTab.current = true;
                  setPanelTab(tab);
                }}
                role="tab"
                type="button"
              >
                {label}
              </button>
            ))}
          </div>
          {panelTab === "guide" ? (
            <AgentGuide />
          ) : panelTab === "tools" ? (
            <AgentTools tools={webMcp.registeredTools} />
          ) : (
            <AgentActivityRail
              activities={webMcp.activities}
              initiallyExpanded
              registeredToolCount={webMcp.registeredToolCount}
              webMcpAvailable={webMcp.supported && webMcp.status !== "error"}
            />
          )}
        </aside>
      ) : null}
    </div>
  );
}
