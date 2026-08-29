import { z } from "zod";

import { entityIdSchema } from "./common.js";
import { jobSchema } from "./job.js";
import { jobSearchCriteriaSchema, jobSearchInputSchema } from "./search.js";

export const jobIdSchema = entityIdSchema.refine((value) => value.startsWith("job_"), {
  message: "Expected a job ID.",
});

export const rankDimensionStatusSchema = z.enum([
  "match",
  "partial",
  "mismatch",
  "unknown",
  "below",
  "excluded",
  "not_requested",
]);

export const rankDimensionSchema = z.strictObject({
  status: rankDimensionStatusSchema,
  score: z.number().min(0).max(1),
  matched: z.array(z.string().max(240)).max(30),
  missing: z.array(z.string().max(240)).max(30),
});

export const jobFitSchema = z.strictObject({
  eligible: z.boolean(),
  score: z.number().min(0).max(100),
  evidence: z.array(z.string().max(240)).max(12),
  caveats: z.array(z.string().max(240)).max(12),
  exclusions: z.array(z.string().max(240)).max(12),
  dimensions: z.strictObject({
    text: rankDimensionSchema,
    categories: rankDimensionSchema,
    workModel: rankDimensionSchema,
    seniority: rankDimensionSchema,
    locations: rankDimensionSchema,
    skills: rankDimensionSchema,
    salary: rankDimensionSchema,
    freshness: rankDimensionSchema,
  }),
});

export const jobDetailInputSchema = z.strictObject({
  jobId: jobIdSchema,
  criteria: jobSearchInputSchema.optional(),
});

export const jobDetailResultSchema = z.strictObject({
  job: jobSchema,
  fit: jobFitSchema,
});

export const compareJobsInputSchema = z
  .strictObject({
    jobIds: z.array(jobIdSchema).min(1).max(3),
    criteria: jobSearchInputSchema.optional(),
  })
  .superRefine(({ jobIds }, context) => {
    if (new Set(jobIds).size !== jobIds.length) {
      context.addIssue({ code: "custom", path: ["jobIds"], message: "Job IDs must be unique." });
    }
  });

export const comparedJobSchema = z.strictObject({
  job: jobSchema,
  fit: jobFitSchema,
});

export const compareJobsResultSchema = z.strictObject({
  criteria: jobSearchCriteriaSchema,
  jobs: z.array(comparedJobSchema).min(1).max(3),
});

export type RankDimensionStatus = z.infer<typeof rankDimensionStatusSchema>;
export type RankDimensionContract = z.infer<typeof rankDimensionSchema>;
export type JobFit = z.infer<typeof jobFitSchema>;
export type JobDetailInput = z.input<typeof jobDetailInputSchema>;
export type JobDetailResult = z.infer<typeof jobDetailResultSchema>;
export type CompareJobsInput = z.input<typeof compareJobsInputSchema>;
export type CompareJobsResult = z.infer<typeof compareJobsResultSchema>;
