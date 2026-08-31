import { convertSalaryAmount } from "./currency.js";
import type { JobSearchCriteria } from "@jobbbler/contracts";

import { getJobSearchDocument, type Job } from "./job.js";

export type DimensionStatus =
  "match" | "partial" | "mismatch" | "unknown" | "below" | "excluded" | "not_requested";

export interface RankDimension {
  readonly status: DimensionStatus;
  readonly score: number;
  readonly matched: readonly string[];
  readonly missing: readonly string[];
}

export interface JobRank {
  readonly eligible: boolean;
  readonly score: number;
  readonly dimensions: {
    readonly text: RankDimension;
    readonly categories: RankDimension;
    readonly workModel: RankDimension;
    readonly seniority: RankDimension;
    readonly locations: RankDimension;
    readonly skills: RankDimension;
    readonly salary: RankDimension;
    readonly freshness: RankDimension;
  };
  readonly exclusions: readonly string[];
  readonly evidence: readonly string[];
  readonly caveats: readonly string[];
}

export interface RankJobContext {
  readonly now: Date;
}

const emptyDimension: RankDimension = {
  status: "not_requested",
  score: 1,
  matched: [],
  missing: [],
};

export function normalizeSearchText(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[_-]+/g, " ")
    .replace(/[^\p{Letter}\p{Number}+#. ]+/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function matchesText(haystack: string, needle: string): boolean {
  const normalizedNeedle = normalizeSearchText(needle);
  return normalizedNeedle.length > 0 && normalizeSearchText(haystack).includes(normalizedNeedle);
}

const textFieldWeights = {
  title: 1,
  skills: 0.9,
  organization: 0.8,
  categories: 0.75,
  locations: 0.6,
  summary: 0.45,
} as const;

function rankText(job: Job, requested: readonly string[]): RankDimension {
  if (requested.length === 0) return emptyDimension;

  const fields = {
    title: normalizeSearchText(job.title),
    skills: job.skills.map(normalizeSearchText),
    organization: normalizeSearchText(job.organizationName),
    categories: job.categories.map(normalizeSearchText),
    locations: job.locations.map(normalizeSearchText),
    summary: normalizeSearchText(job.summary),
  };
  const tokenScores = requested.map((token) => {
    if (fields.title.includes(token)) return textFieldWeights.title;
    if (fields.skills.some((value) => value.includes(token))) return textFieldWeights.skills;
    if (fields.organization.includes(token)) return textFieldWeights.organization;
    if (fields.categories.some((value) => value.includes(token))) {
      return textFieldWeights.categories;
    }
    if (fields.locations.some((value) => value.includes(token))) return textFieldWeights.locations;
    if (fields.summary.includes(token)) return textFieldWeights.summary;
    return 0;
  });
  const matched = requested.filter((_, index) => (tokenScores[index] ?? 0) > 0);
  const dimension = makeDimension(requested, matched, { hard: true });

  return {
    ...dimension,
    score: tokenScores.reduce<number>((total, score) => total + score, 0) / requested.length,
  };
}

function makeDimension(
  requested: readonly string[],
  matched: readonly string[],
  options: { hard?: boolean; unknown?: boolean } = {},
): RankDimension {
  if (requested.length === 0) return emptyDimension;
  if (options.unknown === true) {
    return { status: "unknown", score: 0.35, matched: [], missing: requested };
  }

  const missing = requested.filter((item) => !matched.includes(item));
  const ratio = matched.length / requested.length;
  const status: DimensionStatus = ratio === 1 ? "match" : ratio === 0 ? "mismatch" : "partial";

  return {
    status,
    score: options.hard === true && ratio === 0 ? 0 : ratio,
    matched,
    missing,
  };
}

function rankSalary(job: Job, criteria: JobSearchCriteria): RankDimension {
  const requested = criteria.salary;
  if (requested === null) return emptyDimension;

  if (job.salary === null) {
    if (requested.unknownPolicy === "only") {
      return {
        status: "match",
        score: 1,
        matched: ["undisclosed salary"],
        missing: [],
      };
    }
    return {
      status: "unknown",
      score: requested.unknownPolicy === "exclude" ? 0 : 0.4,
      matched: [],
      missing: ["salary"],
    };
  }

  if (requested.unknownPolicy === "only") {
    return {
      status: "mismatch",
      score: 0,
      matched: [],
      missing: ["unknown salary"],
    };
  }

  const hasAmountConstraint = requested.minimum !== null || requested.maximum !== null;
  if (!hasAmountConstraint) {
    return {
      status: "match",
      score: 1,
      matched: ["disclosed salary"],
      missing: [],
    };
  }

  if (requested.currency === null) {
    return {
      status: "unknown",
      score: requested.unknownPolicy === "exclude" ? 0 : 0.4,
      matched: [],
      missing: ["comparable salary"],
    };
  }

  if (job.salary.period !== requested.period) {
    return {
      status: "unknown",
      score: requested.unknownPolicy === "exclude" ? 0 : 0.4,
      matched: [],
      missing: ["comparable salary"],
    };
  }

  const requestedCurrency = requested.currency;
  const jobCurrency = job.salary.currency ?? requestedCurrency;
  const converted = jobCurrency !== requestedCurrency;
  const convert = (amount: number | null): number | null =>
    amount === null ? null : convertSalaryAmount(amount, jobCurrency, requestedCurrency);
  const jobLow = convert(job.salary.minimum);
  const jobHigh = convert(job.salary.maximum) ?? jobLow;
  if (converted && jobLow === null && jobHigh === null) {
    return {
      status: "unknown",
      score: requested.unknownPolicy === "exclude" ? 0 : 0.4,
      matched: [],
      missing: ["comparable salary"],
    };
  }

  const lacksRequiredBound =
    (requested.minimum !== null && jobLow === null) ||
    (requested.maximum !== null && convert(job.salary.maximum) === null);
  if (lacksRequiredBound) {
    return {
      status: "unknown",
      score: requested.unknownPolicy === "exclude" ? 0 : 0.4,
      matched: [],
      missing: ["required salary bound"],
    };
  }

  if (requested.minimum !== null && (jobHigh === null || jobHigh < requested.minimum)) {
    return {
      status: "below",
      score: 0,
      matched: [],
      missing: [`minimum ${requested.currency} ${requested.minimum}`],
    };
  }

  if (requested.maximum !== null && jobLow !== null && jobLow > requested.maximum) {
    return {
      status: "mismatch",
      score: 0,
      matched: [],
      missing: [`maximum ${requested.currency} ${requested.maximum}`],
    };
  }

  const partiallyOverlapsMinimum =
    requested.minimum !== null && jobLow !== null && jobLow < requested.minimum;

  return {
    status: partiallyOverlapsMinimum ? "partial" : "match",
    score: partiallyOverlapsMinimum ? 0.7 : 1,
    matched: [converted ? `salary (≈ converted from ${jobCurrency})` : "salary"],
    missing: [],
  };
}

function rankFreshness(
  job: Job,
  criteria: JobSearchCriteria,
  context: RankJobContext,
): RankDimension {
  if (criteria.postedWithinDays === null) return emptyDimension;

  const publishedAt = Date.parse(job.publishedAt);
  const cutoff = context.now.getTime() - criteria.postedWithinDays * 24 * 60 * 60 * 1_000;
  const matches = publishedAt >= cutoff && publishedAt <= context.now.getTime();

  return {
    status: matches ? "match" : "mismatch",
    score: matches ? 1 : 0,
    matched: matches ? [`posted within ${criteria.postedWithinDays} days`] : [],
    missing: matches ? [] : [`posted within ${criteria.postedWithinDays} days`],
  };
}

export function rankJob(job: Job, criteria: JobSearchCriteria, context: RankJobContext): JobRank {
  const document = getJobSearchDocument(job);
  const queryTokens = criteria.query === null ? [] : normalizeSearchText(criteria.query).split(" ");
  const text = rankText(job, queryTokens);

  const matchedCategories = criteria.categories.filter((category) =>
    job.categories.includes(category),
  );
  const categories = makeDimension(criteria.categories, matchedCategories, { hard: true });

  const matchedWorkModels = criteria.workModels.filter((workModel) => workModel === job.workModel);
  const workModel = makeDimension(criteria.workModels, matchedWorkModels, { hard: true });

  const requestedEmploymentTypes = criteria.employmentTypes ?? [];
  const employmentTypeMatches =
    requestedEmploymentTypes.length === 0 || requestedEmploymentTypes.includes(job.employmentType);

  const matchedSeniorities =
    job.seniority === null
      ? []
      : criteria.seniorities.filter((seniority) => seniority === job.seniority);
  const seniority = makeDimension(criteria.seniorities, matchedSeniorities, {
    unknown: job.seniority === null,
  });

  const matchedLocations = criteria.locations.filter((requested) =>
    job.locations.some((actual) => matchesText(actual, requested)),
  );
  const locations = makeDimension(criteria.locations, matchedLocations, { hard: true });

  const matchedSkills = criteria.skills.filter((requested) =>
    job.skills.some((actual) => normalizeSearchText(actual) === normalizeSearchText(requested)),
  );
  const skills = makeDimension(criteria.skills, matchedSkills);
  const salary = rankSalary(job, criteria);
  const freshness = rankFreshness(job, criteria, context);

  const exclusions = criteria.excludeKeywords
    .filter((keyword) => matchesText(document, keyword))
    .map((keyword) => normalizeSearchText(keyword));

  const requestedDimensions = [
    { dimension: text, weight: 30 },
    { dimension: categories, weight: 15 },
    { dimension: workModel, weight: 10 },
    { dimension: seniority, weight: 10 },
    { dimension: locations, weight: 10 },
    { dimension: skills, weight: 15 },
    { dimension: salary, weight: 10 },
    { dimension: freshness, weight: 5 },
  ].filter(({ dimension }) => dimension.status !== "not_requested");

  const totalWeight = requestedDimensions.reduce((total, item) => total + item.weight, 0);
  const weightedScore = requestedDimensions.reduce(
    (total, item) => total + item.dimension.score * item.weight,
    0,
  );

  const hardMismatch = [text, categories, workModel, locations, freshness].some(
    (dimension) => dimension.status === "mismatch",
  );
  const seniorityMismatch = ["mismatch", "unknown"].includes(seniority.status);
  const salaryMismatch = ["below", "mismatch"].includes(salary.status);
  const excludedUnknownSalary =
    salary.status === "unknown" && criteria.salary?.unknownPolicy === "exclude";

  const eligible =
    job.status === "open" &&
    exclusions.length === 0 &&
    employmentTypeMatches &&
    !hardMismatch &&
    !seniorityMismatch &&
    !salaryMismatch &&
    !excludedUnknownSalary;

  const evidence: string[] = [];
  if (text.status === "match") evidence.push("Search terms match the job content.");
  if (categories.status === "match") evidence.push("Category matches the requested work.");
  if (workModel.status === "match") evidence.push(`Work model is ${job.workModel}.`);
  if (requestedEmploymentTypes.length > 0 && employmentTypeMatches) {
    evidence.push(`Employment type is ${job.employmentType}.`);
  }
  if (seniority.status === "match") evidence.push(`Seniority is ${job.seniority}.`);
  if (locations.status === "match") evidence.push("Location matches the requested region.");
  if (skills.matched.length > 0) {
    evidence.push(`Matched skills: ${skills.matched.join(", ")}.`);
  }
  if (salary.status === "match") evidence.push("Compensation matches the requested range.");
  if (salary.status === "partial")
    evidence.push("Compensation range partially overlaps the target.");
  if (freshness.status === "match") {
    evidence.push(`Published within ${criteria.postedWithinDays} days.`);
  }
  for (const exclusion of exclusions) evidence.push(`Excluded keyword matched: ${exclusion}.`);

  const caveats: string[] = [];
  if (salary.status === "unknown") caveats.push("Comparable compensation is unavailable.");
  if (seniority.status === "unknown") caveats.push("Seniority is not specified.");
  if (skills.status === "partial") caveats.push("Only some requested skills are explicit.");

  return {
    eligible,
    score: eligible ? Math.round(totalWeight === 0 ? 50 : (weightedScore / totalWeight) * 100) : 0,
    dimensions: {
      text,
      categories,
      workModel,
      seniority,
      locations,
      skills,
      salary,
      freshness,
    },
    exclusions,
    evidence,
    caveats,
  };
}
