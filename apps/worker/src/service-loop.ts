import { setTimeout as waitForTimer } from "node:timers/promises";

export interface RunRecurringServiceInput {
  readonly intervalMilliseconds: number;
  readonly signal: AbortSignal;
  readonly runCycle: () => Promise<void>;
  readonly onCycleError?: (error: unknown) => void;
  readonly wait?: (milliseconds: number, signal: AbortSignal) => Promise<void>;
}

async function defaultWait(milliseconds: number, signal: AbortSignal): Promise<void> {
  await waitForTimer(milliseconds, undefined, { signal });
}

export async function runRecurringService(input: RunRecurringServiceInput): Promise<void> {
  if (!Number.isSafeInteger(input.intervalMilliseconds) || input.intervalMilliseconds < 1) {
    throw new Error("Worker interval must be a positive integer number of milliseconds.");
  }
  const wait = input.wait ?? defaultWait;

  while (!input.signal.aborted) {
    try {
      await input.runCycle();
    } catch (error) {
      if (input.signal.aborted) return;
      try {
        input.onCycleError?.(error);
      } catch {
        // Logging and monitoring callbacks must not disable retention scheduling.
      }
    }
    if (input.signal.aborted) return;

    try {
      await wait(input.intervalMilliseconds, input.signal);
    } catch (error) {
      if (input.signal.aborted) return;
      throw error;
    }
  }
}
