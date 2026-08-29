"use client";

import {
  ArrowLeftIcon,
  CheckCircleIcon,
  ClockIcon,
  MapPinIcon,
  PaperPlaneTiltIcon,
  WarningCircleIcon,
} from "@phosphor-icons/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";

import {
  jobDetailResultSchema,
  type Job,
  type JobDetailResult,
  type JobFit,
} from "@jobbbler/contracts";
import { useToast } from "@jobbbler/ui";

import { startApplication } from "@/features/application/start-application";
import { supportsJobbblerPreparation } from "./application-capability";
import {
  compactDate,
  employmentLabel,
  relativeFreshness,
  salaryLabel,
  seniorityLabel,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { subscribeWebMcpJobDetailCommit } from "@/lib/webmcp-ui-bridge";

import styles from "./job-detail.module.css";

export { supportsJobbblerPreparation };

type LoadState =
  | { readonly kind: "loading" }
  | { readonly kind: "ready"; readonly result: JobDetailResult }
  | { readonly kind: "error"; readonly message: string };

const dimensionLabels: Readonly<Record<keyof JobFit["dimensions"], string>> = {
  text: "Role text",
  categories: "Function",
  workModel: "Work model",
  seniority: "Seniority",
  locations: "Location",
  skills: "Skills",
  salary: "Compensation",
  freshness: "Freshness",
};

function errorMessage(error: unknown): string {
  if (error instanceof ApiClientError && error.code === "NOT_FOUND") {
    return "This role is no longer available in the current catalog.";
  }
  if (error instanceof ApiClientError) return error.message;
  return "This role could not be loaded. Please retry.";
}

function ListOrUnknown({
  items,
  empty,
  tone = "positive",
}: Readonly<{
  items: readonly string[];
  empty: string;
  tone?: "positive" | "caution";
}>) {
  if (items.length === 0) return <p className={styles["unknown"]}>{empty}</p>;

  return (
    <ul className={styles["insightList"]}>
      {items.map((item, index) => (
        <li
          className={tone === "caution" ? styles["caution"] : undefined}
          key={`${String(index)}-${item}`}
        >
          {tone === "positive" ? (
            <CheckCircleIcon aria-hidden="true" size={17} weight="fill" />
          ) : (
            <WarningCircleIcon aria-hidden="true" size={17} weight="regular" />
          )}
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function JobIdentity({
  job,
  criteriaSearch,
  applicationBusy,
  onStartApplication,
}: Readonly<{
  job: Job;
  criteriaSearch: string;
  applicationBusy: boolean;
  onStartApplication(): void;
}>) {
  const canPrepare = supportsJobbblerPreparation(job);

  return (
    <header className={styles["identity"]}>
      <div className={styles["titleRow"]}>
        <div>
          <h1>{job.title}</h1>
          <p className={styles["organization"]}>{job.organizationName}</p>
        </div>
      </div>
      <div className={styles["facts"]}>
        <span>
          <MapPinIcon aria-hidden="true" size={16} />
          {workModelLabel(job.workModel)} · {job.locations.join(", ")}
        </span>
        <span>{employmentLabel(job.employmentType)}</span>
        <span>
          {job.seniority === null ? "Seniority not stated" : seniorityLabel(job.seniority)}
        </span>
        <span>{salaryLabel(job.salary)}</span>
      </div>
      <p className={styles["summary"]}>{job.summary}</p>
      <div className={styles["actions"]}>
        <Link className={styles["backLink"]} href={`/${criteriaSearch}`}>
          <ArrowLeftIcon aria-hidden="true" size={16} />
          Back to search
        </Link>
        {canPrepare ? (
          <button
            className={styles["applyButton"]}
            disabled={applicationBusy}
            onClick={onStartApplication}
            type="button"
          >
            <PaperPlaneTiltIcon aria-hidden="true" size={16} />
            {applicationBusy
              ? "Opening application…"
              : job.applyMode === "external"
                ? "Prepare to apply on the employer's site"
                : "Apply with Jobbbler"}
          </button>
        ) : (
          <span className={styles["unavailableLink"]}>
            The employer's application page is unavailable
          </span>
        )}
      </div>
    </header>
  );
}

function FitEvidence({ fit }: Readonly<{ fit: JobFit }>) {
  const hasSignal =
    fit.evidence.length > 0 || fit.caveats.length > 0 || fit.exclusions.length > 0 || !fit.eligible;
  const unknownDimensions = Object.entries(fit.dimensions)
    .filter(([, dimension]) => dimension.status === "unknown")
    .map(([key]) => dimensionLabels[key as keyof JobFit["dimensions"]]);

  if (!hasSignal) return null;

  return (
    <section aria-labelledby="why-this-matches" className={styles["evidenceSection"]}>
      <div className={styles["sectionHeading"]}>
        <div>
          <h2 id="why-this-matches">Why this matches</h2>
          {fit.eligible ? null : (
            <p className={styles["ineligibleNote"]}>
              This role does not meet your current criteria.
            </p>
          )}
        </div>
      </div>
      <div className={styles["evidenceGrid"]}>
        <div>
          <h3>Evidence</h3>
          <ListOrUnknown
            empty="No positive evidence was supplied for the current criteria."
            items={fit.evidence}
          />
        </div>
        <div>
          <h3>Trade-offs</h3>
          <ListOrUnknown
            empty="No trade-offs were identified."
            items={fit.caveats}
            tone="caution"
          />
          {fit.exclusions.length > 0 ? (
            <>
              <h3 className={styles["subheading"]}>Exclusions</h3>
              <ListOrUnknown
                empty="No exclusions were identified."
                items={fit.exclusions}
                tone="caution"
              />
            </>
          ) : null}
        </div>
      </div>
      <div className={styles["unknowns"]}>
        <h3>What to verify</h3>
        <p>
          {unknownDimensions.length === 0
            ? "The source answered everything Jobbbler checks."
            : `The source did not say: ${unknownDimensions.join(", ")}. Confirm these with the employer.`}
        </p>
      </div>
    </section>
  );
}

function SourceAndFreshness({ job }: Readonly<{ job: Job }>) {
  return (
    <section aria-labelledby="source-and-freshness" className={styles["provenanceSection"]}>
      <div>
        <h2 id="source-and-freshness">Source and freshness</h2>
      </div>
      <dl className={styles["provenanceList"]}>
        <div>
          <dt>Source</dt>
          <dd>{job.source.label}</dd>
        </div>
        <div>
          <dt>Record freshness</dt>
          <dd>{relativeFreshness(job.updatedAt)}</dd>
        </div>
        <div>
          <dt>Published</dt>
          <dd>{compactDate(job.publishedAt)}</dd>
        </div>
        <div>
          <dt>Application</dt>
          <dd>
            {job.applyMode === "external"
              ? "Finishes on the employer's website"
              : "Handled on Jobbbler"}
          </dd>
        </div>
      </dl>
      <p className={styles["sourceNote"]}>
        <ClockIcon aria-hidden="true" size={16} />
        Facts are limited to the last observed source record. Recheck the original posting before
        applying.
      </p>
    </section>
  );
}

function DetailContent({
  result,
  criteriaSearch,
  applicationBusy,
  onStartApplication,
}: Readonly<{
  result: JobDetailResult;
  criteriaSearch: string;
  applicationBusy: boolean;
  onStartApplication(): void;
}>) {
  return (
    <article className={styles["workspace"]}>
      <JobIdentity
        applicationBusy={applicationBusy}
        criteriaSearch={criteriaSearch}
        job={result.job}
        onStartApplication={onStartApplication}
      />
      <FitEvidence fit={result.fit} />
      <section className={styles["roleFacts"]}>
        <div>
          <h2>Skills</h2>
        </div>
        <div className={styles["skills"]}>
          {result.job.skills.length === 0 ? (
            <p className={styles["unknown"]}>No skills were listed by the source.</p>
          ) : (
            result.job.skills.map((skill, index) => (
              <span key={`${String(index)}-${skill}`}>{skill}</span>
            ))
          )}
        </div>
      </section>
      <SourceAndFreshness job={result.job} />
    </article>
  );
}

export function JobDetail({
  jobId,
  criteriaSearch,
  initialResult,
}: Readonly<{
  jobId: string;
  criteriaSearch: string;
  initialResult?: JobDetailResult | undefined;
}>) {
  const [state, setState] = useState<LoadState>(() =>
    initialResult === undefined ? { kind: "loading" } : { kind: "ready", result: initialResult },
  );
  const hydratedFromServer = useRef(initialResult !== undefined);
  const [applicationBusy, setApplicationBusy] = useState(false);
  const router = useRouter();
  const toast = useToast();

  async function beginApplication() {
    if (state.kind !== "ready" || applicationBusy) return;
    setApplicationBusy(true);
    try {
      await startApplication(state.result.job.id, {
        request: queryApi,
        navigate: (href) => router.push(href),
      });
    } catch (error) {
      toast.show({
        title: "Application could not be opened",
        description: errorMessage(error),
        tone: "danger",
      });
      setApplicationBusy(false);
    }
  }

  useEffect(
    () =>
      subscribeWebMcpJobDetailCommit((result) => {
        if (result.job.id !== jobId) return;
        flushSync(() => setState({ kind: "ready", result }));
      }),
    [jobId],
  );

  useEffect(() => {
    if (hydratedFromServer.current) {
      hydratedFromServer.current = false;
      return;
    }
    const controller = new AbortController();
    setState({ kind: "loading" });

    void queryApi(
      `/api/v1/jobs/${encodeURIComponent(jobId)}${criteriaSearch}`,
      jobDetailResultSchema,
      {
        signal: controller.signal,
      },
    )
      .then((result) => setState({ kind: "ready", result }))
      .catch((error: unknown) => {
        if (controller.signal.aborted) return;
        setState({ kind: "error", message: errorMessage(error) });
      });

    return () => controller.abort();
  }, [criteriaSearch, jobId]);

  if (state.kind === "ready")
    return (
      <DetailContent
        applicationBusy={applicationBusy}
        criteriaSearch={criteriaSearch}
        onStartApplication={() => void beginApplication()}
        result={state.result}
      />
    );

  return (
    <section aria-live="polite" className={styles["state"]}>
      <h1>{state.kind === "loading" ? "Loading this role…" : state.message}</h1>
      {state.kind === "error" ? <Link href="/">Return to search</Link> : null}
    </section>
  );
}
