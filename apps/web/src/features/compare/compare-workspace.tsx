"use client";

import { ArrowSquareOutIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useState } from "react";

import {
  compareJobsResultSchema,
  type CompareJobsResult,
  type Job,
  type JobFit,
} from "@jobbbler/contracts";

import {
  compactDate,
  displayCurrencyFromSearch,
  employmentLabel,
  relativeFreshness,
  salaryLabel,
  seniorityLabel,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";

import {
  compareApiUrl,
  comparePageHref,
  comparisonJobHref,
  comparisonLocation,
  comparisonRowVisibility,
  comparisonSearchHref,
  comparisonSourceDestination,
  removeComparedJob,
  resolveCompareSelection,
} from "./compare-state";
import styles from "./compare-workspace.module.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly result: CompareJobsResult }
  | { readonly kind: "error"; readonly message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "The comparison could not be loaded. Please retry.";
}

function JobHeading({
  criteriaSearch,
  job,
  removeHref,
}: Readonly<{ criteriaSearch: string; job: Job; removeHref: string }>) {
  return (
    <div className={styles["jobHeading"]}>
      <h2>{job.title}</h2>
      <p>{job.organizationName}</p>
      <div className={styles["jobActions"]}>
        <Link
          aria-label={`Open ${job.title} role`}
          href={comparisonJobHref(job.id, criteriaSearch)}
        >
          Open role
        </Link>
        <Link
          aria-label={`Remove ${job.title} from comparison`}
          className={styles["removeLink"]}
          href={removeHref}
        >
          Remove
        </Link>
      </div>
    </div>
  );
}

function FitNotes({ fit }: Readonly<{ fit: JobFit }>) {
  if (fit.evidence.length === 0)
    return <p className={styles["unknown"]}>No match evidence in the selected criteria.</p>;
  return (
    <ul className={styles["fitNotes"]}>
      {fit.evidence.slice(0, 3).map((evidence, index) => (
        <li key={`${String(index)}-${evidence}`}>
          <CheckCircleIcon aria-hidden="true" size={15} weight="fill" />
          {evidence}
        </li>
      ))}
    </ul>
  );
}

function RiskNotes({ fit }: Readonly<{ fit: JobFit }>) {
  const notes = [...fit.caveats, ...fit.exclusions];
  if (notes.length === 0)
    return <p className={styles["unknown"]}>No trade-offs found in the selected criteria.</p>;
  return (
    <ul className={styles["fitNotes"]}>
      {notes.slice(0, 3).map((note, index) => (
        <li key={`${String(index)}-${note}`}>
          <WarningCircleIcon aria-hidden="true" size={15} />
          {note}
        </li>
      ))}
    </ul>
  );
}

function unknownCount(fit: JobFit): number {
  return Object.values(fit.dimensions).filter((dimension) => dimension.status === "unknown").length;
}

function SourceFacts({ job }: Readonly<{ job: Job }>) {
  const destination = comparisonSourceDestination(job.applyMode, job.source.url);
  return (
    <>
      <p className={styles["sourceFact"]}>{job.source.label}</p>
      <p className={styles["freshness"]}>{relativeFreshness(job.updatedAt)}</p>
      <p className={styles["freshness"]}>Published {compactDate(job.publishedAt)}</p>
      {job.source.url === null ? (
        <p className={job.applyMode === "internal" ? styles["freshness"] : styles["unknown"]}>
          {destination}
        </p>
      ) : (
        <a href={job.source.url} rel="noreferrer" target="_blank">
          View original source <ArrowSquareOutIcon aria-hidden="true" size={14} />
        </a>
      )}
    </>
  );
}

function ComparisonTable({
  criteriaSearch,
  result,
  selectedJobIds,
}: Readonly<{
  criteriaSearch: string;
  result: CompareJobsResult;
  selectedJobIds: readonly string[];
}>) {
  const visible = comparisonRowVisibility(result.jobs.map(({ fit }) => fit));
  const displayCurrency = displayCurrencyFromSearch(criteriaSearch);
  return (
    <div className={styles["tableScroll"]}>
      <table className={styles["comparisonTable"]}>
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            {result.jobs.map(({ job }) => (
              <th key={job.id} scope="col">
                <JobHeading
                  criteriaSearch={criteriaSearch}
                  job={job}
                  removeHref={comparePageHref(
                    removeComparedJob(selectedJobIds, job.id),
                    criteriaSearch,
                  )}
                />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {visible.eligibility ? (
            <tr>
              <th scope="row">Eligibility</th>
              {result.jobs.map(({ job, fit }) => (
                <td key={job.id}>
                  {fit.eligible ? "Meets current criteria" : "Does not meet current criteria"}
                </td>
              ))}
            </tr>
          ) : null}
          <tr>
            <th scope="row">Work and location</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>
                {workModelLabel(job.workModel)} · {comparisonLocation(job.locations)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Level and type</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>
                {job.seniority === null ? "Seniority not stated" : seniorityLabel(job.seniority)} ·{" "}
                {employmentLabel(job.employmentType)}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Compensation</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>{salaryLabel(job.salary, displayCurrency)}</td>
            ))}
          </tr>
          {visible.fit ? (
            <tr>
              <th scope="row">Why it matches</th>
              {result.jobs.map(({ job, fit }) => (
                <td key={job.id}>
                  <FitNotes fit={fit} />
                </td>
              ))}
            </tr>
          ) : null}
          {visible.tradeOffs ? (
            <tr>
              <th scope="row">Trade-offs</th>
              {result.jobs.map(({ job, fit }) => (
                <td key={job.id}>
                  <RiskNotes fit={fit} />
                </td>
              ))}
            </tr>
          ) : null}
          <tr>
            <th scope="row">Source and freshness</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>
                <SourceFacts job={job} />
              </td>
            ))}
          </tr>
          {visible.unknowns ? (
            <tr>
              <th scope="row">Unknowns</th>
              {result.jobs.map(({ job, fit }) => {
                const unknown = unknownCount(fit);
                return (
                  <td key={job.id}>
                    {unknown === 0
                      ? "No missing facts in the selected criteria."
                      : `${String(unknown)} unanswered item${unknown === 1 ? "" : "s"} — confirm with the employer.`}
                  </td>
                );
              })}
            </tr>
          ) : null}
        </tbody>
      </table>
    </div>
  );
}

