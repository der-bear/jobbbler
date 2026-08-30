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
  for (const jobId of jobIds) parameters.append("id", jobId);
  return `/api/v1/jobs/compare?${parameters.toString()}`;
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
import type { JobFit } from "@jobbbler/contracts";
