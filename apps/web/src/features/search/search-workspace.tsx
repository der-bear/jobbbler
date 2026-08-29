"use client";

import {
  ArrowClockwiseIcon,
  BriefcaseIcon,
  BellSimpleIcon,
  CircleIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  SlidersHorizontalIcon,
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
import { Sheet } from "@jobbbler/ui";

import { AgentActivityRail } from "@/components/agent-activity-rail";
import { useWebMcp } from "@/components/webmcp-provider";
import { WebMcpStatus } from "@/components/webmcp-status";
import {
  categoryLabel,
  employmentLabel,
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
  readonly category: JobCategory | "";
  readonly workModel: WorkModel | "";
  readonly seniority: Seniority | "";
  readonly location: string;
  readonly minimumSalary: string;
  readonly currency: string;
  readonly excludeKeywords: string;
  readonly sort: JobSearchCriteria["sort"];
}

function draftFromInput(input: JobSearchInput): SearchDraft {
  return {
    query: input.query ?? "",
    category: input.categories?.[0] ?? "",
    workModel: input.workModels?.[0] ?? "",
    seniority: input.seniorities?.[0] ?? "",
    location: input.locations?.[0] ?? "",
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
    categories: draft.category === "" ? [] : [draft.category],
    workModels: draft.workModel === "" ? [] : [draft.workModel],
    seniorities: draft.seniority === "" ? [] : [draft.seniority],
    locations: draft.location.trim().length === 0 ? [] : [draft.location.trim()],
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
  onSubmit,
}: Readonly<{
  className?: string;
  draft: SearchDraft;
  onDraftChange: (next: SearchDraft) => void;
  onSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
}>) {
  return (
    <form
      aria-label="Job search filters"
      className={`${styles["filterForm"]} ${className ?? ""}`}
      onSubmit={onSubmit}
    >
      <div className={styles["filterHeading"]}>
        <span>Filters</span>
      </div>
      <label className={styles["filterRow"]}>
        <span>Function</span>
        <select
          onChange={(event) =>
            onDraftChange({ ...draft, category: event.target.value as JobCategory | "" })
          }
          value={draft.category}
        >
          <option value="">Any function</option>
          {jobCategorySchema.options.map((value) => (
            <option key={value} value={value}>
              {categoryLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles["filterRow"]}>
        <span>Work model</span>
        <select
          onChange={(event) =>
            onDraftChange({ ...draft, workModel: event.target.value as WorkModel | "" })
          }
          value={draft.workModel}
        >
          <option value="">Any model</option>
          {workModelSchema.options.map((value) => (
            <option key={value} value={value}>
              {workModelLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles["filterRow"]}>
        <span>Seniority</span>
        <select
          onChange={(event) =>
            onDraftChange({ ...draft, seniority: event.target.value as Seniority | "" })
          }
          value={draft.seniority}
        >
          <option value="">Any level</option>
          {senioritySchema.options.map((value) => (
            <option key={value} value={value}>
              {seniorityLabel(value)}
            </option>
          ))}
        </select>
      </label>
      <label className={styles["filterRow"]}>
        <span>Location</span>
        <input
          maxLength={120}
          onChange={(event) => onDraftChange({ ...draft, location: event.target.value })}
          placeholder="Any location"
          value={draft.location}
        />
      </label>
      <label className={styles["filterRow"]}>
        <span>Minimum salary</span>
        <span className={styles["salaryInput"]}>
          <select
            aria-label="Salary currency"
            onChange={(event) => onDraftChange({ ...draft, currency: event.target.value })}
            value={draft.currency}
          >
            <option value="EUR">EUR</option>
            <option value="USD">USD</option>
            <option value="CAD">CAD</option>
            <option value="GBP">GBP</option>
          </select>
          <input
            aria-label="Minimum annual salary"
            min="0"
            onChange={(event) => onDraftChange({ ...draft, minimumSalary: event.target.value })}
            step="1000"
            type="number"
            value={draft.minimumSalary}
          />
        </span>
      </label>
      <label className={styles["filterRow"]}>
        <span>Exclude</span>
        <input
          maxLength={240}
          onChange={(event) => onDraftChange({ ...draft, excludeKeywords: event.target.value })}
          placeholder="agency, crypto"
          value={draft.excludeKeywords}
        />
      </label>
      <button className={styles["searchButton"]} type="submit">
        Apply filters
      </button>
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
          <small>
            {job.organizationName} · {workModelLabel(job.workModel)} ({job.locations[0]})
          </small>
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
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activityOpen, setActivityOpen] = useState(true);
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

  const appliedSearch = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    return parameters.size === 0 ? "" : `?${parameters.toString()}`;
  }, [applied]);

  const saveAlertHref = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    parameters.set("create", "1");
    return `/saved?${parameters.toString()}`;
  }, [applied]);

  function removeFilter(id: string) {
    const separator = id.indexOf(":");
    const kind = id.slice(0, separator);
    const value = id.slice(separator + 1);
    let next: JobSearchInput = { ...applied, cursor: undefined };
    if (kind === "category") {
      next = { ...next, categories: (applied.categories ?? []).filter((item) => item !== value) };
    } else if (kind === "work") {
      next = { ...next, workModels: (applied.workModels ?? []).filter((item) => item !== value) };
    } else if (kind === "seniority") {
      next = { ...next, seniorities: (applied.seniorities ?? []).filter((item) => item !== value) };
    } else if (kind === "location") {
      next = { ...next, locations: (applied.locations ?? []).filter((item) => item !== value) };
    } else if (kind === "salary") {
      next = { ...next, salary: undefined };
    } else if (kind === "exclude") {
      next = {
        ...next,
        excludeKeywords: (applied.excludeKeywords ?? []).filter((item) => item !== value),
      };
    }
    setApplied(next);
    setDraft(draftFromInput(next));
    void runSearch(next, "push");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiltersOpen(false);
    const next = inputFromDraft(draft);
    setApplied(next);
    void runSearch(next, "push");
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
    <div className={styles["workspace"]} data-activity-open={String(activityOpen)}>
      <aside className={styles["intentRail"]} aria-label="Search filters">
        <div className={styles["mobileWorkspaceActions"]}>
          <button
            className={styles["mobileFiltersButton"]}
            onClick={() => setFiltersOpen(true)}
            type="button"
          >
            <SlidersHorizontalIcon aria-hidden="true" size={17} />
            Filters
            <span>{filterSummary.length} active</span>
          </button>
        </div>
        <SearchFilters
          className={styles["desktopFilters"] ?? ""}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
        />
      </aside>

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

      <Sheet
        className={styles["mobileFilterSheet"] ?? ""}
        description="Adjust your filters — results update instantly."
        onOpenChange={setFiltersOpen}
        open={filtersOpen}
        side="bottom"
        title="Filters"
      >
        <SearchFilters
          className={styles["sheetFilters"] ?? ""}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
        />
      </Sheet>

      <section className={styles["results"]} aria-labelledby="results-heading">
        <form className={styles["searchBar"]} onSubmit={submit} role="search">
          <MagnifyingGlassIcon aria-hidden="true" size={18} />
          <input
            aria-label="Search jobs"
            maxLength={500}
            onChange={(event) => setDraft({ ...draft, query: event.target.value })}
            placeholder="Search roles, skills, or companies"
            type="search"
            value={draft.query}
          />
          <button type="submit">Search</button>
        </form>
        <div className={styles["resultsHeader"]}>
          <div aria-label="Search status" role="status">
            <h1 id="results-heading">
              {result === null
                ? "Open roles"
                : filterSummary.length === 0 && (applied.query ?? "") === ""
                  ? `${String(result.total)} open roles`
                  : `${String(result.total)} matches`}
            </h1>
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

        {filterSummary.length > 0 ? (
          <div aria-label="Applied filters" className={styles["filterChips"]} role="list">
            {filterSummary.map((filter) => (
              <span key={filter.id} role="listitem">
                <button
                  aria-label={`Remove ${filter.label}`}
                  onClick={() => removeFilter(filter.id)}
                  type="button"
                >
                  {filter.label}
                  <XIcon aria-hidden="true" size={11} weight="bold" />
                </button>
              </span>
            ))}
          </div>
        ) : null}

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
          <div className={styles["activityPanelHeader"]}>
            <div>
              <h2>Agent activity</h2>
              <p>What an AI assistant can do on this page and what it changed.</p>
            </div>
            <button
              aria-label="Close agent activity"
              className={styles["activityPanelClose"]}
              onClick={() => setActivityOpen(false)}
              type="button"
            >
              <XIcon aria-hidden="true" size={15} />
            </button>
          </div>
          <AgentActivityRail
            activities={webMcp.activities}
            initiallyExpanded
            registeredToolCount={webMcp.registeredToolCount}
            status={<WebMcpStatus />}
            webMcpAvailable={webMcp.supported && webMcp.status !== "error"}
          />
        </aside>
      ) : null}
    </div>
  );
}
