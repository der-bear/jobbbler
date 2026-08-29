import type { ModelContext } from "./types.js";

export function isModelContextAvailable(value: unknown): value is ModelContext {
  return (
    typeof value === "object" &&
    value !== null &&
    "registerTool" in value &&
    typeof value.registerTool === "function"
  );
}
