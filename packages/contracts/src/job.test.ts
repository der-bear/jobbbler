import { describe, expect, it } from "vitest";

import { jobSchema } from "./job.js";

const baseJob = {
  id: "job_00000001-0000-7000-8000-000000000001",
  organizationId: "org_00000001-0000-7000-8000-000000000001",
  organizationName: "Northstar Systems",
  title: "Platform Engineer",
  categories: ["software_engineering"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  locations: ["Berlin, Germany"],
  skills: ["TypeScript"],
  salary: null,
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  applyMode: "internal",
  status: "open",
  publishedAt: "2026-08-29T00:00:00.000Z",
  updatedAt: "2026-08-29T00:00:00.000Z",
} as const;

describe("jobSchema", () => {
  it("accepts a complete structured role description up to 6,000 characters", () => {
    expect(jobSchema.parse({ ...baseJob, summary: "S".repeat(6_000) }).summary).toHaveLength(6_000);
  });

  it("keeps the complete-description boundary explicit", () => {
    expect(() => jobSchema.parse({ ...baseJob, summary: "S".repeat(6_001) })).toThrow();
  });
});
