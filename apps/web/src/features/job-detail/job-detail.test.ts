import { describe, expect, it } from "vitest";

import type { Job } from "@jobbbler/contracts";

import { supportsJobbblerPreparation } from "./job-detail";

const job = {
  id: "job_550e8400-e29b-41d4-a716-446655440000",
  organizationId: "org_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Senior Product Engineer",
  summary: "Build calm, accessible collaboration workflows.",
  categories: ["software_engineering"],
  skills: ["TypeScript"],
  locations: ["Europe"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  salary: null,
  applyMode: "external",
  source: {
    key: "external_source",
    label: "External source",
    url: "https://jobs.example.test/opening/42",
  },
  publishedAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  status: "open",
} satisfies Job;

describe("job-detail application entry", () => {
  it("routes an external posting with an exact safe HTTPS source through Jobbbler preparation", () => {
    expect(supportsJobbblerPreparation(job)).toBe(true);
    expect(
      supportsJobbblerPreparation({
        ...job,
        source: { ...job.source, url: "http://jobs.example.test/opening/42" },
      }),
    ).toBe(false);
    expect(supportsJobbblerPreparation({ ...job, source: { ...job.source, url: null } })).toBe(
      false,
    );
  });
});
