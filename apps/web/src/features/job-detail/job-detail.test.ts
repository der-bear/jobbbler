import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Job, JobFit } from "@jobbbler/contracts";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("@jobbbler/ui", () => ({
  useToast: () => ({ show: vi.fn() }),
}));

import {
  JobDetail,
  applicationActionLabel,
  backToSearchHref,
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

const notRequestedDimension: JobFit["dimensions"]["text"] = {
  status: "not_requested",
  score: 0,
  matched: [],
  missing: [],
};

const noEvidenceFit: JobFit = {
  eligible: false,
  score: 0,
  evidence: [],
  caveats: [],
  exclusions: [],
  dimensions: {
    text: notRequestedDimension,
    categories: notRequestedDimension,
    workModel: notRequestedDimension,
    seniority: notRequestedDimension,
    locations: notRequestedDimension,
    skills: notRequestedDimension,
    salary: notRequestedDimension,
    freshness: notRequestedDimension,
  },
};

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
  it("returns to the Jobs results instead of the home page", () => {
    expect(backToSearchHref("?q=platform&sort=newest")).toBe("/jobs?q=platform&sort=newest");
    expect(backToSearchHref("")).toBe("/jobs");
  });

  it("shows search-fit evidence only when a real search criterion is present", () => {
    expect(hasMeaningfulSearchCriteria("")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?sort=relevance")).toBe(false);
    expect(hasMeaningfulSearchCriteria("?q=platform&sort=relevance")).toBe(true);
    expect(hasMeaningfulSearchCriteria("?location=Europe")).toBe(true);
  });

  it("uses one concise explanation when active filters exclude a role without evidence", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "?work=remote",
        initialResult: { job, fit: noEvidenceFit },
      }),
    );

    expect(markup.match(/Outside your current filters\./g)).toHaveLength(1);
    expect(markup).not.toContain("No direct match evidence was available.");
    expect(markup).not.toContain(">Matches<");
    expect(markup).not.toContain("This role does not meet your current criteria.");
  });

  it("does not repeat the outside-filter explanation when exclusion evidence is available", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "?work=remote",
        initialResult: {
          job,
          fit: { ...noEvidenceFit, exclusions: ["Work model is on-site."] },
        },
      }),
    );

    expect(markup.match(/Outside your (?:current )?filters/g)).toHaveLength(1);
    expect(markup).toContain("Outside your current filters");
    expect(markup).toContain("Work model is on-site.");
  });
});
