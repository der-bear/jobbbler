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
import { Chip, useToast } from "@jobbbler/ui";

import { startApplication } from "@/features/application/start-application";
import { externalApplicationUrl, supportsJobbblerPreparation } from "./application-capability";
import {
  compactDate,
  employmentLabel,
  locationBesideWorkModel,
  relativeFreshness,
  salaryLabel,
  seniorityLabel,
  titleWithoutEmploymentSuffix,
  workModelLabel,
} from "@/lib/job-format";
import { ApiClientError, queryApi } from "@/lib/query-client";
import { subscribeWebMcpJobDetailCommit } from "@/lib/webmcp-ui-bridge";

import styles from "./job-detail.module.css";

export { externalApplicationUrl, supportsJobbblerPreparation };

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

export function applicationActionLabel(job: Pick<Job, "applyMode">): string {
  return job.applyMode === "external" ? "Apply on employer site" : "Apply";
}

export function hasMeaningfulSearchCriteria(criteriaSearch: string): boolean {
  const parameters = new URLSearchParams(
    criteriaSearch.startsWith("?") ? criteriaSearch.slice(1) : criteriaSearch,
  );
  parameters.delete("sort");
  parameters.delete("limit");
  parameters.delete("cursor");
  return parameters.size > 0;
}

export function backToSearchHref(criteriaSearch: string): string {
  if (criteriaSearch.length === 0) return "/jobs";
  return `/jobs${criteriaSearch.startsWith("?") ? criteriaSearch : `?${criteriaSearch}`}`;
}

/* Preserve the author's paragraph structure; never manufacture semantic breaks. */
export function jobSummaryParagraphs(summary: string): readonly string[] {
  return summary
    .trim()
    .split(/\n{2,}/u)
    .map((paragraph) => paragraph.replace(/\s*\n\s*/gu, " ").trim())
    .filter((paragraph) => paragraph.length > 0);
}

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
  const employerApplicationUrl = externalApplicationUrl(job);
  const normalizedLocations = job.locations
    .map((location) => locationBesideWorkModel(location, job.workModel))
    .filter((location): location is string => location !== null);
  const factLocations = normalizedLocations.length === 0 ? null : normalizedLocations.join(", ");
  const factEmployment = employmentLabel(job.employmentType);

  return (
    <header className={styles["identity"]}>
      <Link className={styles["backLink"]} href={backToSearchHref(criteriaSearch)}>
        <ArrowLeftIcon aria-hidden="true" size={16} />
        Back to search
      </Link>
      <div className={styles["titleRow"]}>
        <div>
          <h1>{titleWithoutEmploymentSuffix(job.title, job.employmentType)}</h1>
          <p className={styles["organization"]}>{job.organizationName}</p>
        </div>
      </div>
      <div className={styles["facts"]}>
        <Chip tone={job.workModel === "onsite" ? "neutral" : "signal"}>
          {workModelLabel(job.workModel)}
        </Chip>
        {factLocations === null ? null : (
          <span>
            <MapPinIcon aria-hidden="true" size={16} />
            {factLocations}
          </span>
        )}
        <span>{factEmployment}</span>
        <span>
          {job.seniority === null ? "Seniority not stated" : seniorityLabel(job.seniority)}
        </span>
        <span className={styles["factSalary"]}>{salaryLabel(job.salary)}</span>
      </div>
      <div className={styles["actions"]}>
        {canPrepare ? (
          <button
            className={styles["applyButton"]}
            disabled={applicationBusy}
            onClick={onStartApplication}
            type="button"
          >
            <PaperPlaneTiltIcon aria-hidden="true" size={16} />
            {applicationBusy ? "Opening…" : applicationActionLabel(job)}
          </button>
        ) : employerApplicationUrl !== null ? (
          <a
            className={styles["applyButton"]}
            href={employerApplicationUrl}
            rel="noreferrer"
            target="_blank"
          >
            <PaperPlaneTiltIcon aria-hidden="true" size={16} />
            {applicationActionLabel(job)}
          </a>
        ) : (
          <span className={styles["unavailableLink"]}>
            The employer's application page is unavailable
          </span>
        )}
      </div>
      <section aria-labelledby="about-role" className={styles["description"]}>
        <h2 id="about-role">About the role</h2>
        <div className={styles["summary"]}>
          {jobSummaryParagraphs(job.summary).map((paragraph, index) => (
            <p key={`${String(index)}-${paragraph.slice(0, 32)}`}>{paragraph}</p>
          ))}
        </div>
      </section>
    </header>
  );
}

