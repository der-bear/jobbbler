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

  it("describes an external role without inventing a Jobbbler application workflow", () => {
    expect(applicationCapabilityData(job)).toEqual({
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      applyMode: "external",
      preparationAvailable: false,
      stages: [],
      agentAccess:
        "Unavailable: Jobbbler does not create an application resource for external roles.",
      humanSteps: ["Continue on the validated HTTPS employer application page"],
      submission:
        "Jobbbler creates no draft, receipt, handoff record, or submitted claim for this external role.",
      employerSite: { required: true, target: "jobs.example.test", available: true },
      withdrawalSupported: false,
      statusSyncSupported: false,
    });
    expect(applicationCapabilitySummary(job)).toBe(
      "External role: continue on the employer's website; Jobbbler does not submit it.",
    );
  });

  it("describes the request-bound external-agent decisions for an internal role", () => {
    const internalJob = { ...job, applyMode: "internal" } satisfies Job;

    expect(applicationCapabilityData(internalJob)).toEqual({
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      applyMode: "internal",
      preparationAvailable: true,
      stages: ["private_draft", "assistance_decision", "application_review", "submission_decision"],
      agentAccess:
        "Assistance requires the person's decision in the external agent client; the server accepts only the exact live request and records request-bound evidence.",
      humanSteps: [
        "Review or correct the answers the agent prepared",
        "Decide on the exact disclosure and submission in the external agent client",
        "Withdraw active consent from the same agent workflow when needed",
      ],
      submission:
        "Jobbbler submits only the unchanged internal-demo payload after an explicit request-bound decision in the external agent client; approval is single-use and expires in five minutes.",
      employerSite: { required: false },
      withdrawalSupported: true,
      statusSyncSupported: false,
    });
    expect(applicationCapabilitySummary(internalJob)).toBe(
      "Internal application: an agent may prepare it; the person makes request-bound assistance and submission decisions in the external agent client.",
    );
  });

  it("does not direct the person to an unavailable external application page", () => {
    const unavailableExternalJob = {
      ...job,
      source: { ...job.source, url: "http://jobs.example.test/opening/42" },
    } satisfies Job;

    expect(applicationCapabilityData(unavailableExternalJob)).toMatchObject({
      preparationAvailable: false,
      humanSteps: ["The employer application page is unavailable; do not continue from Jobbbler"],
      employerSite: { required: true, target: "jobs.example.test", available: false },
    });
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
