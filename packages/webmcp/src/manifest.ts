import { toolDescriptionSchema, toolNameSchema } from "@jobbbler/contracts";

import type { ToolManifest } from "./types.js";

const maxPurposeLength = 240;

function validateJsonValue(value: unknown): void {
  if (value === null || typeof value === "boolean" || typeof value === "string") return;
  if (typeof value === "number") {
    if (!Number.isFinite(value)) throw new Error("JSON Schema must contain only finite numbers.");
    return;
  }
  if (Array.isArray(value)) {
    value.forEach(validateJsonValue);
    return;
  }
  if (typeof value === "object") {
    Object.values(value).forEach(validateJsonValue);
    return;
  }
  throw new Error("JSON Schema must be JSON-serializable.");
}

export function validateToolManifest(manifests: readonly ToolManifest<unknown, unknown>[]): void {
  const names = new Set<string>();
  const purposes = new Set<string>();

  for (const manifest of manifests) {
    toolNameSchema.parse(manifest.name);
    if (manifest.description.trim().length === 0 || manifest.description.length > 500) {
      throw new Error("Tool description must be 1 to 500 characters.");
    }
    toolDescriptionSchema.parse(manifest.description);
    if (manifest.purpose.trim().length === 0 || manifest.purpose.length > maxPurposeLength) {
      throw new Error("Tool purpose must be 1 to 240 characters.");
    }
    if (
      typeof manifest.annotations.readOnlyHint !== "boolean" ||
      typeof manifest.annotations.untrustedContentHint !== "boolean"
    ) {
      throw new Error("Tool annotations must be explicit boolean values.");
    }
    if (names.has(manifest.name)) throw new Error(`Duplicate tool name: ${manifest.name}`);
    if (purposes.has(manifest.purpose))
      throw new Error(`Duplicate tool purpose: ${manifest.purpose}`);
    validateJsonValue(manifest.inputSchema);
    names.add(manifest.name);
    purposes.add(manifest.purpose);
  }
}