function FitEvidence({ criteriaSearch, fit }: Readonly<{ criteriaSearch: string; fit: JobFit }>) {
  if (!hasMeaningfulSearchCriteria(criteriaSearch)) return null;

  const hasEvidence =
    fit.evidence.length > 0 || fit.caveats.length > 0 || fit.exclusions.length > 0;
  const unknownDimensions = Object.entries(fit.dimensions)
    .filter(([, dimension]) => dimension.status === "unknown")
    .map(([key]) => dimensionLabels[key as keyof JobFit["dimensions"]]);

  if (!hasEvidence) {
    if (fit.eligible) return null;
    return (
      <section aria-labelledby="how-it-fits" className={styles["evidenceSection"]}>
        <div className={styles["sectionHeading"]}>
          <div>
            <h2 id="how-it-fits">How it fits your search</h2>
            <p className={styles["ineligibleNote"]}>Outside your current filters.</p>
          </div>
        </div>
      </section>
    );
  }

  return (
    <section aria-labelledby="how-it-fits" className={styles["evidenceSection"]}>
      <div className={styles["sectionHeading"]}>
        <div>
          <h2 id="how-it-fits">How it fits your search</h2>
          {fit.eligible || fit.exclusions.length > 0 ? null : (
            <p className={styles["ineligibleNote"]}>Outside your current filters.</p>
          )}
        </div>
      </div>
      <div className={styles["evidenceGrid"]}>
        {fit.evidence.length > 0 ? (
          <div>
            <h3>Matches</h3>
            <ListOrUnknown empty="" items={fit.evidence} />
          </div>
        ) : null}
        {fit.caveats.length > 0 || fit.exclusions.length > 0 ? (
          <div>
            <h3>Keep in mind</h3>
            <ListOrUnknown empty="" items={fit.caveats} tone="caution" />
            {fit.exclusions.length > 0 ? (
              <>
                <h3 className={styles["subheading"]}>Outside your current filters</h3>
                <ListOrUnknown empty="" items={fit.exclusions} tone="caution" />
              </>
            ) : null}
          </div>
        ) : null}
      </div>
      {unknownDimensions.length === 0 ? null : (
        <p className={styles["unknowns"]}>
          Not stated in the posting: {unknownDimensions.join(", ")}.
        </p>
      )}
    </section>
  );
}

function SourceAndFreshness({ job }: Readonly<{ job: Job }>) {
  const isDemoPosting = job.source.key === "jobbbler_demo";

  return (
    <section aria-labelledby="source-and-freshness" className={styles["provenanceSection"]}>
      <div>
        <h2 id="source-and-freshness">About this posting</h2>
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
        {isDemoPosting
          ? "Fictional role created for this product demonstration. No real vacancy or employer is implied."
          : "Facts are limited to the last observed source record. Recheck the original posting before applying."}
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
      <FitEvidence criteriaSearch={criteriaSearch} fit={result.fit} />
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

  if (state.kind === "loading") {
    return (
      <section aria-label="Loading this role" className={styles["state"]} role="status">
        <div className={styles["skeleton"]}>
          <span className={styles["skeletonTitle"]} />
          <span className={styles["skeletonOrg"]} />
          <span className={styles["skeletonMeta"]} />
          <span className={styles["skeletonLine"]} />
          <span className={styles["skeletonLineShort"]} />
        </div>
        <span className="sr-only">Loading this role.</span>
      </section>
    );
  }

  return (
    <section aria-live="polite" className={styles["state"]}>
      <h1>{state.message}</h1>
      <Link href="/jobs">Return to search</Link>
    </section>
  );
}
