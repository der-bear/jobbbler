import type { AgentActivityStore } from "./activity.js";
import { isModelContextAvailable } from "./feature-detection.js";
import { validateToolManifest } from "./manifest.js";
import type { ModelContext, RegisteredTool, ToolManifest } from "./types.js";

function isAbortError(error: unknown, signal: AbortSignal): boolean {
  return signal.aborted || (error instanceof DOMException && error.name === "AbortError");
}

function terminalActivity(output: unknown):
  | {
      readonly status: "cancelled" | "completed" | "failed" | "requires_user_action";
      readonly summary: string;
    }
  | undefined {
  if (typeof output !== "object" || output === null || !("status" in output)) return undefined;
  const status = output.status;
  if (
    status !== "cancelled" &&
    status !== "completed" &&
    status !== "failed" &&
    status !== "requires_user_action"
  ) {
    return undefined;
  }
  const summary =
    "summary" in output && typeof output.summary === "string" ? output.summary : status;
  return { status, summary: summary.trim().slice(0, 240) || status };
}

function toolTitle(name: string): string {
  const words = name.split("_").join(" ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function registeredTool<I, O>(
  manifest: ToolManifest<I, O>,
  activities: AgentActivityStore | undefined,
): RegisteredTool {
  return {
    name: manifest.name,
    title: toolTitle(manifest.name),
    description: manifest.description,
    inputSchema: manifest.inputSchema,
    annotations: manifest.annotations,
    async execute(input, options) {
      const signal = options?.signal ?? new AbortController().signal;
      const activityId = activities?.start(manifest.name, `Running ${manifest.purpose}`);
      try {
        const output = await manifest.execute(input as I, { signal });
        const terminal = terminalActivity(output);
        activities?.finish(
          activityId ?? "",
          terminal?.status ?? "completed",
          terminal?.summary ?? `Completed ${manifest.purpose}`,
        );
        return output;
      } catch (error) {
        activities?.finish(
          activityId ?? "",
          isAbortError(error, signal) ? "cancelled" : "failed",
          isAbortError(error, signal)
            ? `Cancelled ${manifest.purpose}`
            : `Failed ${manifest.purpose}`,
        );
        throw error;
      }
    },
  };
}

export async function registerToolSet(
  manifests: readonly ToolManifest<unknown, unknown>[],
  context: Readonly<{
    modelContext: unknown;
    activities?: AgentActivityStore;
    signal?: AbortSignal;
  }>,
): Promise<() => void> {
  validateToolManifest(manifests);
  if (!isModelContextAvailable(context.modelContext)) {
    throw new Error("WebMCP ModelContext is unavailable.");
  }

  const controller = new AbortController();
  const abortRegistration = () => controller.abort();
  if (context.signal?.aborted) {
    throw new DOMException("WebMCP registration aborted.", "AbortError");
  }
  context.signal?.addEventListener("abort", abortRegistration, { once: true });
  const cleanup = () => {
    context.signal?.removeEventListener("abort", abortRegistration);
    controller.abort();
  };
  try {
    for (const manifest of manifests) {
      if (controller.signal.aborted) {
        throw new DOMException("WebMCP registration aborted.", "AbortError");
      }
      await (context.modelContext as ModelContext).registerTool(
        registeredTool(manifest, context.activities),
        { signal: controller.signal },
      );
      if (controller.signal.aborted) {
        throw new DOMException("WebMCP registration aborted.", "AbortError");
      }
    }
  } catch (error) {
    cleanup();
    throw error;
  }

  return cleanup;
}
