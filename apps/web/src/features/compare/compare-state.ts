import type { Job, JobFit } from "@jobbbler/contracts";

export type CompareSelection =
  | { readonly kind: "ready"; readonly jobIds: readonly string[] }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid" };

export function resolveCompareSelection(values: readonly string[]): CompareSelection {
  const jobIds = values.map((value) => value.trim());

  if (jobIds.length === 0) return { kind: "missing" };
  if (
    jobIds.length > 3 ||
    jobIds.some((jobId) => jobId.length === 0) ||
    new Set(jobIds).size !== jobIds.length
  ) {
    return { kind: "invalid" };
  }

  return { kind: "ready", jobIds };
}

export function compareApiUrl(jobIds: readonly string[], criteriaSearch = ""): string {
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("compare");
  parameters.delete("id");
  for (const jobId of jobIds) parameters.append("id", jobId);
  return `/api/v1/jobs/compare?${parameters.toString()}`;
}

export function comparePageHref(jobIds: readonly string[], criteriaSearch = ""): string {
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("compare");
  parameters.delete("id");
  for (const jobId of jobIds) parameters.append("id", jobId);
  return parameters.size === 0 ? "/compare" : `/compare?${parameters.toString()}`;
}

export function comparisonJobHref(jobId: string, criteriaSearch = ""): string {
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("compare");
  parameters.delete("id");
  const suffix = parameters.toString();
  return `/jobs/${encodeURIComponent(jobId)}${suffix.length === 0 ? "" : `?${suffix}`}`;
}

export function comparisonSearchHref(jobIds: readonly string[], criteriaSearch = ""): string {
  const parameters = new URLSearchParams(criteriaSearch);
  parameters.delete("compare");
  parameters.delete("id");
  for (const jobId of jobIds) parameters.append("compare", jobId);
  return parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
}

export function removeComparedJob(
  jobIds: readonly string[],
  removedJobId: string,
): readonly string[] {
  return jobIds.filter((jobId) => jobId !== removedJobId);
}

export function comparisonLocation(locations: readonly string[]): string {
  return (
    locations.find((location) => location.includes(",")) ?? locations[0] ?? "Location not stated"
  );
}

export function comparisonSourceDestination(
  applyMode: Job["applyMode"],
  sourceUrl: string | null,
): string | null {
  if (sourceUrl !== null) return null;
  return applyMode === "internal" ? "Apply on Jobbbler" : "Application link unavailable";
}

export function comparisonRowVisibility(fits: readonly JobFit[]): Readonly<{
  eligibility: boolean;
  fit: boolean;
  tradeOffs: boolean;
  unknowns: boolean;
}> {
  return {
    eligibility: fits.some(({ eligible }) => !eligible),
    fit: fits.some(({ evidence }) => evidence.length > 0),
    tradeOffs: fits.some(({ caveats, exclusions }) => caveats.length + exclusions.length > 0),
    unknowns: fits.some(({ dimensions }) =>
      Object.values(dimensions).some(({ status }) => status === "unknown"),
    ),
  };
}
