import { expect, test, type Page } from "@playwright/test";

import { collectPageErrors } from "./page-errors";

/**
 * Drives the real WebMCP surface end to end with a recording ModelContext
 * polyfill: the page registers its tools exactly as it would for an agent
 * browser, and the test invokes them the way an agent would — asserting that
 * the visible UI and the Agent panel reflect every call, before and after.
 */

declare global {
  interface Window {
    __agentTools: Map<string, { execute(input: unknown, options: unknown): Promise<unknown> }>;
  }
}

const pageErrors = new WeakMap<Page, () => readonly string[]>();

test.beforeEach(async ({ page }) => {
  pageErrors.set(
    page,
    collectPageErrors(page, {
      expectedHttpErrors: [
        { method: "GET", pathname: "/api/v1/owners/activity", status: 401 },
        // The alert client creates an owner session and retries this exact
        // idempotent request after the initial signed-out response.
        { method: "POST", pathname: "/api/v1/agent/search-alerts/request", status: 401 },
      ],
    }),
  );
});

test.afterEach(async ({ page }) => {
  expect(pageErrors.get(page)?.() ?? [], "Browser errors").toEqual([]);
});

async function installModelContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute(input: unknown, options: unknown): Promise<unknown> }
    >();
    window.__agentTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(
          tool: { name: string; execute(input: unknown, options: unknown): Promise<unknown> },
          options?: { signal?: AbortSignal },
        ) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => tools.delete(tool.name), {
            once: true,
          });
          return Promise.resolve();
        },
      },
    });
  });
}

async function registeredToolNames(page: Page): Promise<string[]> {
  return page.evaluate(() => [...window.__agentTools.keys()].sort());
}

async function callTool(page: Page, name: string, input: unknown): Promise<unknown> {
  return page.evaluate(
    async ([toolName, toolInput]) => {
      const tool = window.__agentTools.get(toolName as string);
      if (tool === undefined) throw new Error(`Tool not registered: ${String(toolName)}`);
      const controller = new AbortController();
      return tool.execute(toolInput, { signal: controller.signal });
    },
    [name, input] as const,
  );
}

const allSiteTools = [
  "add_job_to_comparison",
  "compare_jobs",
  "decide_application_assistance",
  "decide_application_submission",
  "decide_search_alert",
  "enable_workspace_recovery",
  "get_application_readiness",
  "get_applications",
  "get_comparison",
  "get_job_details",
  "get_latest_search_update",
  "get_saved_alerts",
  "get_search_filters",
  "get_search_state",
  "open_job_details",
  "open_jobbbler_page",
  "open_saved_search",
  "plan_job_workflow",
  "prepare_application",
  "propose_application_updates",
  "recover_jobbbler_workspace",
  "remove_job_from_comparison",
  "request_application_assistance",
  "request_search_alert",
  "request_submission_review",
  "save_job_search",
  "search_jobs",
  "set_job_alert_state",
  "withdraw_application_consent",
] as const;

