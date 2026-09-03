import { describe, expect, it, vi } from "vitest";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";

import { createSiteWideToolManifests } from "./site-wide-webmcp-tools";

const firstJobId = "job_00000001-0000-7000-8000-000000000001";
const secondJobId = "job_00000004-0000-7000-8000-000000000004";
const draftId = "application_00000001-0000-7000-8000-000000000001";
const recoveryId = "recovery_00000001-0000-7000-8000-000000000001";
const challengeId = "challenge_00000001-0000-7000-8000-000000000001";
const sessionExpiresAt = "2026-08-31T12:00:00.000Z";

type TestDependencies = Parameters<typeof createSiteWideToolManifests>[0];

function dependencies(overrides: Partial<TestDependencies> = {}): TestDependencies {
  return {
    onNavigate: vi.fn<TestDependencies["onNavigate"]>(),
    startApplication: vi.fn<TestDependencies["startApplication"]>(),
    startOwnerRecovery: vi.fn<TestDependencies["startOwnerRecovery"]>(),
    completeOwnerRecovery: vi.fn<TestDependencies["completeOwnerRecovery"]>(),
    onWorkspaceRecovered: vi.fn<TestDependencies["onWorkspaceRecovered"]>(),
    startEmailVerification: vi.fn<TestDependencies["startEmailVerification"]>(),
    completeEmailVerification: vi.fn<TestDependencies["completeEmailVerification"]>(),
    listApplications: vi.fn<TestDependencies["listApplications"]>(),
    ...overrides,
  };
}

function findTool(manifests: ReturnType<typeof createSiteWideToolManifests>, name: string) {
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (manifest === undefined) throw new Error(`Missing ${name}.`);
  return manifest;
}

