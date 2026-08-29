import { describe, expect, it, vi } from "vitest";

import { runRecurringService } from "./service-loop.js";

describe("recurring worker service", () => {
  it("runs immediately, waits between cycles, and stops cleanly on abort", async () => {
    const controller = new AbortController();
    const runCycle = vi.fn(async () => {
      if (runCycle.mock.calls.length === 2) controller.abort();
    });
    const wait = vi.fn(async () => undefined);

    await runRecurringService({
      intervalMilliseconds: 60_000,
      signal: controller.signal,
      runCycle,
      wait,
    });

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledWith(60_000, controller.signal);
  });

  it("reports a failed cycle and continues to the next retention opportunity", async () => {
    const controller = new AbortController();
    const failure = new Error("temporary database contention");
    const runCycle = vi
      .fn<() => Promise<void>>()
      .mockRejectedValueOnce(failure)
      .mockImplementationOnce(async () => {
        controller.abort();
      });
    const onCycleError = vi.fn();

    await runRecurringService({
      intervalMilliseconds: 1_000,
      signal: controller.signal,
      runCycle,
      onCycleError,
      wait: async () => undefined,
    });

    expect(runCycle).toHaveBeenCalledTimes(2);
    expect(onCycleError).toHaveBeenCalledWith(failure);
  });
});
