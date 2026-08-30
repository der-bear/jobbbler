import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import { ApplicationView } from "./application-view";

const workspace: ApplicationWorkspace = {
  applyMode: "internal",
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
  legalBasis: "consent",
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
  it("presents one document-like review instead of a four-step approval wizard", () => {
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

    expect(markup).toContain("Application for Senior Product Engineer");
    expect(markup).toContain("Review your application");
    expect(markup).toContain("2 of 2 details ready");
    expect(markup).toContain("Agent suggestion");
    expect(markup).toContain("Northstar Systems");
    expect(markup).toContain("Review and submit to Northstar Systems");
    expect(markup).not.toContain("Step 1 of 4");
    expect(markup).not.toContain("Permission</strong>");
    expect(markup).not.toContain("Assistant access");
    expect(markup).not.toContain("Final confirmation");
    expect(markup).not.toContain("Needs your acceptance");
    expect(markup).not.toContain("Continue to review");
    expect(markup).not.toContain(workspace.draft.ownerId);
    expect(markup).not.toContain("payloadHash");
  });

  it("describes agent-mediated decisions truthfully", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Agent draft" }}
        job={job}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          delegationRequests: [
            {
              id: "delegation_550e8400-e29b-41d4-a716-446655440000",
              agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
              operations: ["read_application", "edit_application"],
              purpose: "Prepare this application.",
              status: "requested",
              expiresAt: "2026-08-29T10:20:00.000Z",
              approvedAt: null,
            },
          ],
        }}
      />,
    );

    expect(markup).toContain("only after your explicit decision for this exact application");
    expect(markup).not.toContain("cannot approve sharing or submit for you");
  });

  it("shows missing questions without making the user inspect every complete field", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "" }}
        job={job}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          draft: {
            ...workspace.draft,
            answers: workspace.draft.answers.filter(({ fieldKey }) => fieldKey !== "motivation"),
          },
        }}
      />,
    );

    expect(markup).toContain("1 detail needed");
    expect(markup).toContain("Why this role");
    expect(markup).toContain("Ask your agent or fill it in here");
    expect(markup).toContain("disabled");
    expect(markup).not.toContain("Approve and continue");
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

    expect(markup).toContain("Ready to continue on the employer&#x27;s website");
    expect(markup).toContain("Jobbbler did not submit this application");
    expect(markup).toContain(`href="${externalUrl}"`);
    expect(markup).toContain("Back to applications");
    expect(markup).toContain('href="/applications"');
  });

  it("renders a legacy external draft as read-only without preparation or submission controls", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Legacy answer" }}
        job={{ ...job, applyMode: "external" }}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          applyMode: "external",
          dataGrant: {
            id: "grant_550e8400-e29b-41d4-a716-446655440000",
            status: "active",
            expiresAt: "2026-08-29T10:34:00.000Z",
          },
        }}
      />,
    );

    expect(markup).toContain("Legacy external application");
    expect(markup).toContain("read-only");
    expect(markup).toContain("withdraw consent");
    expect(markup).not.toContain("Review your application");
    expect(markup).not.toContain("Review and submit");
    expect(markup).not.toContain("Allow preparation");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("<select");
  });

  it("does not link a credential-bearing employer URL from a legacy external draft", () => {
    const unsafeUrl = "https://user:secret@jobs.example.test/opening/42";
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{}}
        job={{
          ...job,
          applyMode: "external",
          source: { key: "external_source", label: "External source", url: unsafeUrl },
        }}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{ ...workspace, applyMode: "external" }}
      />,
    );

    expect(markup).toContain("This historical draft is read-only");
    expect(markup).not.toContain(`href="${unsafeUrl}"`);
    expect(markup).not.toContain("Continue on the employer");
  });

  it("shows a concise receipt instead of stale permission controls", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{}}
        job={job}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          draft: { ...workspace.draft, state: "submitted" },
          receipt: {
            id: "receipt_550e8400-e29b-41d4-a716-446655440000",
            status: "submitted",
            externalUrl: null,
            createdAt: "2026-08-29T10:03:00.000Z",
          },
        }}
      />,
    );

    expect(markup).toContain("Application submitted");
    expect(markup).toContain("Submitted Aug 29, 2026");
    expect(markup).toContain("Receipt details");
    expect(markup).not.toContain("Not approved");
    expect(markup).not.toContain("Assistant access");
    expect(markup).not.toContain("Final confirmation");
    expect(markup).not.toContain('<main class="');
  });
});
