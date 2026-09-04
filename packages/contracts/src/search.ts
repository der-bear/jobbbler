import { z } from "zod";

import {
  currencyCodeSchema,
  employmentTypeSchema,
  jobCategorySchema,
  jobSummarySchema,
  salaryPeriodSchema,
  senioritySchema,
  workModelSchema,
} from "./job.js";

const searchTextSchema = z.string().trim().min(1).max(500);
const filterTextSchema = z.string().trim().min(1).max(120);

export const unknownSalaryPolicySchema = z.enum(["include", "exclude", "only"]);
export const searchSortSchema = z.enum([
  "relevance",
  "newest",
  "updated_desc",
  "salary_desc",
  "salary_asc",
]);

/** Currencies a salary criterion can be compared against the catalog in. */
export const comparableSalaryCurrencies = ["USD", "EUR", "GBP", "CAD"] as const;

export const salarySearchSchema = z
  .strictObject({
    minimum: z.number().finite().nonnegative().optional(),
    maximum: z.number().finite().nonnegative().optional(),
    currency: currencyCodeSchema.optional(),
    period: salaryPeriodSchema.default("year"),
    unknownPolicy: unknownSalaryPolicySchema.default("include"),
  })
  .superRefine((value, context) => {
    if (
      value.minimum !== undefined &&
      value.maximum !== undefined &&
      value.maximum < value.minimum
    ) {
      context.addIssue({
        code: "custom",
        message: "Maximum salary must be greater than or equal to minimum salary.",
        path: ["maximum"],
      });
    }

    if (
      (value.minimum !== undefined || value.maximum !== undefined) &&
      value.currency === undefined
    ) {
      context.addIssue({
        code: "custom",
        message:
          "Currency is required when a salary amount is provided; infer it from the person's wording or location before asking.",
        path: ["currency"],
      });
    }

    if (
      value.currency !== undefined &&
      !comparableSalaryCurrencies.some((currency) => currency === value.currency)
    ) {
      context.addIssue({
        code: "custom",
        message: `Use ${comparableSalaryCurrencies.join(", ")}; other currencies cannot be compared against this catalog.`,
        path: ["currency"],
      });
    }
  });

export const jobSearchInputSchema = z.strictObject({
  query: searchTextSchema.optional(),
  categories: z.array(jobCategorySchema).max(12).optional(),
  workModels: z.array(workModelSchema).max(4).optional(),
  employmentTypes: z.array(employmentTypeSchema).max(5).optional(),
  seniorities: z.array(senioritySchema).max(9).optional(),
  locations: z.array(filterTextSchema).max(12).optional(),
  remoteOrLocations: z.boolean().optional(),
  skills: z.array(filterTextSchema).max(20).optional(),
  excludeKeywords: z.array(filterTextSchema).max(20).optional(),
  salary: salarySearchSchema.optional(),
  postedWithinDays: z.number().int().min(1).max(365).optional(),
  sort: searchSortSchema.default("relevance"),
  cursor: z.string().trim().min(1).max(256).optional(),
  limit: z.number().int().min(1).max(50).default(20),
});

export const normalizedSalarySearchSchema = z.strictObject({
  minimum: z.number().finite().nonnegative().nullable(),
  maximum: z.number().finite().nonnegative().nullable(),
  currency: currencyCodeSchema.nullable(),
  period: salaryPeriodSchema,
  unknownPolicy: unknownSalaryPolicySchema,
});

export const jobSearchCriteriaSchema = z.strictObject({
  query: searchTextSchema.nullable(),
  categories: z.array(jobCategorySchema),
  workModels: z.array(workModelSchema),
  employmentTypes: z.array(employmentTypeSchema).optional(),
  seniorities: z.array(senioritySchema),
  locations: z.array(filterTextSchema),
  remoteOrLocations: z.boolean().optional(),
  skills: z.array(filterTextSchema),
  excludeKeywords: z.array(filterTextSchema),
  salary: normalizedSalarySearchSchema.nullable(),
  postedWithinDays: z.number().int().min(1).max(365).nullable(),
  sort: searchSortSchema,
  cursor: z.string().max(256).nullable(),
  limit: z.number().int().min(1).max(50),
  unresolvedAssumptions: z.array(z.string().trim().min(1).max(240)).max(12),
});

export const searchJobsResultSchema = z.strictObject({
  criteria: jobSearchCriteriaSchema,
  jobs: z.array(jobSummarySchema),
  total: z.number().int().nonnegative(),
  nextCursor: z.string().max(256).nullable(),
  /*
   * Nullable, because an empty result set genuinely has no catalog timestamp.
   * The worker, the latest-run schema and the storage port all already model
   * it that way; only this outward contract insisted on a value, which forced
   * the command to invent one.
   */
  catalogUpdatedAt: z.iso.datetime({ offset: true }).nullable(),
  warnings: z.array(z.string().max(240)).max(12),
});

export const locationSuggestionsResultSchema = z.strictObject({
  locations: z.array(filterTextSchema).max(20),
});

export type JobSearchInput = z.input<typeof jobSearchInputSchema>;
export type ParsedJobSearchInput = z.output<typeof jobSearchInputSchema>;
export type JobSearchCriteria = z.infer<typeof jobSearchCriteriaSchema>;
export type SearchJobsResult = z.infer<typeof searchJobsResultSchema>;
export type LocationSuggestionsResult = z.infer<typeof locationSuggestionsResultSchema>;
