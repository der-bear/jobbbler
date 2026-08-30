"use client";

import {
  ArrowClockwiseIcon,
  BriefcaseIcon,
  BellSimpleIcon,
  CaretDownIcon,
  ClockIcon,
  MagnifyingGlassIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
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

import { useWebMcp } from "@/components/webmcp-provider";
import {
  categoryLabel,
  relativeFreshness,
  salaryCardPresentation,
  seniorityLabel,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { searchInputToSearchParams, searchParamsToInput } from "@/lib/search-url";
import { publishSearchSurfaceState, subscribeWebMcpSearchCommit } from "@/lib/webmcp-ui-bridge";

import { CurrencySelector, isDisplayCurrency, type DisplayCurrency } from "./currency-selector";
import { defaultSearch, type InitialSearchState } from "./initial-search-state";
import { LocationCombobox } from "./location-combobox";

import styles from "./search-workspace.module.css";

const salaryThresholds = [
  40_000, 60_000, 80_000, 100_000, 120_000, 150_000, 200_000, 250_000,
] as const;

interface SearchDraft {
  readonly query: string;
  readonly categories: readonly JobCategory[];
  readonly workModels: readonly WorkModel[];
  readonly seniorities: readonly Seniority[];
  readonly location: string;
  readonly postedWithinDays: string;
  readonly minimumSalary: string;
  readonly currency: DisplayCurrency;
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
    currency:
      input.salary?.currency !== undefined && isDisplayCurrency(input.salary.currency)
        ? input.salary.currency
        : "EUR",
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

function hasMeaningfulSearchCriteria(input: JobSearchInput): boolean {
  return (
    (input.query?.trim().length ?? 0) > 0 ||
    (input.categories?.length ?? 0) > 0 ||
    (input.workModels?.length ?? 0) > 0 ||
    (input.seniorities?.length ?? 0) > 0 ||
    (input.locations?.length ?? 0) > 0 ||
    (input.skills?.length ?? 0) > 0 ||
    (input.excludeKeywords?.length ?? 0) > 0 ||
    input.salary !== undefined ||
    input.postedWithinDays !== undefined ||
    (input.limit ?? 20) > 20
  );
}

export function deriveSearchPresentation(
  input: JobSearchInput,
  result: SearchJobsResult | null,
  mode: "home" | "catalog" = "home",
): Readonly<{
  heading: string;
  landing: boolean;
  resultLayout: "cards" | "list";
  showHeroSearch: boolean;
  showFilters: boolean;
  visibleJobs: readonly JobSummary[];
}> {
  const hasCriteria = hasMeaningfulSearchCriteria(input);
  const landing = mode === "home" && !hasCriteria;
  return {
    heading: landing
      ? "Latest technology roles"
      : hasCriteria
        ? `${String(result?.total ?? 0)} matches`
        : "All technology roles",
    landing,
    resultLayout: landing ? "cards" : "list",
    showHeroSearch: landing,
    showFilters: !landing,
    visibleJobs: result === null ? [] : landing ? result.jobs.slice(0, 6) : result.jobs,
  };
}

export function searchWorkspaceHref(input: JobSearchInput, mode: "home" | "catalog"): string {
  if (mode === "home") return "/";
  const parameters = searchInputToSearchParams(input);
  return parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
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
  const advancedFiltersReactId = useId();
  const advancedFiltersId = `advanced-search-filters-${advancedFiltersReactId.replaceAll(":", "")}`;
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const activeAdvancedFilterCount = [
    draft.workModels.length > 0,
    draft.categories.length > 0,
    draft.seniorities.length > 0,
    draft.postedWithinDays !== "",
    draft.minimumSalary !== "",
    draft.excludeKeywords.trim().length > 0,
  ].filter(Boolean).length;

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
      <label className={styles["filterRow"]}>
        <span>Search</span>
        <span className={styles["railSearch"]}>
          <MagnifyingGlassIcon aria-hidden="true" size={15} />
          <input
            maxLength={500}
            onBlur={() => onCommit(draft)}
            onChange={(event) => onDraftChange({ ...draft, query: event.target.value })}
            onKeyDown={commitOnEnter}
            placeholder="Role, skill or company"
            type="search"
            value={draft.query}
          />
        </span>
      </label>
      <div className={styles["filterRow"]}>
        <span>Location</span>
        <div className={styles["railLocation"]}>
          <LocationCombobox
            onChange={(location) => onDraftChange({ ...draft, location })}
            onCommit={(location) => onCommit({ ...draft, location })}
            value={draft.location}
          />
        </div>
      </div>
      <div className={styles["advancedFilters"]}>
        <button
          aria-controls={advancedFiltersId}
          aria-expanded={advancedOpen}
          className={styles["advancedSummary"]}
          onClick={() => setAdvancedOpen((open) => !open)}
          type="button"
        >
          <span>More filters</span>
          <span>
            {activeAdvancedFilterCount === 0
              ? "Optional"
              : `${String(activeAdvancedFilterCount)} active`}
          </span>
          <CaretDownIcon aria-hidden="true" size={14} />
        </button>
        <div
          className={`${styles["advancedFilterBody"]} ${advancedOpen ? styles["advancedFilterBodyOpen"] : ""}`}
          id={advancedFiltersId}
        >
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
              <CurrencySelector
                onChange={(currency) => onCommit({ ...draft, currency })}
                value={draft.currency}
              />
              <select
                aria-label="Minimum annual salary"
                onChange={(event) => onCommit({ ...draft, minimumSalary: event.target.value })}
                value={draft.minimumSalary}
              >
                <option value="">Any salary</option>
                {draft.minimumSalary !== "" &&
                !salaryThresholds.includes(
                  Number(draft.minimumSalary) as (typeof salaryThresholds)[number],
                ) ? (
                  <option value={draft.minimumSalary}>
                    {Intl.NumberFormat("en", { notation: "compact" }).format(
                      Number(draft.minimumSalary),
                    )}
                    +
                  </option>
                ) : null}
                {salaryThresholds.map((amount) => (
                  <option key={amount} value={String(amount)}>
                    {Intl.NumberFormat("en", { notation: "compact" }).format(amount)}+
                  </option>
                ))}
              </select>
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
        </div>
      </div>
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
  displayCurrency,
  job,
  detailSearch,
}: Readonly<{
  displayCurrency: DisplayCurrency;
  job: JobSummary;
  detailSearch: string;
}>) {
  const salary = salaryCardPresentation(job.salary, displayCurrency);
  const salaryExplanationId =
    salary.explanation === null ? undefined : `salary-explanation-${job.id}`;
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
            <span>{workModelLabel(job.workModel)}</span>
            {job.locations[0]}
          </span>
        </Link>
        <div className={styles["jobSalary"]}>
          <strong aria-describedby={salaryExplanationId} title={salary.explanation ?? undefined}>
            {salary.label}
          </strong>
          {salary.explanation === null ? null : (
            <span className="sr-only" id={salaryExplanationId}>
              {salary.explanation}
            </span>
          )}
          <small>{relativeFreshness(job.updatedAt)}</small>
        </div>
      </div>
    </article>
  );
}

export function SearchWorkspace({
  initialSearch,
  mode,
}: Readonly<{ initialSearch: InitialSearchState; mode: "home" | "catalog" }>) {
  const router = useRouter();
  const webMcp = useWebMcp();
  const [applied, setApplied] = useState<JobSearchInput>(initialSearch.input);
  const [draft, setDraft] = useState<SearchDraft>(() => draftFromInput(initialSearch.input));
  const [result, setResult] = useState<SearchJobsResult | null>(initialSearch.result);
  const [status, setStatus] = useState<"idle" | "loading" | "ready" | "error">(
    initialSearch.error === null ? "ready" : "error",
  );
  const [error, setError] = useState<string | null>(initialSearch.error);
  const activityCount = webMcp.activities.length;
  const seenActivityCount = useRef(0);

  const [agentPulse, setAgentPulse] = useState(false);

  useEffect(() => {
    if (activityCount > seenActivityCount.current) {
      setAgentPulse(true);
      const timer = window.setTimeout(() => setAgentPulse(false), 900);
      seenActivityCount.current = activityCount;
      return () => window.clearTimeout(timer);
    }
    seenActivityCount.current = activityCount;
    return undefined;
  }, [activityCount]);
  const requestSequence = useRef(0);
  const activeSearch = useRef<AbortController | null>(null);

  const runSearch = useCallback(
    async (input: JobSearchInput, history: "push" | "replace") => {
      activeSearch.current?.abort();
      const controller = new AbortController();
      activeSearch.current = controller;
      const sequence = requestSequence.current + 1;
      requestSequence.current = sequence;
      const parameters = searchInputToSearchParams(input);
      const target = searchWorkspaceHref(input, mode);
      window.history[history === "push" ? "pushState" : "replaceState"]({}, "", target);
      setStatus("loading");
      setError(null);

      try {
        const next = await queryApi(
          `/api/v1/jobs/search${parameters.size === 0 ? "" : `?${parameters.toString()}`}`,
          searchJobsResultSchema,
          { signal: controller.signal },
        );
        if (requestSequence.current !== sequence) return;
        setResult(next);
        setStatus("ready");
      } catch (searchError) {
        if (controller.signal.aborted) return;
        if (requestSequence.current !== sequence) return;
        setError(errorMessage(searchError));
        setStatus("error");
      } finally {
        if (activeSearch.current === controller) activeSearch.current = null;
      }
    },
    [mode],
  );

  useEffect(() => () => activeSearch.current?.abort(), []);

  useEffect(() => {
    const restore = () => {
      try {
        const restored = searchFromLocation();
        setApplied(restored);
        setDraft(draftFromInput(restored));
        void runSearch(restored, "replace");
      } catch {
        activeSearch.current?.abort();
        requestSequence.current += 1;
        setError("Some search filters are invalid. Adjust them and search again.");
        setStatus("error");
      }
    };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, [runSearch]);

  useEffect(
    () =>
      subscribeWebMcpSearchCommit(({ input, result: committedResult }) => {
        activeSearch.current?.abort();
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

  const appliedSearch = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    return parameters.size === 0 ? "" : `?${parameters.toString()}`;
  }, [applied]);

  const saveAlertHref = useMemo(() => {
    const parameters = searchInputToSearchParams(applied);
    parameters.set("create", "1");
    return `/saved?${parameters.toString()}`;
  }, [applied]);

  const presentation = useMemo(
    () => deriveSearchPresentation(applied, result, mode),
    [applied, mode, result],
  );
  function commitDraft(next: SearchDraft) {
    setDraft(next);
    const input = inputFromDraft(next);
    if (
      searchInputToSearchParams(input).toString() === searchInputToSearchParams(applied).toString()
    ) {
      return;
    }
    if (mode === "home") {
      const parameters = searchInputToSearchParams(input);
      router.push(parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`);
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

  return (
    <div className={styles["workspace"]} data-landing={String(presentation.landing)}>
      {presentation.showHeroSearch ? (
        <header className={styles["hero"]}>
          <h1>Find your next technology role</h1>
          <p className={styles["heroSub"]}>
            One clear search for roles that fit how you want to work.
          </p>
          <form className={styles["heroSearch"]} onSubmit={submit} role="search">
            <label className={styles["heroField"]}>
              <MagnifyingGlassIcon aria-hidden="true" size={17} />
              <input
                aria-label="Search jobs"
                maxLength={500}
                onChange={(event) => setDraft({ ...draft, query: event.target.value })}
                placeholder="Role, skill or company"
                type="search"
                value={draft.query}
              />
            </label>
            <span aria-hidden="true" className={styles["heroDivider"]} />
            <div className={styles["heroLocation"]}>
              <LocationCombobox
                onChange={(location) => setDraft((current) => ({ ...current, location }))}
                onCommit={(location) => setDraft((current) => ({ ...current, location }))}
                value={draft.location}
              />
            </div>
            <button type="submit">Search</button>
          </form>
        </header>
      ) : null}

      {presentation.showFilters ? (
        <aside aria-label="Filters" className={styles["filterRail"]}>
          <SearchFilters draft={draft} onCommit={commitDraft} onDraftChange={setDraft} />
        </aside>
      ) : null}

      <section className={styles["results"]} aria-labelledby="results-heading">
        <div className={styles["resultsHeader"]} data-agent-pulse={String(agentPulse)}>
          <div aria-label="Search status" role="status">
            {presentation.landing ? (
              <h2 id="results-heading">{presentation.heading}</h2>
            ) : (
              <h1 id="results-heading">{presentation.heading}</h1>
            )}
          </div>
          {presentation.landing ? null : (
            <div className={styles["resultsControls"]}>
              <Link className={styles["saveAlertLink"]} href={saveAlertHref}>
                <BellSimpleIcon aria-hidden="true" size={16} />
                Save alert
              </Link>
              <label className={styles["sortControl"]}>
                <span>Sort</span>
                <span className={styles["sortSelect"]}>
                  <select
                    aria-label="Sort jobs"
                    onChange={(event) => changeSort(searchSortSchema.parse(event.target.value))}
                    value={applied.sort ?? "relevance"}
                  >
                    <option value="relevance">Best match</option>
                    <option value="newest">Newest</option>
                    <option value="salary_desc">Highest salary</option>
                  </select>
                  <CaretDownIcon aria-hidden="true" size={13} />
                </span>
              </label>
            </div>
          )}
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

        {result !== null && presentation.visibleJobs.length === 0 ? (
          <div className={styles["emptyState"]}>
            <BriefcaseIcon aria-hidden="true" size={30} />
            <h3>No exact matches yet</h3>
            <p>Broaden one constraint. Your search remains visible and editable on the left.</p>
          </div>
        ) : null}

        {presentation.visibleJobs.length > 0 ? (
          <div
            className={styles["resultList"]}
            data-layout={presentation.resultLayout}
            data-loading={String(status === "loading")}
          >
            {presentation.visibleJobs.map((job) => (
              <JobResult
                detailSearch={appliedSearch}
                displayCurrency={draft.currency}
                job={job}
                key={job.id}
              />
            ))}
          </div>
        ) : null}

        {presentation.landing && (result?.total ?? 0) > presentation.visibleJobs.length ? (
          <div className={styles["landingFooter"]}>
            <Link href="/jobs?sort=newest&limit=50">View all roles</Link>
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
    </div>
  );
}
