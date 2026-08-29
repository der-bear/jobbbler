"use client";

import { ArrowSquareOutIcon, CheckCircleIcon, WarningCircleIcon } from "@phosphor-icons/react";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  compareJobsResultSchema,
  type CompareJobsResult,
  type Job,
  type JobFit,
} from "@jobbbler/contracts";

import {
  compactDate,
  employmentLabel,
  relativeFreshness,
  salaryLabel,
  seniorityLabel,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";

import { compareApiUrl, resolveCompareSelection } from "./compare-state";
import styles from "./compare-workspace.module.css";

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly result: CompareJobsResult }
  | { readonly kind: "error"; readonly message: string };

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError) return error.message;
  return "The comparison could not be loaded. Please retry.";
}

function JobHeading({ job }: Readonly<{ job: Job }>) {
  return (
    <div className={styles["jobHeading"]}>
      <h2>{job.title}</h2>
      <p>{job.organizationName}</p>
      <Link href={`/jobs/${encodeURIComponent(job.id)}`}>Open role</Link>
    </div>
  );
}

function FitNotes({ fit }: Readonly<{ fit: JobFit }>) {
  if (fit.evidence.length === 0)
    return <p className={styles["unknown"]}>No positive evidence supplied.</p>;
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
  if (notes.length === 0) return <p className={styles["unknown"]}>No trade-offs identified.</p>;
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

function ComparisonTable({ result }: Readonly<{ result: CompareJobsResult }>) {
  return (
    <div className={styles["tableScroll"]}>
      <table className={styles["comparisonTable"]}>
        <thead>
          <tr>
            <th scope="col">Criterion</th>
            {result.jobs.map(({ job }) => (
              <th key={job.id} scope="col">
                <JobHeading job={job} />
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          <tr>
            <th scope="row">Eligibility</th>
            {result.jobs.map(({ job, fit }) => (
              <td key={job.id}>{fit.eligible ? "Eligible" : "Does not meet current criteria"}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Work and location</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>
                {workModelLabel(job.workModel)} · {job.locations.join(", ")}
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
              <td key={job.id}>{salaryLabel(job.salary)}</td>
            ))}
          </tr>
          <tr>
            <th scope="row">Why it matches</th>
            {result.jobs.map(({ job, fit }) => (
              <td key={job.id}>
                <FitNotes fit={fit} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Trade-offs</th>
            {result.jobs.map(({ job, fit }) => (
              <td key={job.id}>
                <RiskNotes fit={fit} />
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Source and freshness</th>
            {result.jobs.map(({ job }) => (
              <td key={job.id}>
                <p className={styles["sourceFact"]}>{job.source.label}</p>
                <p className={styles["freshness"]}>
                  Observed {relativeFreshness(job.updatedAt).replace("Updated ", "")}
                </p>
                <p className={styles["freshness"]}>Published {compactDate(job.publishedAt)}</p>
                {job.source.url === null ? (
                  <p className={styles["unknown"]}>Original source link unavailable.</p>
                ) : (
                  <a href={job.source.url} rel="noreferrer" target="_blank">
                    View original source <ArrowSquareOutIcon aria-hidden="true" size={14} />
                  </a>
                )}
              </td>
            ))}
          </tr>
          <tr>
            <th scope="row">Unknowns</th>
            {result.jobs.map(({ job, fit }) => {
              const unknown = Object.values(fit.dimensions).filter(
                (dimension) => dimension.status === "unknown",
              ).length;
              return (
                <td key={job.id}>
                  {unknown === 0
                    ? "The source answered everything Jobbbler checks."
                    : `The source left ${String(unknown)} thing${unknown === 1 ? "" : "s"} unanswered — confirm with the employer.`}
                </td>
              );
            })}
          </tr>
        </tbody>
      </table>
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
      <Link href="/">Return to search</Link>
    </section>
  );
}

export function CompareWorkspace({
  jobIds,
  criteriaSearch,
}: Readonly<{ jobIds: readonly string[]; criteriaSearch: string }>) {
  const selection = useMemo(() => resolveCompareSelection(jobIds), [jobIds]);
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    if (selection.kind !== "ready") return;
    const controller = new AbortController();
    setState({ kind: "loading" });

    void queryApi(compareApiUrl(selection.jobIds, criteriaSearch), compareJobsResultSchema, {
      signal: controller.signal,
    })
      .then((result) => setState({ kind: "ready", result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [criteriaSearch, selection]);

  if (selection.kind !== "ready") return <EmptyComparison kind={selection.kind} />;
  if (state.kind === "loading") {
    return (
      <section aria-live="polite" className={styles["state"]}>
        <h1>Gathering source-backed facts</h1>
      </section>
    );
  }
  if (state.kind === "error") {
    return (
      <section aria-live="polite" className={styles["state"]}>
        <h1>{state.message}</h1>
        <Link href="/">Return to search</Link>
      </section>
    );
  }

  return (
    <section className={styles["workspace"]}>
      <header className={styles["header"]}>
        <div>
          <h1>Compare roles on the facts</h1>
        </div>
        <p>
          {state.result.jobs.length} role{state.result.jobs.length === 1 ? "" : "s"} · Current
          source records
        </p>
      </header>
      <ComparisonTable result={state.result} />
      <p className={styles["footnote"]}>
        Everything shown comes from the original listings, which remain the source of truth for
        availability and application details.
      </p>
    </section>
  );
}
