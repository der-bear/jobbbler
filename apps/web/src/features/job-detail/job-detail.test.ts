import { describe, expect, it } from "vitest";

import type { Job } from "@jobbbler/contracts";

import {
  applicationActionLabel,
  externalApplicationUrl,
  hasMeaningfulSearchCriteria,
  supportsJobbblerPreparation,
} from "./job-detail";
import { applicationCapabilityData, applicationCapabilitySummary } from "./application-capability";

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
  it("keeps external postings out of Jobbbler's internal application workspace", () => {
    expect(supportsJobbblerPreparation(job)).toBe(false);
    expect(supportsJobbblerPreparation({ ...job, applyMode: "internal" })).toBe(true);
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

  it("tells people when the employer site owns the final application", () => {
    expect(applicationActionLabel(job)).toBe("Apply on employer site");
    expect(applicationActionLabel({ ...job, applyMode: "internal" })).toBe("Apply");
    expect(externalApplicationUrl(job)).toBe("https://jobs.example.test/opening/42");
    expect(
      externalApplicationUrl({
        ...job,
        source: { ...job.source, url: "https://user:secret@jobs.example.test/opening/42" },
      }),
    ).toBeNull();
  });

  it("describes an external role without inventing a Jobbbler preparation flow", () => {
    expect(applicationCapabilityData(job)).toMatchObject({
      applyMode: "external",
      preparationAvailable: false,
      employerSite: { required: true, target: "jobs.example.test", available: true },
    });
    expect(applicationCapabilityData(job)).not.toHaveProperty("externalHandoff");
    expect(applicationCapabilitySummary(job)).toBe(
      "External role: continue on the employer's website; Jobbbler does not submit it.",
    );
  });
});

describe("job-detail fit explanation", () => {
  it("shows search-fit evidence only when a real search criterion is present", () => {
    expect(hasMeaningfulSearchCriteria("")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?sort=relevance")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?q=platform&sort=relevance")).toBe(true);
    expect(hasMeaningfulSearchCriteria("?location=Europe")).toBe(true);
  });
});