function MobileFact({ children, label }: Readonly<{ children: React.ReactNode; label: string }>) {
  return (
    <div>
      <dt>{label}</dt>
      <dd>{children}</dd>
    </div>
  );
}

function MobileComparison({
  criteriaSearch,
  result,
  selectedJobIds,
}: Readonly<{
  criteriaSearch: string;
  result: CompareJobsResult;
  selectedJobIds: readonly string[];
}>) {
  const visible = comparisonRowVisibility(result.jobs.map(({ fit }) => fit));
  const displayCurrency = displayCurrencyFromSearch(criteriaSearch);
  return (
    <div className={styles["mobileComparison"]}>
      {result.jobs.map(({ job, fit }) => {
        const unknown = unknownCount(fit);
        return (
          <article aria-label={`${job.title} at ${job.organizationName}`} key={job.id}>
            <JobHeading
              criteriaSearch={criteriaSearch}
              job={job}
              removeHref={comparePageHref(
                removeComparedJob(selectedJobIds, job.id),
                criteriaSearch,
              )}
            />
            <dl>
              {visible.eligibility ? (
                <MobileFact label="Eligibility">
                  {fit.eligible ? "Meets current criteria" : "Does not meet current criteria"}
                </MobileFact>
              ) : null}
              <MobileFact label="Work and location">
                {workModelLabel(job.workModel)} · {comparisonLocation(job.locations)}
              </MobileFact>
              <MobileFact label="Level and type">
                {job.seniority === null ? "Seniority not stated" : seniorityLabel(job.seniority)} ·{" "}
                {employmentLabel(job.employmentType)}
              </MobileFact>
              <MobileFact label="Compensation">
                {salaryLabel(job.salary, displayCurrency)}
              </MobileFact>
              {visible.fit ? (
                <MobileFact label="Why it matches">
                  <FitNotes fit={fit} />
                </MobileFact>
              ) : null}
              {visible.tradeOffs ? (
                <MobileFact label="Trade-offs">
                  <RiskNotes fit={fit} />
                </MobileFact>
              ) : null}
              <MobileFact label="Source and freshness">
                <SourceFacts job={job} />
              </MobileFact>
              {visible.unknowns ? (
                <MobileFact label="Unknowns">
                  {unknown === 0
                    ? "No missing facts in the selected criteria."
                    : `${String(unknown)} unanswered item${unknown === 1 ? "" : "s"} — confirm with the employer.`}
                </MobileFact>
              ) : null}
            </dl>
          </article>
        );
      })}
    </div>
  );
}

