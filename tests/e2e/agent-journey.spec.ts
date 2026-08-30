import { expect, test, type Page } from "@playwright/test";

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
  "get_application_readiness",
  "get_comparison",
  "get_job_application_capability",
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
  "remove_job_from_comparison",
  "request_application_assistance",
  "request_submission_review",
  "search_jobs",
  "set_job_alert_state",
  "withdraw_application_consent",
] as const;

test.describe("agent journey through the live WebMCP surface", () => {
  test("keeps workflows reachable, plans, searches, and navigates like an agent", async ({
    page,
  }) => {
    await installModelContext(page);
    // Compile the routes the journey will visit so the dev server's on-demand
    // build cannot trigger a full-page reload mid-navigation.
    await page.request.get("/jobs");
    await page.request.get("/jobs/job_00000001-0000-7000-8000-000000000001");
    await page.goto("/about/webmcp");

    await expect.poll(() => registeredToolNames(page)).toEqual([...allSiteTools]);
    await expect(page.getByRole("complementary", { name: "Agent view" })).toBeVisible();
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      "24 tools active. Discovery is automatic.",
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
      limit: 20,
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
      "24 tools active. Discovery is automatic.",
    );

    const activityTab = page.getByRole("tab", { name: /Activity/ });
    await expect(activityTab).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("region", { name: "Agent activity log" }).getByText("search_jobs", {
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByText("Complete", { exact: true }).first()).toBeVisible();

    const opened = (await callTool(page, "open_job_details", { jobId: firstJobId })) as {
      status: string;
      summary?: string;
      error?: unknown;
    };
    expect(opened, JSON.stringify(opened)).toMatchObject({ status: "completed" });
    await expect(page).toHaveURL(/\/jobs\/job_/, { timeout: 20_000 });
    await expect.poll(() => registeredToolNames(page)).toEqual([...allSiteTools]);
  });

  test("keeps the agent view honest when no agent is connected", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("complementary", { name: "Agent view" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Activity" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      /unavailable|browser/i,
    );

    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByRole("tab", { name: "Tools" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Available tools" })).toBeVisible();
    await expect(page.getByText("24 tools")).toBeVisible();
    await expect(page.getByText("plan_job_workflow").first()).toBeVisible();

    await page.getByRole("tab", { name: "Guide" }).click();
    await expect(
      page.getByRole("heading", { name: "Use Jobbbler from your agent chat" }),
    ).toBeVisible();
  });
});
