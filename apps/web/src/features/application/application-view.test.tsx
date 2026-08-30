import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";

import { ApplicationView } from "./application-view";

const workspace: ApplicationWorkspace = {
  serverNow: "2026-08-29T10:00:00.000Z",
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
        value: "A candidate-authored motivation note.",
        provenance: "user_entered",
        sensitive: false,
        acceptedByHuman: true,
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
        fieldValues={{
          full_name: "Ada Lovelace",
          motivation: "A candidate-authored motivation note.",
        }}
        job={job}
        now={workspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={workspace}
      />,
    );

    expect(markup).toContain("Application for Senior Product Engineer");
    expect(markup).toContain("Application details");
    expect(markup).toContain("2 of 2 details ready");
    expect(markup).not.toContain("Agent suggestion");
    expect(markup).toContain("Northstar Systems");
    expect(markup).toContain("Submit to Northstar Systems");
    expect(markup).not.toContain("Application draft");
    expect(markup).not.toContain("the draft");
    expect(markup).not.toContain('readOnly=""');
    expect(markup).not.toContain("Step 1 of 4");
    expect(markup).not.toContain("Permission</strong>");
    expect(markup).not.toContain("Assistant access");
    expect(markup).not.toContain("Final confirmation");
    expect(markup).not.toContain("Needs your acceptance");
    expect(markup).not.toContain("Continue to review");
    expect(markup).not.toContain(workspace.draft.ownerId);
    expect(markup).not.toContain("payloadHash");
  });

  it.each([
    {
      state: "requested assistance",
      assistedWorkspace: {
        ...workspace,
        delegationRequests: [
          {
            id: "delegation_550e8400-e29b-41d4-a716-446655440000",
            agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
            operations: ["read_application", "edit_application"],
            purpose: "Prepare this application.",
            status: "requested" as const,
            expiresAt: "2026-08-29T10:20:00.000Z",
            approvedAt: null,
          },
        ],
      } satisfies ApplicationWorkspace,
    },
    {
      state: "active assistance",
      assistedWorkspace: {
        ...workspace,
        delegationRequests: [
          {
            id: "delegation_550e8400-e29b-41d4-a716-446655440000",
            agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
            operations: ["read_application", "edit_application"],
            purpose: "Prepare this application.",
            status: "active" as const,
            expiresAt: "2026-08-29T10:20:00.000Z",
            approvedAt: "2026-08-29T10:05:00.000Z",
          },
        ],
      } satisfies ApplicationWorkspace,
    },
    {
      state: "an agent-suggested answer",
      assistedWorkspace: {
        ...workspace,
        draft: {
          ...workspace.draft,
          answers: workspace.draft.answers.map((answer) =>
            answer.fieldKey === "motivation"
              ? { ...answer, provenance: "agent_suggestion" as const, acceptedByHuman: false }
              : answer,
          ),
        },
      } satisfies ApplicationWorkspace,
    },
  ])("keeps $state decisions in the external agent client", ({ assistedWorkspace }) => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Candidate facts" }}
        job={job}
        now={assistedWorkspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={assistedWorkspace}
      />,
    );

    expect(markup).toContain("Continue in your agent chat");
    expect(markup).toContain("stays read-only");
    expect(markup.match(/readOnly=""/gu)).toHaveLength(2);
    expect(markup).not.toContain("Edit anything that does not sound like you");
    expect(markup).not.toContain("fill it in here");
    expect(markup).not.toContain("Allow preparation");
    expect(markup).not.toContain("Submit to Northstar Systems");
  });

  it.each(["requested", "active"] as const)(
    "keeps a draft editable after %s assistance expires",
    (status) => {
      const markup = renderToStaticMarkup(
        <ApplicationView
          busy={false}
          confirmation={null}
          error={null}
          fieldValues={{ full_name: "Ada Lovelace", motivation: "Candidate facts" }}
          job={job}
          now={workspace.serverNow}
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
                status,
                expiresAt: "2026-08-29T09:59:59.999Z",
                approvedAt: status === "active" ? "2026-08-29T09:55:00.000Z" : null,
              },
            ],
          }}
        />,
      );

      expect(markup).toContain("Submit to Northstar Systems");
      expect(markup).toContain("Agent access ended");
      expect(markup).toContain("ask the agent to request access again");
      expect(markup).not.toContain("read-only for this agent-assisted draft");
      expect(markup).not.toContain("Your agent requested preparation access");
      expect(markup).not.toContain('readOnly=""');
    },
  );

  it("reclassifies an expiring request when the mounted server clock advances", () => {
    const expiring: ApplicationWorkspace = {
      ...workspace,
      delegationRequests: [
        {
          id: "delegation_550e8400-e29b-41d4-a716-446655440000",
          agentSessionId: "agent_session_550e8400-e29b-41d4-a716-446655440000",
          operations: ["read_application", "edit_application"],
          purpose: "Prepare this application.",
          status: "requested",
          expiresAt: "2026-08-29T10:00:01.000Z",
          approvedAt: null,
        },
      ],
    };
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Candidate facts" }}
        job={job}
        now="2026-08-29T10:00:01.000Z"
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={expiring}
      />,
    );

    expect(markup).toContain("Submit to Northstar Systems");
    expect(markup).not.toContain("Your agent requested preparation access");
    expect(markup).not.toContain("read-only for this agent-assisted draft");
  });

  it("shows missing questions without making the user inspect every complete field", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "" }}
        job={job}
        now={workspace.serverNow}
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

  it("enables submission as soon as the visible required fields are complete", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "A current answer" }}
        job={job}
        now={workspace.serverNow}
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

    expect(markup).toContain("2 of 2 details ready");
    expect(markup).toContain("Submit to Northstar Systems");
    expect(markup).not.toContain("disabled");
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
        now={workspace.serverNow}
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
    expect(markup).toContain("Continue on the employer&#x27;s website");
    expect(markup).toContain("Employer link details");
    expect(markup).toContain(`href="${externalUrl}"`);
    expect(markup).toContain("Back to applications");
    expect(markup).toContain('href="/applications"');
    expect(markup).not.toContain("Application receipt");
    expect(markup).not.toContain("Application submitted");
    expect(markup).not.toContain("Receipt details");
    expect(markup).not.toContain("External handoff");
  });

  it("renders a legacy external draft as read-only without preparation or submission controls", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Legacy answer" }}
        job={{ ...job, applyMode: "external" }}
        now={workspace.serverNow}
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

    expect(markup).toContain("Older external application");
    expect(markup).toContain("read-only");
    expect(markup).toContain("withdraw consent");
    expect(markup).not.toContain("Review your application");
    expect(markup).not.toContain("Review and submit");
    expect(markup).not.toContain("Allow preparation");
    expect(markup).not.toContain("<input");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("<select");
  });

  it("renders a closed internal application as read-only with no decision-needed controls", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{ full_name: "Ada Lovelace", motivation: "Prepared answer" }}
        job={{ ...job, status: "closed" }}
        now={workspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          draft: { ...workspace.draft, state: "reviewed" },
          dataGrant: {
            id: "grant_550e8400-e29b-41d4-a716-446655440000",
            status: "active",
            expiresAt: "2026-08-29T10:34:00.000Z",
          },
        }}
      />,
    );

    expect(markup).toContain("Role closed — nothing submitted.");
    expect(markup).toContain("read-only");
    expect(markup).toContain("withdraw consent");
    expect(markup).toContain("Back to applications");
    expect(markup).not.toContain("Your decision is needed");
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
        now={workspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{ ...workspace, applyMode: "external" }}
      />,
    );

    expect(markup).toContain("This historical record is read-only");
    expect(markup).not.toContain(`href="${unsafeUrl}"`);
    expect(markup).not.toContain("Continue on the employer");
  });

  it("shows defensible receipt evidence and the immutable application that Jobbbler submitted", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{}}
        job={{
          ...job,
          title: "Mutable role title",
          organizationName: "Mutable organization name",
          status: "closed",
        }}
        now={workspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          recipient: {
            id: "org_650e8400-e29b-41d4-a716-446655440000",
            name: "Mutable organization name",
          },
          requirements: workspace.requirements.map((field) => ({
            ...field,
            label: `Changed ${field.label}`,
          })),
          draft: {
            ...workspace.draft,
            state: "submitted",
            answers: workspace.draft.answers.map((answer) => ({
              ...answer,
              value: `Changed ${String(answer.value)}`,
            })),
          },
          receipt: {
            id: "receipt_550e8400-e29b-41d4-a716-446655440000",
            status: "submitted",
            externalUrl: null,
            createdAt: "2026-08-29T10:03:00.000Z",
            submission: {
              provider: "jobbbler_demo",
              providerReferenceId: "demo_submission_550e8400-e29b-41d4-a716-446655440000",
              recipient: {
                id: "org_550e8400-e29b-41d4-a716-446655440000",
                name: "Northstar Systems",
              },
              submittedAt: "2026-08-29T10:02:30.000Z",
              fields: [
                { fieldKey: "full_name", label: "Full name", value: "Ada Lovelace" },
                {
                  fieldKey: "motivation",
                  label: "Why this role",
                  value: "A candidate-authored motivation note.",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(markup).toContain("Jobbbler demo submission complete");
    expect(markup).toContain("Jobbbler demo submission");
    expect(markup).not.toContain("The employer received");
    expect(markup).toContain("<dt>Sent to</dt><dd>Northstar Systems</dd>");
    expect(markup).toContain("<dt>Submitted at</dt>");
    expect(markup).toContain('dateTime="2026-08-29T10:02:30.000Z"');
    expect(markup).toContain("UTC</time>");
    expect(markup).toContain("<dt>Receipt reference</dt>");
    expect(markup).toContain("demo_submission_550e8400-e29b-41d4-a716-446655440000");
    expect(markup).toContain("Application sent");
    expect(markup).toContain(
      "Read-only copy of the exact fields stored with this Jobbbler demo submission.",
    );
    expect(markup).toContain("<dt>Full name</dt><dd>Ada Lovelace</dd>");
    expect(markup).toContain(
      "<dt>Why this role</dt><dd>A candidate-authored motivation note.</dd>",
    );
    expect(markup).not.toContain("Mutable organization name");
    expect(markup).not.toContain("Mutable role title");
    expect(markup).not.toContain("Changed Full name");
    expect(markup).not.toContain("Changed Ada Lovelace");
    expect(markup).not.toContain("Not approved");
    expect(markup).not.toContain("Assistant access");
    expect(markup).not.toContain("Final confirmation");
    expect(markup).not.toContain("Role closed — nothing submitted.");
    expect(markup).not.toContain('<main class="');
  });

  it("does not claim submission success when the receipt is missing", () => {
    const markup = renderToStaticMarkup(
      <ApplicationView
        busy={false}
        confirmation={null}
        error={null}
        fieldValues={{}}
        job={job}
        now={workspace.serverNow}
        onAction={() => undefined}
        onFieldChange={() => undefined}
        workspace={{
          ...workspace,
          draft: { ...workspace.draft, state: "submitted" },
          receipt: null,
        }}
      />,
    );

    expect(markup).toContain("Application status");
    expect(markup).toContain("Submission status unavailable");
    expect(markup).toContain("The receipt could not be loaded");
    expect(markup).toContain("Refresh status");
    expect(markup).toContain(`href="/apply/${workspace.draft.id}"`);
    expect(markup).not.toContain("Application receipt");
    expect(markup).not.toContain("Application submitted");
    expect(markup).not.toContain("The employer received");
  });
});
