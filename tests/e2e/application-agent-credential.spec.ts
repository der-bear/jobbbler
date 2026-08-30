import { expect, test, type Page } from "@playwright/test";

declare global {
  interface Window {
    __applicationCredentialTools: Map<
      string,
      { execute(input: unknown, options: unknown): Promise<unknown> }
    >;
  }
}

const demoJobId = "job_00000001-0000-7000-8000-000000000001";

async function installModelContext(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const tools = new Map<
      string,
      { execute(input: unknown, options: unknown): Promise<unknown> }
    >();
    window.__applicationCredentialTools = tools;
    Object.defineProperty(document, "modelContext", {
      configurable: true,
      value: {
        registerTool(
          tool: { name: string; execute(input: unknown, options: unknown): Promise<unknown> },
          options?: { signal?: AbortSignal },
        ) {
          tools.set(tool.name, tool);
          options?.signal?.addEventListener("abort", () => tools.delete(tool.name), { once: true });
          return Promise.resolve();
        },
      },
    });
  });
}

async function callTool(page: Page, name: string, input: unknown): Promise<unknown> {
  return page.evaluate(
    async ([toolName, toolInput]) => {
      const tool = window.__applicationCredentialTools.get(toolName as string);
      if (tool === undefined) throw new Error(`Tool not registered: ${String(toolName)}`);
      return tool.execute(toolInput, { signal: new AbortController().signal });
    },
    [name, input] as const,
  );
}

async function waitForApplicationTools(page: Page): Promise<void> {
  await expect
    .poll(() =>
      page.evaluate(() =>
        [
          "request_application_assistance",
          "decide_application_assistance",
          "propose_application_updates",
        ].every((name) => window.__applicationCredentialTools.has(name)),
      ),
    )
    .toBe(true);
}

test("keeps a draft credential through route changes and one same-tab reload", async ({ page }) => {
  await installModelContext(page);
  await page.goto("/jobs");
  await waitForApplicationTools(page);

  const prepared = (await callTool(page, "prepare_application", { jobId: demoJobId })) as {
    status: string;
    data: { draftId: string };
  };
  expect(prepared.status).toBe("completed");
  const draftId = prepared.data.draftId;

  const requested = (await callTool(page, "request_application_assistance", { draftId })) as {
    status: string;
    requestId: string;
  };
  expect(requested.status).toBe("requires_user_action");
  const approved = (await callTool(page, "decide_application_assistance", {
    draftId,
    requestId: requested.requestId,
    decision: "approved",
  })) as { status: string };
  expect(approved.status).toBe("completed");

  await expect
    .poll(() =>
      page.evaluate(() => ({
        local: Object.keys(localStorage).filter((key) =>
          key.startsWith("jobbbler:application-agent-credential:"),
        ).length,
        session: Object.keys(sessionStorage).filter((key) =>
          key.startsWith("jobbbler:application-agent-credential:"),
        ).length,
      })),
    )
    .toEqual({ local: 0, session: 1 });

  await callTool(page, "open_jobbbler_page", { page: "search" });
  await expect(page).toHaveURL(/\/jobs$/u);
  const afterRouteChange = (await callTool(page, "propose_application_updates", {
    draftId,
    patches: [{ fieldKey: "full_name", value: "Ada Lovelace" }],
  })) as { status: string };
  expect(afterRouteChange, JSON.stringify(afterRouteChange)).toMatchObject({ status: "completed" });

  await page.reload();
  await waitForApplicationTools(page);
  const afterReload = (await callTool(page, "propose_application_updates", {
    draftId,
    patches: [{ fieldKey: "email", value: "ada@example.test" }],
  })) as { status: string };
  expect(afterReload, JSON.stringify(afterReload)).toMatchObject({ status: "completed" });

  const withdrawn = (await callTool(page, "decide_application_assistance", {
    draftId,
    requestId: requested.requestId,
    decision: "withdraw",
  })) as { status: string };
  expect(withdrawn.status).toBe("completed");
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          Object.keys(sessionStorage).filter((key) =>
            key.startsWith("jobbbler:application-agent-credential:"),
          ).length,
      ),
    )
    .toBe(0);
});