describe("site-wide WebMCP tools", () => {
  it("gives every site-wide tool a plain contract with inputs and returns", () => {
    const manifests = createSiteWideToolManifests(dependencies());

    expect(
      manifests.map(({ name, purpose, description }) => ({ name, purpose, description })),
    ).toEqual([
      {
        name: "open_jobbbler_page",
        purpose: "Open a Jobbbler page or exact private item by ID.",
        description:
          "Use a supported page name plus exact job or application IDs when required to open Search, Saved searches, Applications, the WebMCP guide, a comparison, or one application, and return the opened page and URL without changing stored data.",
      },
      {
        name: "prepare_application",
        purpose: "Create or reopen one private application for a chosen role.",
        description:
          "Use one job ID the person selected to create or reopen its private application and return the application ID, URL, and next tool. Default headless keeps the current page; use presentation=follow only when the person asks to open it. This grants no preparation authority, shares no candidate data, and submits nothing.",
      },
      {
        name: "get_applications",
        purpose: "List private applications without returning candidate answers.",
        description:
          "Use optional limit and offset with a current or recovered owner session to return application and job IDs, role details, status, update time, receipt availability, and nextOffset without returning answers, contact data, or credentials.",
      },
      {
        name: "enable_workspace_recovery",
        purpose: "Add an optional email for getting back to saved work on another device.",
        description:
          "Use the current owner session and the person's exact email to start, then its challengeId and the six-digit code the person supplies to finish, returning only the phase and next tools; this is not data consent, not submission approval, and not email-update permission.",
      },
      {
        name: "recover_jobbbler_workspace",
        purpose: "Bring back saved searches and applications with an email and one-time code.",
        description:
          "Use the verified email the person supplies to start, then its exact recoveryId and six-digit code to finish, returning only the phase and next tools without exposing the email, code, owner, or session credential.",
      },
    ]);
  });

  it("keeps only distinct site-wide outcome actions", () => {
    const manifests = createSiteWideToolManifests(dependencies());

    expect(manifests.map(({ name }) => name)).toEqual([
      "open_jobbbler_page",
      "prepare_application",
      "get_applications",
      "enable_workspace_recovery",
      "recover_jobbbler_workspace",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      false,
      false,
      true,
      false,
      false,
    ]);
  });

  it.each([
    [{ page: "search" }, "/jobs"],
    [{ page: "saved" }, "/saved"],
    [{ page: "applications" }, "/applications"],
    [{ page: "webmcp_guide" }, "/about/webmcp"],
    [
      { page: "comparison", jobIds: [firstJobId, secondJobId] },
      `/compare?id=${firstJobId}&id=${secondJobId}`,
    ],
    [{ page: "application", draftId }, `/apply/${draftId}`],
  ])("opens the requested workspace from any page", async (input, expectedHref) => {
    const onNavigate = vi.fn();
    const manifests = createSiteWideToolManifests(dependencies({ onNavigate }));
    const controller = new AbortController();

    const result = await findTool(manifests, "open_jobbbler_page").execute(input, {
      signal: controller.signal,
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(onNavigate).toHaveBeenCalledWith(expectedHref, { signal: controller.signal });
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it.each([
    { page: "comparison" },
    { page: "comparison", jobIds: [firstJobId] },
    { page: "application" },
    { page: "saved", draftId },
    { page: "unknown" },
  ])("rejects incomplete or ambiguous destinations safely", async (input) => {
    const onNavigate = vi.fn();
    const manifests = createSiteWideToolManifests(dependencies({ onNavigate }));

    const result = await findTool(manifests, "open_jobbbler_page").execute(input, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "VALIDATION", retryable: false },
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("prepares one private application from any page and reports whether it was reopened", async () => {
    const startApplication = vi.fn(async () => ({
      draftId,
      href: `/apply/${draftId}`,
      disposition: "reopened" as const,
      nextTool: "get_application_readiness" as const,
    }));
    const manifests = createSiteWideToolManifests(dependencies({ startApplication }));
    const prepareTool = findTool(manifests, "prepare_application");
    expect(prepareTool.purpose).toBe("Create or reopen one private application for a chosen role.");
    expect(prepareTool.description).toContain("one job ID the person selected");
    expect(prepareTool.description).toContain("application ID, URL, and next tool");
    expect(prepareTool.description).toContain("submits nothing");
    expect(prepareTool.description).not.toContain("get_job_application_capability");
    expect(prepareTool.description).not.toContain("managed internal");
    expect(prepareTool.description).not.toContain("external role");
    expect(prepareTool.description).not.toContain("employer site");
    expect(prepareTool.description.length).toBeLessThanOrEqual(500);
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "prepare_application").execute(
      { jobId: firstJobId },
      { signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      summary: "Application reopened and ready for preparation.",
      data: {
        draftId,
        href: `/apply/${draftId}`,
        disposition: "reopened",
        nextTool: "get_application_readiness",
        presentation: "headless",
      },
    });
    expect(startApplication).toHaveBeenCalledWith(firstJobId, {
      signal,
      presentation: "headless",
    });

    await findTool(manifests, "prepare_application").execute(
      { jobId: firstJobId, presentation: "follow" },
      { signal },
    );
    expect(startApplication).toHaveBeenLastCalledWith(firstJobId, {
      signal,
      presentation: "follow",
    });
  });

  it("starts recovery without revealing the email or locally captured code", async () => {
    const startOwnerRecovery = vi.fn(async () => ({
      recoveryId,
      expiresAt: "2026-08-30T20:15:00.000Z",
      delivery: "accepted" as const,
      developmentCode: "418205",
    }));
    const manifests = createSiteWideToolManifests(dependencies({ startOwnerRecovery }));
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "recover_jobbbler_workspace").execute(
      { action: "start", email: " Person@Example.COM " },
      { signal },
    );

    expect(startOwnerRecovery).toHaveBeenCalledWith({ email: "person@example.com" }, { signal });
    expect(result).toMatchObject({
      status: "completed",
      summary: "If that email matches saved work, a six-digit code is on its way.",
      data: {
        phase: "code_required",
        recoveryId,
        expiresAt: "2026-08-30T20:15:00.000Z",
        nextTool: "recover_jobbbler_workspace",
      },
    });
    expect(JSON.stringify(result)).not.toContain("person@example.com");
    expect(JSON.stringify(result)).not.toContain("418205");
    expect(JSON.stringify(result)).not.toContain("developmentCode");
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("completes recovery and points to both kinds of restored private work", async () => {
    const completeOwnerRecovery = vi.fn(async () => ({
      owner: {
        id: "owner_00000001-0000-7000-8000-000000000001",
        kind: "guest" as const,
        verified: true,
      },
      expiresAt: sessionExpiresAt,
    }));
    const onWorkspaceRecovered = vi.fn();
    const manifests = createSiteWideToolManifests(
      dependencies({ completeOwnerRecovery, onWorkspaceRecovered }),
    );
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "recover_jobbbler_workspace").execute(
      { action: "complete", recoveryId, code: "418205" },
      { signal },
    );

    expect(completeOwnerRecovery).toHaveBeenCalledWith({ recoveryId, code: "418205" }, { signal });
    expect(onWorkspaceRecovered).toHaveBeenCalledWith(sessionExpiresAt);
    expect(result).toMatchObject({
      status: "completed",
      summary: "Saved searches and applications are available again.",
      data: {
        phase: "recovered",
        nextTools: ["get_applications", "get_saved_alerts"],
      },
    });
    expect(JSON.stringify(result)).not.toContain("owner_");
    expect(JSON.stringify(result)).not.toContain(sessionExpiresAt);
    expect(JSON.stringify(result)).not.toContain("418205");
  });

  it.each([
    { action: "start", email: "person@example.com", code: "418205" },
    { action: "complete", recoveryId, code: "12345" },
    { action: "complete", recoveryId, code: "418205", email: "person@example.com" },
  ])("rejects ambiguous or malformed recovery input", async (input) => {
    const current = dependencies();
    const manifests = createSiteWideToolManifests(current);

    const result = await findTool(manifests, "recover_jobbbler_workspace").execute(input, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(current.startOwnerRecovery).not.toHaveBeenCalled();
    expect(current.completeOwnerRecovery).not.toHaveBeenCalled();
  });

  it("starts optional recovery setup without returning email or endpoint data", async () => {
    const startEmailVerification = vi.fn(async () => ({
      challengeId,
      endpointId: "endpoint_00000001-0000-7000-8000-000000000001",
      expiresAt: "2026-08-30T20:15:00.000Z",
      maskedDestination: "p•••••@example.com",
      delivery: "captured" as const,
      developmentCode: "418205",
    }));
    const manifests = createSiteWideToolManifests(dependencies({ startEmailVerification }));
    const tool = findTool(manifests, "enable_workspace_recovery");
    const signal = new AbortController().signal;

    expect(tool.description).toContain("person's exact email");
    expect(tool.description).toContain("not data consent");
    expect(tool.description).toContain("not email-update permission");
    const result = await tool.execute(
      { action: "start", email: " Person@Example.COM " },
      { signal },
    );

    expect(startEmailVerification).toHaveBeenCalledWith(
      { email: "person@example.com" },
      { signal },
    );
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email verification started.",
      data: {
        phase: "code_required",
        challengeId,
        expiresAt: "2026-08-30T20:15:00.000Z",
        nextTool: "enable_workspace_recovery",
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("person@example.com");
    expect(serialized).not.toContain("endpoint_");
    expect(serialized).not.toContain("p•••••@example.com");
    expect(serialized).not.toContain("418205");
    expect(serialized).not.toContain("developmentCode");
  });

  it("completes optional recovery setup without returning owner or verification data", async () => {
    const completeEmailVerification = vi.fn(async () => ({
      owner: {
        id: "owner_00000001-0000-7000-8000-000000000001",
        kind: "guest" as const,
        verified: true,
      },
      endpointId: "endpoint_00000001-0000-7000-8000-000000000001",
      verifiedAt: "2026-08-30T20:10:00.000Z",
    }));
    const manifests = createSiteWideToolManifests(dependencies({ completeEmailVerification }));
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "enable_workspace_recovery").execute(
      { action: "complete", challengeId, code: "418205" },
      { signal },
    );

    expect(completeEmailVerification).toHaveBeenCalledWith(
      { challengeId, code: "418205" },
      { signal },
    );
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email added for getting back to saved work.",
      data: {
        phase: "enabled",
        nextTools: ["get_applications", "get_saved_alerts"],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("owner_");
    expect(serialized).not.toContain("endpoint_");
    expect(serialized).not.toContain("2026-08-30T20:10:00.000Z");
    expect(serialized).not.toContain("418205");
  });

  it.each([
    { action: "start", email: "person@example.com", code: "418205" },
    { action: "complete", challengeId, code: "12345" },
    { action: "complete", challengeId, code: "418205", email: "person@example.com" },
  ])("rejects ambiguous or malformed recovery-setup input", async (input) => {
    const current = dependencies();
    const result = await findTool(
      createSiteWideToolManifests(current),
      "enable_workspace_recovery",
    ).execute(input, { signal: new AbortController().signal });

    expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(current.startEmailVerification).not.toHaveBeenCalled();
    expect(current.completeEmailVerification).not.toHaveBeenCalled();
  });

  it("returns a bounded paged application index without private application data", async () => {
    const title = "T".repeat(200);
    const organizationName = "O".repeat(160);
    const listApplications = vi.fn(async () => [
      {
        draftId: "application_00000003-0000-7000-8000-000000000003",
        state: "draft" as const,
        updatedAt: "2026-08-28T10:00:00.000Z",
        job: {
          id: "job_00000003-0000-7000-8000-000000000003",
          title,
          organizationName,
          status: "closed" as const,
        },
      },
      {
        draftId: "application_00000002-0000-7000-8000-000000000002",
        state: "submitted" as const,
        updatedAt: "2026-08-30T10:00:00.000Z",
        job: {
          id: "job_00000002-0000-7000-8000-000000000002",
          title,
          organizationName,
          status: "open" as const,
        },
      },
      {
        draftId,
        state: "draft" as const,
        updatedAt: "2026-08-29T10:00:00.000Z",
        job: { id: firstJobId, title, organizationName, status: "open" as const },
      },
    ]);
    const manifests = createSiteWideToolManifests(dependencies({ listApplications }));
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "get_applications").execute(
      { limit: 2, offset: 0 },
      { signal },
    );

    expect(listApplications).toHaveBeenCalledWith({ signal });
    expect(result).toMatchObject({
      status: "completed",
      data: {
        total: 3,
        returned: 2,
        nextOffset: 2,
        applications: [
          {
            applicationId: "application_00000002-0000-7000-8000-000000000002",
            jobId: "job_00000002-0000-7000-8000-000000000002",
            title,
            organization: organizationName,
            jobStatus: "open",
            state: "submitted",
            updatedAt: "2026-08-30T10:00:00.000Z",
            receiptAvailable: true,
          },
          {
            applicationId: draftId,
            jobId: firstJobId,
            title,
            organization: organizationName,
            jobStatus: "open",
            state: "draft",
            updatedAt: "2026-08-29T10:00:00.000Z",
            receiptAvailable: false,
          },
        ],
      },
    });
    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain("answers");
    expect(serialized).not.toContain("candidate");
    expect(serialized).not.toContain("email");
    expect(serialized).not.toContain("credential");
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("reports receipt availability for managed submissions and legacy handoffs", async () => {
    const listApplications = vi.fn(async () => [
      {
        draftId: "application_00000003-0000-7000-8000-000000000003",
        state: "failed" as const,
        updatedAt: "2026-08-28T10:00:00.000Z",
        job: {
          id: "job_00000003-0000-7000-8000-000000000003",
          title: "Failed application",
          organizationName: "Example Three",
          status: "closed" as const,
        },
      },
      {
        draftId: "application_00000002-0000-7000-8000-000000000002",
        state: "handed_off" as const,
        updatedAt: "2026-08-30T10:00:00.000Z",
        job: {
          id: "job_00000002-0000-7000-8000-000000000002",
          title: "Legacy handoff",
          organizationName: "Example Two",
          status: "closed" as const,
        },
      },
      {
        draftId,
        state: "submitted" as const,
        updatedAt: "2026-08-29T10:00:00.000Z",
        job: {
          id: firstJobId,
          title: "Managed submission",
          organizationName: "Example One",
          status: "open" as const,
        },
      },
    ]);

    const result = await findTool(
      createSiteWideToolManifests(dependencies({ listApplications })),
      "get_applications",
    ).execute({ limit: 3, offset: 0 }, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: "completed",
      data: {
        nextOffset: null,
        applications: [
          { state: "handed_off", receiptAvailable: true },
          { state: "submitted", receiptAvailable: true },
          { state: "failed", receiptAvailable: false },
        ],
      },
    });
  });

  it("uses the documented ten-item default instead of silently shrinking the page", async () => {
    const listApplications = vi.fn(async () =>
      Array.from({ length: 11 }, (_, index) => {
        const suffix = String(index + 1).padStart(12, "0");
        return {
          draftId: `application_00000001-0000-7000-8000-${suffix}`,
          state: "draft" as const,
          updatedAt: `2026-08-${String(index + 1).padStart(2, "0")}T10:00:00.000Z`,
          job: {
            id: `job_00000001-0000-7000-8000-${suffix}`,
            title: `Role ${String(index + 1)}`,
            organizationName: "Example",
            status: "open" as const,
          },
        };
      }),
    );

    const result = await findTool(
      createSiteWideToolManifests(dependencies({ listApplications })),
      "get_applications",
    ).execute({}, { signal: new AbortController().signal });

    expect(result).toMatchObject({
      status: "completed",
      data: { total: 11, returned: 10, nextOffset: 10 },
    });
  });

  it("rejects unknown application-list arguments without reading private work", async () => {
    const current = dependencies();
    const result = await findTool(createSiteWideToolManifests(current), "get_applications").execute(
      { includeAnswers: true },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(current.listApplications).not.toHaveBeenCalled();
  });
});
