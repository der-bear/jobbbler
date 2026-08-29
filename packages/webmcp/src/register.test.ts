import { describe, expect, it } from "vitest";

import { FakeModelContext } from "../../testing/src/model-context-harness.js";

import {
  AgentActivityStore,
  isModelContextAvailable,
  jsonObject,
  jsonString,
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
