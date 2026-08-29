import type { JsonSchema } from "./types.js";

const maxParameterDescriptionLength = 150;

export function jsonString(
  options: Readonly<{ description: string; maxLength?: number }>,
): JsonSchema {
  if (
    options.description.trim().length === 0 ||
    options.description.length > maxParameterDescriptionLength
  ) {
    throw new Error("JSON Schema parameter description must be 1 to 150 characters.");
  }
  if (
    options.maxLength !== undefined &&
    (!Number.isSafeInteger(options.maxLength) || options.maxLength < 1)
  ) {
    throw new Error("JSON Schema string maxLength must be a positive safe integer.");
  }

  return {
    type: "string",
    description: options.description,
    ...(options.maxLength === undefined ? {} : { maxLength: options.maxLength }),
  };
}

export function jsonObject(
  options: Readonly<{
    properties: Readonly<Record<string, JsonSchema>>;
    required?: readonly string[];
  }>,
): JsonSchema {
  const required = options.required ?? [];
  if (
    new Set(required).size !== required.length ||
    required.some((key) => options.properties[key] === undefined)
  ) {
    throw new Error("JSON Schema required keys must be distinct declared properties.");
  }

  return {
    type: "object",
    additionalProperties: false,
    properties: options.properties,
    ...(required.length === 0 ? {} : { required }),
  };
}