test.describe("agent journey through the live WebMCP surface", () => {
  test("keeps workflows reachable, plans, searches, and navigates like an agent", async ({
    page,
  }) => {
    await installModelContext(page);
    // Compile every page and route handler used by this journey before a page
    // connects to Next's development HMR channel. A 4xx response is sufficient
    // for POST-only handlers: importing the route module is what prevents an
    // on-demand build from reloading the live page during a tool call.
    for (const route of [
      "/jobs",
      "/jobs/job_00000001-0000-7000-8000-000000000001",
      "/api/v1/jobs/search",
      "/api/v1/owners/activity",
      "/api/v1/owners/session",
      "/api/v1/agent/search-alerts/request",
      "/api/v1/agent/search-alerts/decision",
    ]) {
      const response = await page.request.get(route);
      expect(response.status(), `Failed to prewarm ${route}`).toBeLessThan(500);
    }
    await page.goto("/about/webmcp");

    await expect.poll(() => registeredToolNames(page)).toEqual([...allSiteTools]);
    await expect(page.getByRole("button", { name: /Agent activity/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByRole("button", { name: /Agent activity/ }).click();
    await expect(
      page.getByRole("complementary", { name: "What your agent is doing" }),
    ).toBeVisible();
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      `${String(allSiteTools.length)} tools active. Discovery is automatic.`,
    );

    const plan = (await callTool(page, "plan_job_workflow", { goal: "monitor_search" })) as {
      status: string;
      data: { steps: readonly { tool: string | null }[]; boundaries: readonly string[] };
    };
    expect(plan.status).toBe("completed");
    expect(plan.data.steps.length).toBeGreaterThan(3);
    expect(plan.data.boundaries.join(" ")).toContain("grants no authority");

    const search = (await callTool(page, "search_jobs", {
      query: "senior full-stack engineer",
      workModels: ["remote"],
    })) as { status: string; data: { jobs: readonly { id: string }[] } };
    expect(search.status).toBe("completed");
    const firstJobId = search.data.jobs[0]?.id;
    expect(firstJobId).toBeDefined();

    await expect
      .poll(() => new URL(page.url()).searchParams.get("q"))
      .toBe("senior full-stack engineer");
    await expect(page.getByRole("status", { name: "Search status" })).toContainText(/matches/i);
    await expect.poll(() => registeredToolNames(page)).toEqual([...allSiteTools]);
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(/ready/i);
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      `${String(allSiteTools.length)} tools active. Discovery is automatic.`,
    );

    const activityTab = page.getByRole("tab", { name: /Activity/ });
    await expect(activityTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: "Agent activity log" }).getByText("search_jobs", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Complete", { exact: true }).first()).toBeVisible();

    const alertReview = (await callTool(page, "request_search_alert", {
      name: "Agent E2E platform roles",
      criteria: {
        query: "senior full-stack engineer",
        workModels: ["remote"],
        sort: "relevance",
        limit: 20,
      },
      recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
      email: "agent-e2e@example.test",
    })) as {
      status: string;
      requestId: string;
      nextTool: string;
      decisionContext: { reviewToken: string };
      presentation: { facts: readonly { key: string; value: string }[] };
    };
    expect(alertReview, JSON.stringify(alertReview)).toMatchObject({
      status: "requires_user_action",
      nextTool: "decide_search_alert",
      decisionContext: { reviewToken: expect.stringMatching(/^r1\./u) },
      presentation: {
        facts: expect.arrayContaining([
          { key: "Search", value: expect.stringContaining("senior full-stack engineer") },
          { key: "Delivery", value: expect.stringMatching(/^a[•]+@example\.test$/u) },
          { key: "Schedule", value: "Daily at 09:00 (Europe/Kyiv)" },
          {
            key: "Purpose",
            value: "Store this search and email matching-job updates.",
          },
          {
            key: "Retention",
            value: "Stored until the alert or delivery destination is removed.",
          },
          { key: "Withdrawal", value: expect.stringContaining("Pause or delete the alert") },
        ]),
      },
    });
    expect(JSON.stringify(alertReview)).not.toContain("agent-e2e@example.test");

    const declinedAlert = (await callTool(page, "decide_search_alert", {
      requestId: alertReview.requestId,
      reviewToken: alertReview.decisionContext.reviewToken,
      decision: "declined",
    })) as { status: string; data: { decision: string; scheduleId: string | null } };
    expect(declinedAlert).toMatchObject({
      status: "completed",
      data: { decision: "declined", scheduleId: null },
    });

    const opened = (await callTool(page, "open_job_details", { jobId: firstJobId })) as {
      status: string;
      summary?: string;
      error?: unknown;
    };
    expect(opened, JSON.stringify(opened)).toMatchObject({ status: "completed" });
    await expect(page).toHaveURL(/\/jobs\/job_/, { timeout: 20_000 });
    await expect.poll(() => registeredToolNames(page)).toEqual([...allSiteTools]);
  });

  test("keeps the agent activity panel honest when no agent is connected", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("button", { name: /Agent activity/ })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
    await page.getByRole("button", { name: /Agent activity/ }).click();
    await expect(
      page.getByRole("complementary", { name: "What your agent is doing" }),
    ).toBeVisible();
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      /unavailable|browser/i,
    );

    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("tab", { name: "Tools" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Capability catalog" })).toBeVisible();
    await expect(
      page.getByText(`${String(allSiteTools.length)} tools`, { exact: true }),
    ).toBeVisible();
    await expect(page.getByText("plan_job_workflow").first()).toBeVisible();

    await page.getByRole("tab", { name: "Guide" }).click();
    await expect(page.getByRole("heading", { name: "Start in your agent chat" })).toBeVisible();
  });
});
