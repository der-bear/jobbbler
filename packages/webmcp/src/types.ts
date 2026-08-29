export type JsonPrimitive = boolean | number | string | null;
export type JsonValue =
  JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };
export type JsonSchema = Readonly<Record<string, JsonValue>>;

export interface ToolAnnotations {
  readonly readOnlyHint: boolean;
  readonly untrustedContentHint: boolean;
}

export interface ToolManifest<I, O> {
  readonly name: string;
  readonly purpose: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations: ToolAnnotations;
  execute(input: I, options: { readonly signal: AbortSignal }): Promise<O>;
}

export interface RegisteredTool {
  readonly name: string;
  readonly title: string;
  readonly description: string;
  readonly inputSchema: JsonSchema;
  readonly annotations: ToolAnnotations;
  execute(input: unknown, options: { readonly signal: AbortSignal }): Promise<unknown>;
}

export interface ModelContext {
  registerTool(tool: RegisteredTool, options: { readonly signal: AbortSignal }): Promise<void>;
}

import type { ToolActivity } from "@jobbbler/contracts";

export type AgentActivity = ToolActivity;
export type AgentActivityStatus = AgentActivity["status"];
