import {
  jobSearchInputSchema,
  type JobSearchCriteria,
  type JobSearchInput,
  type ParsedJobSearchInput,
} from "@jobbbler/contracts";
import { normalizeJobSearchCriteria } from "@jobbbler/jobs-domain";

function single(parameters: URLSearchParams, name: string): string | undefined {
  const values = parameters.getAll(name);
  if (values.length > 1) throw new Error(`Expected one ${name} search parameter.`);
  return values[0];
}

function numberParameter(parameters: URLSearchParams, name: string): number | undefined {
  const value = single(parameters, name);
  if (value === undefined) return undefined;
  if (value.trim().length === 0) throw new Error(`${name} must be a number.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be a number.`);
  return parsed;
}

function appendAll(parameters: URLSearchParams, name: string, values: readonly string[]): void {
  for (const value of values) parameters.append(name, value);
}

export function searchInputToSearchParams(input: JobSearchInput): URLSearchParams {
  const criteria = normalizeJobSearchCriteria(input);
  const parameters = new URLSearchParams();

  if (criteria.query !== null) parameters.set("q", criteria.query);
  appendAll(parameters, "category", criteria.categories);
  appendAll(parameters, "work", criteria.workModels);
  appendAll(parameters, "employment", criteria.employmentTypes ?? []);
  appendAll(parameters, "seniority", criteria.seniorities);
  appendAll(parameters, "location", criteria.locations);
  appendAll(parameters, "skill", criteria.skills);
  appendAll(parameters, "exclude", criteria.excludeKeywords);

  if (criteria.salary !== null) {
    if (criteria.salary.minimum !== null) {
      parameters.set("salary_min", String(criteria.salary.minimum));
    }
    if (criteria.salary.maximum !== null) {
      parameters.set("salary_max", String(criteria.salary.maximum));
    }
    if (criteria.salary.currency !== null) parameters.set("currency", criteria.salary.currency);
    if (criteria.salary.period !== "year") parameters.set("period", criteria.salary.period);
    if (criteria.salary.unknownPolicy !== "include") {
      parameters.set("unknown_salary", criteria.salary.unknownPolicy);
    }
  }
  if (criteria.postedWithinDays !== null) {
    parameters.set("posted_within", String(criteria.postedWithinDays));
  }
  if (criteria.sort !== "relevance") parameters.set("sort", criteria.sort);
  if (criteria.cursor !== null) parameters.set("cursor", criteria.cursor);
  if (criteria.limit !== 20) parameters.set("limit", String(criteria.limit));
  return parameters;
}

export function searchParamsToInput(parameters: URLSearchParams): ParsedJobSearchInput {
  const salaryMinimum = numberParameter(parameters, "salary_min");
  const salaryMaximum = numberParameter(parameters, "salary_max");
  const currency = single(parameters, "currency");
  const period = single(parameters, "period");
  const unknownPolicy = single(parameters, "unknown_salary");
  const hasSalary =
    salaryMinimum !== undefined ||
    salaryMaximum !== undefined ||
    currency !== undefined ||
    period !== undefined ||
    unknownPolicy !== undefined;

  return jobSearchInputSchema.parse({
    query: single(parameters, "q"),
    categories: parameters.getAll("category"),
    workModels: parameters.getAll("work"),
    employmentTypes: parameters.getAll("employment"),
    seniorities: parameters.getAll("seniority"),
    locations: parameters.getAll("location"),
    skills: parameters.getAll("skill"),
    excludeKeywords: parameters.getAll("exclude"),
    salary: hasSalary
      ? {
          minimum: salaryMinimum,
          maximum: salaryMaximum,
          currency,
          period,
          unknownPolicy,
        }
      : undefined,
    postedWithinDays: numberParameter(parameters, "posted_within"),
    sort: single(parameters, "sort"),
    cursor: single(parameters, "cursor"),
    limit: numberParameter(parameters, "limit"),
  });
}

export function criteriaToSearchInput(criteria: JobSearchCriteria): JobSearchInput {
  return {
    ...(criteria.query === null ? {} : { query: criteria.query }),
    categories: criteria.categories,
    workModels: criteria.workModels,
    employmentTypes: criteria.employmentTypes ?? [],
    seniorities: criteria.seniorities,
    locations: criteria.locations,
    skills: criteria.skills,
    excludeKeywords: criteria.excludeKeywords,
    ...(criteria.salary === null
      ? {}
      : {
          salary: {
            ...(criteria.salary.minimum === null ? {} : { minimum: criteria.salary.minimum }),
            ...(criteria.salary.maximum === null ? {} : { maximum: criteria.salary.maximum }),
            ...(criteria.salary.currency === null ? {} : { currency: criteria.salary.currency }),
            period: criteria.salary.period,
            unknownPolicy: criteria.salary.unknownPolicy,
          },
        }),
    ...(criteria.postedWithinDays === null ? {} : { postedWithinDays: criteria.postedWithinDays }),
    sort: criteria.sort,
    limit: criteria.limit,
  };
}

export function searchHrefFromCriteria(criteria: JobSearchCriteria): string {
  const parameters = searchInputToSearchParams(criteriaToSearchInput(criteria));
  return parameters.size === 0 ? "/jobs" : `/jobs?${parameters.toString()}`;
}
