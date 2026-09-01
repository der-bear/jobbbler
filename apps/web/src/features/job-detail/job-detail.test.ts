import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Job, JobFit } from "@jobbbler/contracts";
import type * as JobbblerUi from "@jobbbler/ui";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

/* Only the toast hook is stubbed; the real design-system components render. */
vi.mock("@jobbbler/ui", async (importOriginal) => ({
  ...(await importOriginal<typeof JobbblerUi>()),
  useToast: () => ({ show: vi.fn() }),
}));

import {
  JobDetail,
  applicationActionLabel,
  backToSearchHref,
  externalApplicationUrl,
  hasMeaningfulSearchCriteria,
  jobSummaryParagraphs,
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
  locations: ["Berlin, Germany", "Germany", "Europe"],
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

  it("renders the complete public detail description", () => {
    const fullDescription = `Opening context. ${"Source-backed role detail. ".repeat(32)}Final detail.`;
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "",
        initialResult: { job: { ...job, summary: fullDescription }, fit: noEvidenceFit },
      }),
    );

    expect(fullDescription.length).toBeGreaterThan(600);
    expect(jobSummaryParagraphs(fullDescription).join(" ")).toBe(fullDescription);
    expect(markup).toContain("About the role");
    expect(markup).toContain("Final detail.");
  });

  it("splits a description on the paragraphs it marks rather than on sentence pairs", () => {
    const authored = [
      "This role exists because monitoring coverage fell behind the network.",
      "What you will own: dashboards, alerting, and the incident review that follows. A second sentence keeps this paragraph longer than one.",
      "What we look for: production Prometheus experience and calm incident judgement.",
    ].join("\n\n");

    expect(jobSummaryParagraphs(authored)).toEqual([
      "This role exists because monitoring coverage fell behind the network.",
      "What you will own: dashboards, alerting, and the incident review that follows. A second sentence keeps this paragraph longer than one.",
      "What we look for: production Prometheus experience and calm incident judgement.",
    ]);
  });

  it("does not invent paragraph breaks for descriptions written as one block", () => {
    const unstructured = "One. Two. Three. Four. Five.";

    expect(jobSummaryParagraphs(unstructured)).toEqual([unstructured]);
  });

  it("collapses single line breaks inside one authored paragraph", () => {
    const wrapped = "First paragraph\nwrapped mid-sentence.\n\nSecond paragraph stands alone.";

    expect(jobSummaryParagraphs(wrapped)).toEqual([
      "First paragraph wrapped mid-sentence.",
      "Second paragraph stands alone.",
    ]);
  });

  it("keeps a dense source paragraph intact without dropping words", () => {
    const description =
      "First sentence explains the context. Second sentence explains the work. Third sentence covers collaboration. Fourth sentence covers success. Fifth sentence covers the team.";

    expect(jobSummaryParagraphs(description)).toEqual([description]);
  });

  it("places the return path before the role heading and the application action after key facts", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "?q=platform",
        initialResult: { job: { ...job, applyMode: "internal" }, fit: noEvidenceFit },
      }),
    );

    const backIndex = markup.indexOf("Back to search");
    const titleIndex = markup.indexOf("Senior Product Engineer");
    const remoteIndex = markup.indexOf(">Remote</span>");
    const locationIndex = markup.indexOf(">Berlin, Germany</span>");
    const applyIndex = markup.indexOf(">Apply<");
    expect(backIndex).toBeGreaterThanOrEqual(0);
    expect(titleIndex).toBeGreaterThanOrEqual(0);
    expect(remoteIndex).toBeGreaterThanOrEqual(0);
    expect(locationIndex).toBeGreaterThanOrEqual(0);
    expect(applyIndex).toBeGreaterThanOrEqual(0);
    expect(backIndex).toBeLessThan(titleIndex);
    expect(remoteIndex).toBeLessThan(locationIndex);
    expect(locationIndex).toBeLessThan(applyIndex);
    expect(applyIndex).toBeLessThan(
      markup.indexOf("Build calm, accessible collaboration workflows."),
    );
  });

  it("keeps the known employment type visible on the role detail", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "",
        initialResult: { job: { ...job, applyMode: "internal" }, fit: noEvidenceFit },
      }),
    );

    expect(markup).toContain(">Full-time</span>");
  });

  it("uses the catalog display currency on a directly opened role", () => {
    const salariedJob = {
      ...job,
      salary: { minimum: 100_000, maximum: 120_000, currency: "USD", period: "year" },
    } satisfies Job;
    const defaultMarkup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "",
        initialResult: { job: salariedJob, fit: noEvidenceFit },
      }),
    );
    const selectedMarkup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "?currency=USD",
        initialResult: { job: salariedJob, fit: noEvidenceFit },
      }),
    );

    expect(defaultMarkup).toContain("€86k–€103k / yr");
    expect(selectedMarkup).toContain("$100k–$120k / yr");
  });

  it("shows concrete cities without repeating broader search scopes", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "",
        initialResult: {
          job: {
            ...job,
            applyMode: "internal",
            locations: ["Berlin, Germany", "Hamburg, Germany", "Germany", "Europe"],
          },
          fit: noEvidenceFit,
        },
      }),
    );

    expect(markup).toContain(">Berlin, Germany, Hamburg, Germany</span>");
    expect(markup).not.toContain(">Europe</span>");
  });

  it("does not tell people to recheck a fictional demo posting on another site", () => {
    const markup = renderToStaticMarkup(
      createElement(JobDetail, {
        jobId: job.id,
        criteriaSearch: "",
        initialResult: {
          job: {
            ...job,
            applyMode: "internal",
            source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
          },
          fit: noEvidenceFit,
        },
      }),
    );

    expect(markup).toContain("Fictional role created for this product demonstration.");
    expect(markup).not.toContain("Recheck the original posting before applying.");
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