function EmptyComparison({ kind }: Readonly<{ kind: "missing" | "invalid" }>) {
  const invalid = kind === "invalid";
  return (
    <section className={styles["empty"]}>
      <h1>{invalid ? "Use one to three distinct roles" : "Choose roles to compare"}</h1>
      <p>
        {invalid
          ? "This comparison link lists the same role twice or more than three roles. Go back to search and pick up to three."
          : "Pick up to three roles from search to see their facts side by side. The link you get is shareable."}
      </p>
      <Link href="/jobs">Return to search</Link>
    </section>
  );
}

export function CompareWorkspace({
  jobIds,
  criteriaSearch,
}: Readonly<{ jobIds: readonly string[]; criteriaSearch: string }>) {
  const selection = resolveCompareSelection(jobIds);
  const requestUrl =
    selection.kind === "ready" ? compareApiUrl(selection.jobIds, criteriaSearch) : null;
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [loadAttempt, setLoadAttempt] = useState(0);

  useEffect(() => {
    if (requestUrl === null) return;
    const controller = new AbortController();
    const startRequest = window.setTimeout(() => {
      setState({ kind: "loading" });
      void queryApi(requestUrl, compareJobsResultSchema, { signal: controller.signal })
        .then((result) => setState({ kind: "ready", result }))
        .catch((error: unknown) => {
          if (controller.signal.aborted) return;
          setState({ kind: "error", message: errorMessage(error) });
        });
    }, 0);

    return () => {
      window.clearTimeout(startRequest);
      controller.abort();
    };
  }, [loadAttempt, requestUrl]);

  if (selection.kind !== "ready") return <EmptyComparison kind={selection.kind} />;
  const changeSelectionHref = comparisonSearchHref(selection.jobIds, criteriaSearch);
  const returnToSearchHref = comparisonSearchHref([], criteriaSearch);
  if (state.kind === "loading") {
    return (
      <section aria-label="Loading the comparison" className={styles["state"]} role="status">
        <div className={styles["skeleton"]}>
          <span className={styles["skeletonTitle"]} />
          <span className={styles["skeletonRow"]} />
          <span className={styles["skeletonRow"]} />
          <span className={styles["skeletonRow"]} />
        </div>
        <span className="sr-only">Loading the comparison.</span>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section aria-live="polite" className={styles["state"]}>
        <h1>{state.message}</h1>
        <div className={styles["stateActions"]}>
          <button onClick={() => setLoadAttempt((attempt) => attempt + 1)} type="button">
            Retry comparison
          </button>
          <Link href={changeSelectionHref}>Change selection</Link>
          <Link href={returnToSearchHref}>Return to search</Link>
        </div>
      </section>
    );
  }

  return (
    <section aria-label="Role comparison" className={styles["workspace"]}>
      <header className={styles["header"]}>
        <div>
          <h1>Compare roles on the facts</h1>
        </div>
        <p>
          {state.result.jobs.length} role{state.result.jobs.length === 1 ? "" : "s"} · Current
          source records
        </p>
      </header>
      <nav aria-label="Comparison actions" className={styles["comparisonActions"]}>
        <Link href={changeSelectionHref}>
          {selection.jobIds.length < 3 ? "Add another role" : "Change roles"}
        </Link>
        <Link href={returnToSearchHref}>Return to search</Link>
      </nav>
      <ComparisonTable
        criteriaSearch={criteriaSearch}
        result={state.result}
        selectedJobIds={selection.jobIds}
      />
      <MobileComparison
        criteriaSearch={criteriaSearch}
        result={state.result}
        selectedJobIds={selection.jobIds}
      />
    </section>
  );
}
