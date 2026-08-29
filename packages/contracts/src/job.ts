import { z } from "zod";

import { entityIdSchema, isoInstantSchema } from "./common.js";

export const jobCategorySchema = z.enum([
  "software_engineering",
  "data_ai",
  "product",
  "design_research",
  "security",
  "infrastructure",
  "quality_assurance",
  "developer_relations",
  "technical_support_success",
  "technical_recruiting",
  "tech_operations_sales",
]);

export const workModelSchema = z.enum(["remote", "hybrid", "onsite", "flexible"]);

export const employmentTypeSchema = z.enum([
  "full_time",
  "part_time",
  "contract",
  "freelance",
  "internship",
]);

export const senioritySchema = z.enum([
  "entry",
  "mid",
  "senior",
  "staff",
  "principal",
  "lead",
  "manager",
  "director",
  "executive",
]);

export const salaryPeriodSchema = z.enum(["hour", "month", "year"]);
export const applyModeSchema = z.enum(["internal", "external"]);
export const jobStatusSchema = z.enum(["open", "closed", "stale"]);

export const currencyCodeSchema = z
  .string()
  .trim()
  .transform((value) => value.toUpperCase())
  .pipe(z.string().regex(/^[A-Z]{3}$/, "Expected an ISO 4217 currency code."));

export const salaryRangeSchema = z
  .strictObject({
    minimum: z.number().finite().nonnegative().nullable(),
    maximum: z.number().finite().nonnegative().nullable(),
    currency: currencyCodeSchema,
    period: salaryPeriodSchema,
  })
  .superRefine((value, context) => {
    if (value.minimum !== null && value.maximum !== null && value.maximum < value.minimum) {
      context.addIssue({
        code: "custom",
        message: "Maximum salary must be greater than or equal to minimum salary.",
        path: ["maximum"],
      });
    }
  });

export const jobSourceSchema = z.strictObject({
  key: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(80),
  url: z.string().url().nullable(),
});

export const jobSchema = z.strictObject({
  id: entityIdSchema,
  organizationId: entityIdSchema,
  organizationName: z.string().trim().min(1).max(160),
  title: z.string().trim().min(1).max(180),
  summary: z.string().trim().min(1).max(2_000),
  categories: z.array(jobCategorySchema).min(1).max(4),
  workModel: workModelSchema,
  employmentType: employmentTypeSchema,
  seniority: senioritySchema.nullable(),
  locations: z.array(z.string().trim().min(1).max(120)).min(1).max(8),
  skills: z.array(z.string().trim().min(1).max(80)).max(30),
  salary: salaryRangeSchema.nullable(),
  source: jobSourceSchema,
  applyMode: applyModeSchema,
  status: jobStatusSchema,
  publishedAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export const jobSummarySchema = jobSchema.extend({
  matchScore: z.number().min(0).max(100).optional(),
  matchEvidence: z.array(z.string().max(240)).max(12).optional(),
});

export type JobCategory = z.infer<typeof jobCategorySchema>;
export type WorkModel = z.infer<typeof workModelSchema>;
export type EmploymentType = z.infer<typeof employmentTypeSchema>;
export type Seniority = z.infer<typeof senioritySchema>;
export type SalaryPeriod = z.infer<typeof salaryPeriodSchema>;
export type SalaryRange = z.infer<typeof salaryRangeSchema>;
export type Job = z.infer<typeof jobSchema>;
export type JobSummary = z.infer<typeof jobSummarySchema>;
