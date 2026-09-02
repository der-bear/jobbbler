import { describe, expect, it } from "vitest";

import { FakeModelContext } from "../../testing/src/model-context-harness.js";

import {
  AgentActivityStore,
  isModelContextAvailable,
  jsonObject,
  jsonString,
  recordToolRequestCorrelation,
  registerToolSet,
  validateToolManifest,
  type ToolManifest,
} from "./index.js";

const inputSchema = {
  type: "object",
  additionalProperties: false,
  properties: { query: { type: "string", maxLength: 120 } },
} as const;

function manifest(
  overrides: Partial<ToolManifest<{ readonly query: string }, { readonly count: number }>> = {},
) {
  return {
    name: "search_jobs",
    purpose: "Search the current public job catalog.",
    description: "Search source-backed jobs using the current visible filters.",
    inputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    execute: async (_input: { readonly query: string }) => ({ count: 1 }),
    ...overrides,
  } satisfies ToolManifest<{ readonly query: string }, { readonly count: number }>;
}

describe("WebMCP framework core", () => {
  it("publishes a new immutable activity snapshot only when store state changes", () => {
    const activities = new AgentActivityStore();
    const before = activities.snapshot();

    expect(activities.snapshot()).toBe(before);
    const activityId = activities.start("search_jobs", "Running a safe search.");
    const running = activities.snapshot();
    expect(running).not.toBe(before);
    expect(Object.isFrozen(running)).toBe(true);

    activities.finish(activityId, "completed", "Completed a safe search.");
    expect(activities.snapshot()).not.toBe(running);
  });

  it("bounds the ephemeral session activity history", () => {
    const activities = new AgentActivityStore({ maxItems: 2 });
    activities.start("first_tool", "First activity");
    activities.start("second_tool", "Second activity");
    activities.start("third_tool", "Third activity");

    expect(activities.snapshot().map(({ toolName }) => toolName)).toEqual([
      "second_tool",
      "third_tool",
    ]);
  });

  it("clears the local activity history and publishes one empty snapshot", () => {
    const activities = new AgentActivityStore();
    const snapshots: (readonly unknown[])[] = [];
    activities.start("search_jobs", "Finding roles.");
    const unsubscribe = activities.subscribe((snapshot) => {
      snapshots.push(snapshot);
    });

    activities.clear();
    const cleared = activities.snapshot();
    activities.clear();
    unsubscribe();

    expect(cleared).toEqual([]);
    expect(Object.isFrozen(cleared)).toBe(true);
    expect(snapshots).toHaveLength(1);
  });

  it("reconciles durable activity by id or correlation without duplicating local execution", () => {
    const activities = new AgentActivityStore({
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    activities.start("edit_application", "Updating application draft.", {
      correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
    });
    const committed = {
      id: "activity_550e8400-e29b-41d4-a716-446655440000",
      toolName: "edit_application",
      status: "completed" as const,
      safeSummary: "Application draft updated.",
      correlationId: "corr_550e8400-e29b-41d4-a716-446655440000",
      startedAt: "2026-08-29T10:00:01.000Z",
      completedAt: "2026-08-29T10:00:01.000Z",
      affectedResourceIds: [],
    };

    activities.mergeCommitted([committed]);
    expect(activities.snapshot()).toEqual([committed]);
    const snapshot = activities.snapshot();
    activities.mergeCommitted([committed]);
    expect(activities.snapshot()).toBe(snapshot);
  });

  it("keeps an unmatched durable event separate from a sole local call in another tab", () => {
    let now = new Date("2026-08-29T10:00:00.000Z");
    const activities = new AgentActivityStore({ now: () => now });
    const localId = activities.start("prepare_application", "Preparing this application.", {
      affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440001"],
    });
    now = new Date("2026-08-29T10:00:01.000Z");
    activities.finish(localId, "completed", "Application prepared.");

    activities.mergeCommitted([
      {
        id: "activity_550e8400-e29b-41d4-a716-446655440000",
        toolName: "prepare_application",
        status: "completed",
        safeSummary: "Another application was prepared.",
        correlationId: "server_request_550e8400-e29b-41d4-a716-446655440000",
        startedAt: "2026-08-29T10:00:00.200Z",
        completedAt: "2026-08-29T10:00:01.000Z",
        affectedResourceIds: [],
      },
    ]);

    expect(activities.snapshot()).toHaveLength(2);
    expect(activities.snapshot()).toMatchObject([
      {
        id: localId,
        safeSummary: "Application prepared.",
        affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440001"],
      },
      {
        id: "activity_550e8400-e29b-41d4-a716-446655440000",
        safeSummary: "Another application was prepared.",
        affectedResourceIds: [],
      },
    ]);
  });

  it("never attaches a committed result to one of several ambiguous local calls", () => {
    let now = new Date("2026-08-29T10:00:00.000Z");
    const activities = new AgentActivityStore({ now: () => now });
    const firstId = activities.start("prepare_application", "Preparing the first application.", {
      affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440001"],
    });
    now = new Date("2026-08-29T10:00:00.100Z");
    const secondId = activities.start("prepare_application", "Preparing the second application.", {
      affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440002"],
    });
    activities.finish(firstId, "completed", "First application prepared.");
    activities.finish(secondId, "completed", "Second application prepared.");

    activities.mergeCommitted([
      {
        id: "activity_550e8400-e29b-41d4-a716-446655440000",
        toolName: "prepare_application",
        status: "completed",
        safeSummary: "Second application committed.",
        correlationId: "server_request_550e8400-e29b-41d4-a716-446655440000",
        startedAt: "2026-08-29T10:00:00.200Z",
        completedAt: "2026-08-29T10:00:00.300Z",
        affectedResourceIds: ["application_550e8400-e29b-41d4-a716-446655440002"],
      },
    ]);

    expect(activities.snapshot()).toHaveLength(3);
    expect(activities.snapshot().slice(0, 2)).toMatchObject([
      {
        id: firstId,
        safeSummary: "First application prepared.",
        affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440001"],
      },
      {
        id: secondId,
        safeSummary: "Second application prepared.",
        affectedResourceIds: ["job_550e8400-e29b-41d4-a716-446655440002"],
      },
    ]);
  });

  it("preserves known local resources when the matching committed event omits them", () => {
    const activities = new AgentActivityStore({
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const draftId = "draft_550e8400-e29b-41d4-a716-446655440000";
    const correlationId = "corr_650e8400-e29b-41d4-a716-446655440000";
    const localId = activities.start("edit_application", "Updating application draft.", {
      correlationId,
      affectedResourceIds: [draftId],
    });
    activities.finish(localId, "completed", "Application draft updated.");

    activities.mergeCommitted([
      {
        id: "activity_650e8400-e29b-41d4-a716-446655440000",
        toolName: "edit_application",
        status: "completed",
        safeSummary: "Application draft updated.",
        correlationId,
        startedAt: "2026-08-29T10:00:00.000Z",
        completedAt: "2026-08-29T10:00:01.000Z",
        affectedResourceIds: [],
      },
    ]);

    expect(activities.snapshot()).toMatchObject([{ affectedResourceIds: [draftId] }]);
  });

  it("collapses a durable event that arrives before the local tool call finishes", () => {
    const activities = new AgentActivityStore({
      now: () => new Date("2026-08-29T10:00:00.000Z"),
    });
    const requestId = "req_750e8400-e29b-41d4-a716-446655440000";
    const applicationId = "application_750e8400-e29b-41d4-a716-446655440001";
    const localId = activities.start("prepare_application", "Preparing this application.");

    activities.mergeCommitted([
      {
        id: "activity_750e8400-e29b-41d4-a716-446655440000",
        toolName: "prepare_application",
        status: "completed",
        safeSummary: "Application prepared.",
        correlationId: requestId,
        startedAt: "2026-08-29T10:00:00.000Z",
        completedAt: "2026-08-29T10:00:00.000Z",
        affectedResourceIds: [],
      },
    ]);
    activities.finish(localId, "completed", "Application prepared.", [applicationId], requestId);

    expect(activities.snapshot()).toEqual([
      {
        id: "activity_750e8400-e29b-41d4-a716-446655440000",
        toolName: "prepare_application",
        status: "completed",
        safeSummary: "Application prepared.",
        correlationId: requestId,
        startedAt: "2026-08-29T10:00:00.000Z",
        completedAt: "2026-08-29T10:00:00.000Z",
        affectedResourceIds: [applicationId],
      },
    ]);
  });

  it("builds bounded, JSON-serializable object schemas", () => {
    expect(
      jsonObject({
        properties: { query: jsonString({ description: "Role query", maxLength: 120 }) },
        required: ["query"],
      }),
    ).toEqual({
      type: "object",
      additionalProperties: false,
      properties: { query: { type: "string", description: "Role query", maxLength: 120 } },
      required: ["query"],
    });
    expect(() => jsonString({ description: "x".repeat(151) })).toThrow(/description/i);
  });

  it("recognizes only a callable registerTool capability", () => {
    expect(isModelContextAvailable(undefined)).toBe(false);
    expect(isModelContextAvailable({ registerTool: "not-a-function" })).toBe(false);
    expect(isModelContextAvailable(new FakeModelContext())).toBe(true);
  });

  it("rejects duplicate purposes and unsafe manifest metadata before registration", () => {
    expect(() =>
      validateToolManifest([manifest(), manifest({ name: "set_search_filters" })]),
    ).toThrow(/purpose/i);
    expect(() =>
      validateToolManifest([
        manifest({ annotations: { readOnlyHint: false, untrustedContentHint: false } }),
      ]),
    ).not.toThrow();
    expect(() =>
      validateToolManifest([
        manifest({
          annotations: {
            readOnlyHint: "yes" as unknown as boolean,
            untrustedContentHint: true,
          },
        }),
      ]),
    ).toThrow(/boolean/i);
    expect(() => validateToolManifest([manifest({ description: "x".repeat(501) })])).toThrow(
      /description/i,
    );
    expect(() =>
      validateToolManifest([
        manifest({
          inputSchema: {
            type: "object",
            additionalProperties: false,
            properties: {
              query: { type: "string", description: "x".repeat(151) },
            },
          },
        }),
      ]),
    ).toThrow(/schema description/i);
  });

  it("registers an entire route set and aborts every registration on cleanup", async () => {
    const modelContext = new FakeModelContext();
    const cleanup = await registerToolSet(
      [
        manifest(),
        manifest({
          name: "get_search_state",
          purpose: "Read the current visible search state.",
        }),
      ],
      { modelContext },
    );

    expect(modelContext.registrations.map((registration) => registration.tool.name)).toEqual([
      "search_jobs",
      "get_search_state",
    ]);
    cleanup();
    expect(modelContext.abortedToolNames).toEqual(["search_jobs", "get_search_state"]);
  });

  it("aborts an already registered route set when any later registration fails", async () => {
    const modelContext = new FakeModelContext();
    modelContext.failWhenName = "get_search_state";

    await expect(
      registerToolSet(
        [
          manifest(),
          manifest({
            name: "get_search_state",
            purpose: "Read the current visible search state.",
          }),
        ],
        { modelContext },
      ),
    ).rejects.toThrow(/get_search_state/);
    expect(modelContext.abortedToolNames).toEqual(["search_jobs"]);
  });

  it("lets route cleanup abort registration while registerTool is still pending", async () => {
    let registeredSignal: AbortSignal | undefined;
    let releaseRegistration: (() => void) | undefined;
    const modelContext = {
      async registerTool(_tool: unknown, options: { readonly signal: AbortSignal }) {
        registeredSignal = options.signal;
        await new Promise<void>((resolve) => {
          releaseRegistration = resolve;
        });
        if (options.signal.aborted) throw new DOMException("Registration aborted.", "AbortError");
      },
    };
    const lifecycle = new AbortController();
    const registration = registerToolSet([manifest()], {
      modelContext,
      signal: lifecycle.signal,
    });
    await Promise.resolve();

    lifecycle.abort();
    expect(registeredSignal?.aborted).toBe(true);
    releaseRegistration?.();
    await expect(registration).rejects.toThrow(/aborted/i);
  });

  it("forwards the browser execution signal and records a completed activity only after execution", async () => {
    const modelContext = new FakeModelContext();
    const activities = new AgentActivityStore({ now: () => new Date("2026-08-29T00:00:00.000Z") });
    let receivedSignal: AbortSignal | undefined;
    await registerToolSet(
      [
        manifest({
          execute: async (_input, options) => {
            receivedSignal = options.signal;
            return { count: 1 };
          },
        }),
      ],
      { modelContext, activities },
    );

    const controller = new AbortController();
    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      { signal: controller.signal },
    );

    expect(receivedSignal).toBe(controller.signal);
    expect(activities.snapshot()).toMatchObject([
      {
        toolName: "search_jobs",
        status: "completed",
        correlationId: expect.stringMatching(/^req_/),
        affectedResourceIds: [],
        completedAt: "2026-08-29T00:00:00.000Z",
      },
    ]);
  });

  it("reconciles a tool call with the request ID captured from its API response", async () => {
    const modelContext = new FakeModelContext();
    const activities = new AgentActivityStore({ now: () => new Date("2026-08-29T00:00:00.000Z") });
    const requestId = "req_650e8400-e29b-41d4-a716-446655440000";
    await registerToolSet(
      [
        manifest({
          execute: async (_input, { signal }) => {
            recordToolRequestCorrelation(signal, requestId);
            return { count: 1 };
          },
        }),
      ],
      { modelContext, activities },
    );

    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      { signal: new AbortController().signal },
    );

    expect(activities.snapshot()).toMatchObject([{ correlationId: requestId }]);
  });

  it("supplies a live cancellation signal when an early client omits it", async () => {
    const modelContext = new FakeModelContext();
    let receivedSignal: AbortSignal | undefined;
    await registerToolSet(
      [
        manifest({
          execute: async (_input, options) => {
            receivedSignal = options.signal;
            return { count: 1 };
          },
        }),
      ],
      { modelContext },
    );

    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      {} as { readonly signal: AbortSignal },
    );

    expect(receivedSignal).toBeInstanceOf(AbortSignal);
    expect(receivedSignal?.aborted).toBe(false);
  });

  it("uses the tool result summary for a completed activity", async () => {
    const modelContext = new FakeModelContext();
    const activities = new AgentActivityStore();
    await registerToolSet(
      [
        manifest({
          execute: async () => ({
            count: 1,
            status: "completed" as const,
            summary: "Read the role and its source-backed fit evidence.",
          }),
        }),
      ],
      { modelContext, activities },
    );

    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      { signal: new AbortController().signal },
    );

    expect(activities.snapshot()).toMatchObject([
      {
        status: "completed",
        safeSummary: "Read the role and its source-backed fit evidence.",
      },
    ]);
  });

  it("records a bounded set of affected resources from a completed tool result", async () => {
    const modelContext = new FakeModelContext();
    const activities = new AgentActivityStore();
    const resources = Array.from({ length: 22 }, (_, index) => ({
      type: "application",
      id: `draft_550e8400-e29b-41d4-a716-${String(index + 1).padStart(12, "0")}`,
      label: `Application ${String(index + 1)}`,
    }));
    await registerToolSet(
      [
        manifest({
          execute: async () => ({
            count: resources.length,
            status: "completed" as const,
            summary: "Application drafts updated.",
            resources,
          }),
        }),
      ],
      { modelContext, activities },
    );

    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      { signal: new AbortController().signal },
    );

    const affectedResourceIds = activities.snapshot()[0]?.affectedResourceIds;
    expect(affectedResourceIds).toHaveLength(20);
    expect(affectedResourceIds?.[0]).toBe("draft_550e8400-e29b-41d4-a716-000000000001");
    expect(affectedResourceIds?.[19]).toBe("draft_550e8400-e29b-41d4-a716-000000000020");
  });

  it("preserves a safe returned terminal envelope in the activity timeline", async () => {
    const modelContext = new FakeModelContext();
    const activities = new AgentActivityStore({ now: () => new Date("2026-08-29T00:00:00.000Z") });
    await registerToolSet(
      [
        {
          ...manifest(),
          execute: async () => ({
            status: "requires_user_action" as const,
            summary: "Review the application before continuing.",
          }),
        },
      ],
      { modelContext, activities },
    );

    await modelContext.registrations[0]!.tool.execute(
      { query: "platform" },
      { signal: new AbortController().signal },
    );

    expect(activities.snapshot()).toMatchObject([{ status: "requires_user_action" }]);
  });
});
