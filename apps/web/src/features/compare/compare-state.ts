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
