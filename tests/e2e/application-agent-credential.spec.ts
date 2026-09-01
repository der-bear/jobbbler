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

test("persists a quickly completed application before a reload", async ({ page }) => {
  await page.goto(`/jobs/${demoJobId}`);
  await page.getByRole("button", { name: "Apply for this role" }).click();

  await page.getByRole("button", { name: /Submit to /u }).click();
  await expect(page.getByText("Still missing", { exact: true })).toBeVisible();
  await expect(page.getByRole("textbox", { name: "Full name" })).toBeFocused();
  await expect(page.getByRole("textbox", { name: "Full name" })).toHaveAttribute(
    "aria-invalid",
    "true",
  );

  await page.getByRole("textbox", { name: "Full name" }).fill("Alex Morgan");
  await page.getByRole("textbox", { name: "Email" }).fill("alex@example.test");
  await page.getByRole("textbox", { name: "Current location" }).fill("Kyiv, Ukraine");
  await page
    .getByRole("combobox", { name: "Work authorization" })
    .selectOption("Authorized to work in the European Union");
  await page
    .getByRole("textbox", { name: "Cover letter" })
    .fill(
      "I am a senior full-stack engineer who builds reliable web products and works closely across product and engineering.",
    );
  await page.getByRole("heading", { name: "Application details" }).click();

  await expect(page.getByText("Changes saved.")).toBeVisible();
  await expect(page.getByText("5 of 5 details ready")).toBeVisible();
  await page.reload();

  await expect(page.getByRole("textbox", { name: "Full name" })).toHaveValue("Alex Morgan");
  await expect(page.getByRole("textbox", { name: "Email" })).toHaveValue("alex@example.test");
  await expect(page.getByRole("textbox", { name: "Current location" })).toHaveValue(
    "Kyiv, Ukraine",
  );
  await expect(page.getByRole("combobox", { name: "Work authorization" })).toHaveValue(
    "Authorized to work in the European Union",
  );
  await expect(page.getByRole("textbox", { name: "Cover letter" })).toHaveValue(
    "I am a senior full-stack engineer who builds reliable web products and works closely across product and engineering.",
  );
});

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

test("lets an agent prepare one exact application and submit only after the final decision", async ({
  page,
}) => {
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
    nextTool: string;
    presentation: {
      title: string;
      facts: readonly { key: string; value: string }[];
    };
  };
  expect(requested).toMatchObject({
    status: "requires_user_action",
    nextTool: "decide_application_assistance",
    presentation: {
      title: "Allow this agent to help with this application?",
      facts: expect.arrayContaining([
        { key: "Scope", value: "This application only" },
        { key: "Cannot do", value: "Submit anything without your final approval" },
      ]),
    },
  });
  await expect(
    page
      .getByRole("region", { name: "Agent activity log" })
      .getByText("request_application_assistance", { exact: true })
      .first(),
  ).toBeVisible();
  await expect(page.getByText("Needs your decision", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("request_agent_access", { exact: true })).toHaveCount(0);

  const assistanceDecision = (await callTool(page, "decide_application_assistance", {
    draftId,
    requestId: requested.requestId,
    decision: "approved",
  })) as { status: string; data: { decision: string } };
  expect(assistanceDecision).toMatchObject({
    status: "completed",
    data: { decision: "approved" },
  });

  const updated = (await callTool(page, "propose_application_updates", {
    draftId,
    patches: [
      { fieldKey: "full_name", value: "Alex Morgan" },
      { fieldKey: "email", value: "alex.morgan@example.test" },
      { fieldKey: "location", value: "Kyiv, Ukraine" },
      {
        fieldKey: "cover_letter",
        value:
          "I build reliable web products, collaborate closely with product teams, and would bring that experience to this role.",
      },
      {
        fieldKey: "work_authorization",
        value: "Authorized to work in the European Union",
      },
    ],
  })) as { status: string };
  expect(updated, JSON.stringify(updated)).toMatchObject({ status: "completed" });

  const readiness = (await callTool(page, "get_application_readiness", { draftId })) as {
    status: string;
    data: {
      requiredFields: number;
      completedRequiredFields: number;
      missingCount: number;
      nextTool: string;
    };
  };
  expect(readiness).toMatchObject({
    status: "completed",
    data: {
      requiredFields: 5,
      completedRequiredFields: 5,
      missingCount: 0,
      nextTool: "request_submission_review",
    },
  });

  const review = (await callTool(page, "request_submission_review", { draftId })) as {
    status: string;
    requestId: string;
    nextTool: string;
    decisionContext: {
      draftVersion: number;
      recipient: string;
      fields: readonly { fieldKey: string; value: string }[];
    };
  };
  expect(review).toMatchObject({
    status: "requires_user_action",
    nextTool: "decide_application_submission",
  });
  expect(review.decisionContext.fields).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ fieldKey: "full_name", value: "Alex Morgan" }),
      expect.objectContaining({ fieldKey: "email", value: "alex.morgan@example.test" }),
      expect.objectContaining({ fieldKey: "location", value: "Kyiv, Ukraine" }),
    ]),
  );
  expect(review.decisionContext.recipient.length).toBeGreaterThan(0);

  const submitted = (await callTool(page, "decide_application_submission", {
    draftId,
    requestId: review.requestId,
    draftVersion: review.decisionContext.draftVersion,
    decision: "approved",
  })) as {
    status: string;
    data: { state: string; receipt: { status: string; href: string } };
  };
  expect(submitted, JSON.stringify(submitted)).toMatchObject({
    status: "completed",
    data: { state: "submitted", receipt: { status: "submitted", href: `/apply/${draftId}` } },
  });

  const applications = (await callTool(page, "get_applications", {
    limit: 10,
    offset: 0,
  })) as {
    status: string;
    data: {
      applications: readonly {
        applicationId: string;
        state: string;
        receiptAvailable: boolean;
      }[];
    };
  };
  expect(applications.status).toBe("completed");
  expect(applications.data.applications).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        applicationId: draftId,
        state: "submitted",
        receiptAvailable: true,
      }),
    ]),
  );

  await callTool(page, "open_jobbbler_page", { page: "applications" });
  await expect(page).toHaveURL(/\/applications$/u);
  await expect(page.getByRole("link", { name: "View receipt" }).first()).toBeVisible();
});
