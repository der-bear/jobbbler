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

test.describe("agent journey through the live WebMCP surface", () => {
  test("registers route tools, plans, searches, and navigates like an agent", async ({ page }) => {
    await installModelContext(page);
    await page.goto("/");

    await expect
      .poll(() => registeredToolNames(page))
      .toEqual(["get_search_state", "open_job_details", "plan_job_workflow", "search_jobs"]);

    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(/ready/i);
    await expect(page.getByText("4 tools available on this page")).toBeVisible();

    const plan = (await callTool(page, "plan_job_workflow", { goal: "monitor_search" })) as {
      status: string;
      data: { recommendedSteps: readonly { tool: string | null }[]; boundaries: readonly string[] };
    };
    expect(plan.status).toBe("completed");
    expect(plan.data.recommendedSteps.length).toBeGreaterThan(3);
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

    const activityTab = page.getByRole("tab", { name: /Activity/ });
    await expect(activityTab).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("search_jobs", { exact: true })).toBeVisible();
    await expect(page.getByText("Complete", { exact: true }).first()).toBeVisible();

    const opened = (await callTool(page, "open_job_details", { jobId: firstJobId })) as {
      status: string;
      summary?: string;
      error?: unknown;
    };
    expect(opened, JSON.stringify(opened)).toMatchObject({ status: "completed" });
    await expect(page).toHaveURL(/\/jobs\//);
    await expect
      .poll(() => registeredToolNames(page))
      .toEqual(["compare_jobs", "get_job_details", "plan_job_workflow"]);
  });

  test("keeps the guide as the starter screen when no agent is connected", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("tab", { name: "Guide" })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Try it in 10 seconds")).toBeVisible();
    await expect(page.getByRole("status", { name: "WebMCP status" })).toContainText(
      /unavailable|browser/i,
    );

    await page.getByRole("tab", { name: "Tools" }).click();
    await expect(page.getByText("No agent browser detected", { exact: false })).toBeVisible();
    await expect(page.getByText(/All \d+ site tools/)).toBeVisible();
    await expect(page.getByText("plan_job_workflow").first()).toBeVisible();
  });
});
