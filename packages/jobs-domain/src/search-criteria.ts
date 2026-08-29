import {
  jobSearchCriteriaSchema,
  jobSearchInputSchema,
  type JobSearchCriteria,
  type JobSearchInput,
} from "@jobbbler/contracts";

const collator = new Intl.Collator("en", { sensitivity: "base" });

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
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

  return jobSearchCriteriaSchema.parse({
    query: parsed.query === undefined ? null : collapseWhitespace(parsed.query),
    categories: uniqueEnumValues(parsed.categories),
    workModels: uniqueEnumValues(parsed.workModels),
    seniorities: uniqueEnumValues(parsed.seniorities),
    locations: uniqueDisplayValues(parsed.locations),
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
