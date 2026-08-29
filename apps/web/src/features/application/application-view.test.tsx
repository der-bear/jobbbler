import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import { ApplicationView } from "./application-view";

const workspace: ApplicationWorkspace = {
  draft: {
    id: "draft_550e8400-e29b-41d4-a716-446655440000",
    ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
    jobId: "job_550e8400-e29b-41d4-a716-446655440000",
    state: "draft",
    version: 1,
    answers: [
      {
        fieldKey: "full_name",
        value: "Ada Lovelace",
        provenance: "user_entered",
        sensitive: true,
        acceptedByHuman: true,
      },
      {
        fieldKey: "motivation",
        value: "An agent-authored starting point.",
        provenance: "agent_suggestion",
        sensitive: false,
        acceptedByHuman: false,
      },
    ],
    createdAt: "2026-08-29T10:00:00.000Z",
    updatedAt: "2026-08-29T10:01:00.000Z",
  },
  requirements: [
    {
      fieldKey: "full_name",
      label: "Full name",
      description: "Shared with the hiring team.",
      input: "text",
      required: true,
      sensitive: true,
      category: "identity",
      options: [],
    },
    {
      fieldKey: "motivation",
      label: "Why this role",
      description: "A short note for the hiring team.",
      input: "textarea",
      required: true,
      sensitive: false,
      category: "application_answers",
      options: [],
    },
  ],
  recipient: {
    id: "org_550e8400-e29b-41d4-a716-446655440000",
    name: "Northstar Systems",
  },
  purpose: "Submit this reviewed application to Northstar Systems.",
  noticeVersion: "privacy-2026-08-29",
  legalBasis: "user_instruction",
  review: null,
  dataGrant: null,
  delegationRequests: [],
  receipt: null,
};

const job = {
  id: workspace.draft.jobId,
  organizationId: workspace.recipient.id,
  organizationName: workspace.recipient.name,
  title: "Senior Product Engineer",
  summary: "Build calm, accessible collaboration workflows.",
  categories: ["software_engineering"],
  skills: ["TypeScript"],
  locations: ["Europe"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "senior",
  salary: null,
  applyMode: "internal",
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  publishedAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  status: "open",
} satisfies Job;

describe("ApplicationView", () => {
  it("presents progress, data permission, agent authority, and confirmation as separate controls", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "An agent-authored starting point." }}
        job={job}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={workspace}
      />,
    );

    expect(markup).toContain("Your application, under your control.");
    expect(markup).toContain("Profile facts");
    expect(markup).toContain("Data permission");
    expect(markup).toContain("Agent authority");
    expect(markup).toContain("Final confirmation");
    expect(markup).toContain('aria-current="step"');
    expect(markup).toContain("Needs your acceptance");
    expect(markup).toContain("Northstar Systems");
    expect(markup).not.toContain(workspace.draft.ownerId);
    expect(markup).not.toContain("payloadHash");
  });

  it("leaves an external application as an explicit source-link handoff", () => {
    const externalUrl = "https://jobs.example.test/opening/42";
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{}}
        job={{
          ...job,
          applyMode: "external",
          source: { key: "external_source", label: "External source", url: externalUrl },
        }}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          draft: { ...workspace.draft, state: "handed_off" },
          receipt: {
            id: "receipt_550e8400-e29b-41d4-a716-446655440000",
            status: "handed_off",
            externalUrl,
            createdAt: "2026-08-29T10:03:00.000Z",
          },
        }}
      />,
    );

    expect(markup).toContain("Ready for external handoff");
    expect(markup).toContain("Jobbbler did not submit this application");
    expect(markup).toContain(`href="${externalUrl}"`);
    expect(markup).toContain("Open external application");
  });
});
