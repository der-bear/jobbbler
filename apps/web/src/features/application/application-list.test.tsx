import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { ApplicationHistory, ApplicationsWorkspace } from "./application-list";

const submitted = {
  draftId: "application_550e8400-e29b-41d4-a716-446655440000",
  state: "submitted" as const,
  updatedAt: "2026-08-29T10:00:00.000Z",
  job: {
    id: "job_550e8400-e29b-41d4-a716-446655440000",
    title: "Senior Product Engineer",
    organizationName: "Northstar Labs",
    status: "open" as const,
  },
};

describe("ApplicationHistory", () => {
  it("renders server-loaded applications without the client loading state", () => {
    const markup = renderToStaticMarkup(<ApplicationsWorkspace initialItems={[submitted]} />);

    expect(markup).toContain("Senior Product Engineer");
    expect(markup).not.toContain("Loading your applications");
  });

  it("presents applications as a simple, human-readable history", () => {
    const markup = renderToStaticMarkup(
      <ApplicationHistory
        items={[
          submitted,
          {
            ...submitted,
            draftId: "application_7f568400-e29b-41d4-a716-446655440000",
            state: "draft",
            job: { ...submitted.job, title: "Platform Engineer" },
          },
          {
            ...submitted,
            draftId: "application_8f568400-e29b-41d4-a716-446655440000",
            state: "valid",
            job: { ...submitted.job, title: "Design Engineer" },
          },
          {
            ...submitted,
            draftId: "application_9f568400-e29b-41d4-a716-446655440000",
            state: "reviewed",
            job: { ...submitted.job, title: "Staff Engineer" },
          },
          {
            ...submitted,
            draftId: "application_af568400-e29b-41d4-a716-446655440000",
            state: "handed_off",
            job: { ...submitted.job, title: "Security Engineer" },
          },
          {
            ...submitted,
            draftId: "application_bf568400-e29b-41d4-a716-446655440000",
            state: "reviewed",
            job: { ...submitted.job, title: "Closed Engineer", status: "closed" },
          },
        ]}
      />,
    );

    expect(markup).toContain("My applications");
    expect(markup).toContain(
      "Applications you started or allowed your agent to prepare. Continue one or open its receipt.",
    );
    expect(markup).toContain("Senior Product Engineer");
    expect(markup).toContain("Northstar Labs");
    expect(markup).toContain("Submitted");
    expect(markup).toContain("Continue application");
    expect(markup).toContain("Ready to review");
    expect(markup).toContain("Your decision needed");
    expect(markup).toContain("Review application");
    expect(markup).toContain("View receipt");
    expect(markup).toContain("Not submitted by Jobbbler");
    expect(markup).toContain("View next step");
    expect(markup).toContain("Role closed");
    expect(markup).toContain("View application");
    expect(markup).toContain(`/apply/${submitted.draftId}`);
    expect(markup).not.toContain("External handoff");
  });

  it("gives an empty owner one obvious next step", () => {
    const markup = renderToStaticMarkup(<ApplicationHistory items={[]} />);

    expect(markup).toContain("No applications yet");
    expect(markup).toContain(
      "You have not started an application yet. Browse roles to apply yourself, or ask your agent to prepare one after you approve.",
    );
    expect(markup).toContain("Browse open roles");
    expect(markup).toContain('href="/jobs"');
  });

  it("offers the existing optional recovery flow when there is no private session", () => {
    const markup = renderToStaticMarkup(<ApplicationsWorkspace initialItems={null} />);

    expect(markup).toContain("No applications yet");
    expect(markup).toContain("Been here before?");
    expect(markup).toContain("Restore with email");
    expect(markup).toContain('type="email"');
    expect(markup).not.toContain("Loading your applications");
  });

  it("keeps recovery out of a signed-in empty application history", () => {
    const markup = renderToStaticMarkup(<ApplicationsWorkspace initialItems={[]} />);

    expect(markup).toContain("No applications yet");
    expect(markup).not.toContain("Restore with email");
  });
});
