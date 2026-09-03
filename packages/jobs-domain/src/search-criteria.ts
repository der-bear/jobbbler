import {
  jobSearchCriteriaSchema,
  jobSearchInputSchema,
  type JobSearchCriteria,
  type JobSearchInput,
} from "@jobbbler/contracts";
import { DomainError } from "@jobbbler/core-domain";

const collator = new Intl.Collator("en", { sensitivity: "base" });
const everyWorkModel = ["flexible", "hybrid", "onsite", "remote"] as const;

const canonicalCountryByAlias = new Map<string, string>([
  ["global", "Worldwide"],
  ["gb", "United Kingdom"],
  ["uk", "United Kingdom"],
  ["us", "United States"],
  ["usa", "United States"],
]);

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

export function canonicalizeLocation(value: string): string {
  const collapsed = collapseWhitespace(value);
  const alias = collapsed.normalize("NFKC").toLocaleLowerCase("en").replace(/[.\s]/g, "");
  return canonicalCountryByAlias.get(alias) ?? collapsed;
}

export function isRemoteLocationIntent(value: string): boolean {
  return collapseWhitespace(value).normalize("NFKC").toLocaleLowerCase("en") === "remote";
}

function uniqueEnumValues<TValue extends string>(values: readonly TValue[] | undefined): TValue[] {
  return [...new Set(values ?? [])].sort((left, right) => left.localeCompare(right));
}

function uniqueDisplayValues(values: readonly string[] | undefined): string[] {
  const unique = new Map<string, string>();

  for (const rawValue of values ?? []) {
    const value = collapseWhitespace(rawValue);
    const key = value.normalize("NFKC").toLocaleLowerCase("en");
    if (!unique.has(key)) unique.set(key, value);
  }

  return [...unique.values()].sort(collator.compare);
}

export function normalizeJobSearchCriteria(input: JobSearchInput): JobSearchCriteria {
  const parsed = jobSearchInputSchema.parse(input);
  const normalizedLocations = uniqueDisplayValues(parsed.locations?.map(canonicalizeLocation));
  const remoteLocationIntent = normalizedLocations.some(isRemoteLocationIntent);
  const locations = normalizedLocations.filter((location) => !isRemoteLocationIntent(location));
  if (parsed.remoteOrLocations === true && locations.length === 0) {
    throw new DomainError({
      code: "VALIDATION",
      message:
        "remoteOrLocations requires at least one city, country, or region; use workModels=['remote'] for remote-only searches.",
    });
  }
  const remoteOrLocations =
    locations.length > 0 && (parsed.remoteOrLocations === true || remoteLocationIntent);
  const requestedWorkModels = parsed.workModels ?? [];
  const workModels = remoteOrLocations
    ? requestedWorkModels.length === 0
      ? everyWorkModel
      : [...requestedWorkModels, "remote" as const]
    : [...requestedWorkModels, ...(remoteLocationIntent ? (["remote"] as const) : [])];

  return jobSearchCriteriaSchema.parse({
    query: parsed.query === undefined ? null : collapseWhitespace(parsed.query),
    categories: uniqueEnumValues(parsed.categories),
    workModels: uniqueEnumValues(workModels),
    employmentTypes: uniqueEnumValues(parsed.employmentTypes),
    seniorities: uniqueEnumValues(parsed.seniorities),
    locations,
    ...(remoteOrLocations ? { remoteOrLocations: true } : {}),
    skills: uniqueDisplayValues(parsed.skills),
    excludeKeywords: uniqueDisplayValues(parsed.excludeKeywords),
    salary:
      parsed.salary === undefined
        ? null
        : {
            minimum: parsed.salary.minimum ?? null,
            maximum: parsed.salary.maximum ?? null,
            currency: parsed.salary.currency ?? null,
            period: parsed.salary.period,
            unknownPolicy: parsed.salary.unknownPolicy,
          },
    postedWithinDays: parsed.postedWithinDays ?? null,
    sort: parsed.sort,
    cursor: parsed.cursor ?? null,
    limit: parsed.limit,
    unresolvedAssumptions: [],
  });
}
