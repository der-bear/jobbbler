"use client";

import {
  ArrowClockwiseIcon,
  ArrowSquareOutIcon,
  BriefcaseIcon,
  CaretDownIcon,
  CheckCircleIcon,
  CircleIcon,
  ClockIcon,
  MapPinIcon,
  ScalesIcon,
  SlidersHorizontalIcon,
  SparkleIcon,
  WarningCircleIcon,
  XIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

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

import styles from "./search-workspace.module.css";

const defaultSearch: JobSearchInput = {
  categories: ["software_engineering", "product"],
  workModels: ["remote"],
  seniorities: ["senior", "staff"],
  locations: ["Europe"],
  excludeKeywords: ["agency"],
  salary: {
    minimum: 100_000,
    currency: "EUR",
    period: "year",
    unknownPolicy: "include",
  },
  sort: "relevance",
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

interface ActivityItem {
  readonly id: number;
  readonly label: string;
  readonly detail: string;
  readonly actor: "You" | "WebMCP";
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

function outcomeLabel(input: JobSearchInput): string {
  if (input.query !== undefined) return input.query;
  const seniority = input.seniorities?.map(seniorityLabel).join(" or ").toLowerCase();
  const category = input.categories?.map(categoryLabel).join(" and ").toLowerCase();
  const work = input.workModels?.map(workModelLabel).join(" or ").toLowerCase();
  const location = input.locations?.join(" or ");
  const base = [seniority, work, category ? `${category} roles` : "technology roles"]
    .filter(Boolean)
    .join(" ");
  const place = location === undefined ? "" : ` across ${location}`;
  const salary =
    input.salary?.minimum === undefined
      ? ""
      : ` paying at least ${input.salary.currency ?? "EUR"} ${Intl.NumberFormat("en").format(input.salary.minimum)}`;
  const exclusion =
    input.excludeKeywords === undefined || input.excludeKeywords.length === 0
      ? ""
      : `, excluding ${input.excludeKeywords.join(" and ")}`;
  return `${base}${place}${salary}${exclusion}.`;
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
      <label className={styles["queryField"]}>
        <span>Your outcome</span>
        <input
          maxLength={500}
          onChange={(event) => onDraftChange({ ...draft, query: event.target.value })}
          placeholder="e.g. product engineer"
          type="search"
          value={draft.query}
        />
      </label>
      <div className={styles["filterHeading"]}>
        <span>Structured constraints</span>
        <SlidersHorizontalIcon aria-hidden="true" size={15} />
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
        <SparkleIcon aria-hidden="true" size={17} weight="fill" />
        Find matching roles
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

function MatchEvidence({ evidence }: Readonly<{ evidence: readonly string[] }>) {
  if (evidence.length === 0) return null;
  return (
    <section aria-label="Job evidence" className={styles["evidenceBlock"]} role="group">
      <h3>Why this matches</h3>
      <ul>
        {evidence.slice(0, 4).map((item) => (
          <li key={item}>
            <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function JobResult({
  job,
  detailSearch,
  expanded,
  compared,
  compareDisabled,
  onExpand,
  onCompare,
}: Readonly<{
  job: JobSummary;
  detailSearch: string;
  expanded: boolean;
  compared: boolean;
  compareDisabled: boolean;
  onExpand: () => void;
  onCompare: () => void;
}>) {
  return (
    <article
      aria-label={`${job.title} at ${job.organizationName}`}
      className={styles["jobResult"]}
      data-expanded={String(expanded)}
    >
      <div className={styles["jobSummary"]}>
        <button
          aria-expanded={expanded}
          className={styles["jobTitleButton"]}
          onClick={onExpand}
          type="button"
        >
          <span>
            <strong>{job.title}</strong>
            <small>
              {job.organizationName} · {workModelLabel(job.workModel)} ({job.locations[0]})
            </small>
          </span>
          <CaretDownIcon aria-hidden="true" size={17} />
        </button>
        <div className={styles["jobSalary"]}>
          <strong>{salaryLabel(job.salary)}</strong>
          <small>{relativeFreshness(job.updatedAt)}</small>
        </div>
        <div className={styles["matchScore"]}>
          <strong>{job.matchScore ?? 50}%</strong>
          <small>fit signal</small>
        </div>
      </div>

      {expanded ? (
        <div className={styles["jobExpanded"]}>
          <div className={styles["jobNarrative"]}>
            <p>{job.summary}</p>
            <MatchEvidence evidence={job.matchEvidence ?? []} />
            <section className={styles["tradeoffs"]}>
              <h3>What to verify</h3>
              <p>
                {job.salary === null
                  ? "Compensation is not disclosed. Treat any salary fit as unknown."
                  : "Confirm compensation structure and interview expectations with the employer."}
              </p>
            </section>
          </div>
          <aside className={styles["jobFacts"]} aria-label="Job facts">
            <div>
              <span>Employment</span>
              <strong>{employmentLabel(job.employmentType)}</strong>
            </div>
            <div>
              <span>Seniority</span>
              <strong>
                {job.seniority === null ? "Not specified" : seniorityLabel(job.seniority)}
              </strong>
            </div>
            <div>
              <span>Source</span>
              <strong>{job.source.label}</strong>
            </div>
            <div className={styles["skills"]}>
              <span>Skills</span>
              <p>{job.skills.slice(0, 5).join(" · ")}</p>
            </div>
          </aside>
          <div className={styles["resultActions"]}>
            <Link
              aria-label={`View details for ${job.title} at ${job.organizationName}`}
              className={styles["primaryLink"]}
              href={`/jobs/${job.id}${detailSearch}`}
            >
              View role
              <ArrowSquareOutIcon aria-hidden="true" size={16} />
            </Link>
            <label className={styles["secondaryAction"]} data-selected={String(compared)}>
              <input
                aria-label={`Compare ${job.title} at ${job.organizationName}`}
                checked={compared}
                className={styles["compareCheckbox"]}
                disabled={compareDisabled}
                onChange={onCompare}
                type="checkbox"
              />
              <ScalesIcon aria-hidden="true" size={16} />
              {compared ? "Selected to compare" : "Add to compare"}
            </label>
          </div>
        </div>
      ) : null}
    </article>
  );
}

export function SearchWorkspace() {
  const [applied, setApplied] = useState<JobSearchInput>(defaultSearch);
  const [draft, setDraft] = useState<SearchDraft>(() => draftFromInput(defaultSearch));
  const [result, setResult] = useState<SearchJobsResult | null>(null);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const [expandedJobId, setExpandedJobId] = useState<string | null>(null);
  const [comparedJobIds, setComparedJobIds] = useState<readonly string[]>([]);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activity, setActivity] = useState<readonly ActivityItem[]>([
    {
      id: 1,
      label: "Workspace ready",
      detail: "A transparent search is ready to refine.",
      actor: "You",
    },
  ]);
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
      setExpandedJobId((current) =>
        current !== null && next.jobs.some(({ id }) => id === current)
          ? current
          : (next.jobs[0]?.id ?? null),
      );
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

  const compareHref = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    for (const id of comparedJobIds) parameters.append("id", id);
    return `/compare?${parameters.toString()}`;
  }, [applied, comparedJobIds]);

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
    setActivity((current) =>
      [
        {
          id: Date.now(),
          label: "Constraint removed",
          detail: "Results were refreshed from the visible search state.",
          actor: "You" as const,
        },
        ...current,
      ].slice(0, 4),
    );
    void runSearch(next, "push");
  }

  function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFiltersOpen(false);
    const next = inputFromDraft(draft);
    setApplied(next);
    setActivity((current) =>
      [
        {
          id: Date.now(),
          label: "Search refined",
          detail: "Visible constraints were applied to the catalog.",
          actor: "You" as const,
        },
        ...current,
      ].slice(0, 4),
    );
    void runSearch(next, "push");
  }

  function changeSort(sort: JobSearchCriteria["sort"]) {
    const next = { ...applied, sort, cursor: undefined };
    setApplied(next);
    setDraft((current) => ({ ...current, sort }));
    void runSearch(next, "push");
  }

  function toggleCompare(id: string) {
    setComparedJobIds((current) => {
      if (current.includes(id)) return current.filter((value) => value !== id);
      if (current.length >= 3) return current;
      return [...current, id];
    });
  }

  return (
    <div className={styles["workspace"]}>
      <aside className={styles["intentRail"]} aria-label="Search intent and filters">
        <section className={styles["outcomeSection"]}>
          <div className={styles["eyebrowRow"]}>
            <p className={styles["eyebrow"]}>Your outcome</p>
            <span className={styles["liveState"]}>
              <CircleIcon aria-hidden="true" size={7} weight="fill" />
              Editable
            </span>
          </div>
          <h1>{outcomeLabel(applied)}</h1>
          <p className={styles["outcomeHelp"]}>
            Every constraint below is explicit, editable, and shareable.
          </p>
        </section>

        <button
          className={styles["mobileFiltersButton"]}
          onClick={() => setFiltersOpen(true)}
          type="button"
        >
          <SlidersHorizontalIcon aria-hidden="true" size={17} />
          Filters
          <span>{filterSummary.length} active</span>
        </button>
        <SearchFilters
          className={styles["desktopFilters"] ?? ""}
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
        />

        <section className={styles["activityPreview"]} aria-labelledby="activity-heading">
          <div className={styles["activityHeader"]}>
            <div>
              <p className={styles["eyebrow"]} id="activity-heading">
                Agent activity
              </p>
              <WebMcpStatus />
            </div>
            <span className={styles["activityScope"]}>This session</span>
          </div>
          <ol>
            {activity.map((item) => (
              <li key={item.id}>
                <CircleIcon
                  aria-hidden="true"
                  className={styles["activityDot"]}
                  size={9}
                  weight="fill"
                />
                <div>
                  <strong>{item.label}</strong>
                  <p>{item.detail}</p>
                  <small>{item.actor} · just now</small>
                </div>
              </li>
            ))}
          </ol>
        </section>
      </aside>

      <Sheet
        className={styles["mobileFilterSheet"] ?? ""}
        description="Adjust the same transparent constraints used by search and WebMCP."
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
        <div className={styles["resultsHeader"]}>
          <div aria-label="Search status" role="status">
            <p className={styles["eyebrow"]}>Curated technology roles</p>
            <h2 id="results-heading">
              {result === null ? "Matching jobs" : `${String(result.total)} matches`}
            </h2>
          </div>
          <div className={styles["resultsControls"]}>
            <span
              aria-label="Comparison selection"
              className={styles["selectionStatus"]}
              role="status"
            >
              {comparedJobIds.length} selected
            </span>
            {comparedJobIds.length > 0 ? (
              <Link
                aria-label={`Compare ${String(comparedJobIds.length)} roles`}
                className={styles["compareLink"]}
                href={compareHref}
              >
                <ScalesIcon aria-hidden="true" size={16} />
                Compare {comparedJobIds.length}
              </Link>
            ) : null}
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
              <JobResult
                compareDisabled={comparedJobIds.length >= 3 && !comparedJobIds.includes(job.id)}
                compared={comparedJobIds.includes(job.id)}
                detailSearch={appliedSearch}
                expanded={expandedJobId === job.id}
                job={job}
                key={job.id}
                onCompare={() => toggleCompare(job.id)}
                onExpand={() => setExpandedJobId((current) => (current === job.id ? null : job.id))}
              />
            ))}
          </div>
        ) : null}

        {result !== null ? (
          <footer className={styles["resultsFooter"]}>
            <span>
              <ClockIcon aria-hidden="true" size={15} />
              Catalog updated {relativeFreshness(result.catalogUpdatedAt).replace("Updated ", "")}
            </span>
            <span>
              <MapPinIcon aria-hidden="true" size={15} />
              Search state is saved in this URL
            </span>
          </footer>
        ) : null}
      </section>
    </div>
  );
}
