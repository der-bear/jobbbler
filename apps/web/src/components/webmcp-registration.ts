import type { ToolManifest } from "@jobbbler/webmcp";

export const stableWebMcpCoreNames = [
  "plan_job_workflow",
  "get_search_filters",
  "search_jobs",
  "open_job_details",
  "prepare_application",
  "get_applications",
  "open_jobbbler_page",
  "enable_workspace_recovery",
  "recover_jobbbler_workspace",
] as const;

export function mergeToolManifests(
  core: readonly ToolManifest<unknown, unknown>[],
  contextual: readonly ToolManifest<unknown, unknown>[],
): readonly ToolManifest<unknown, unknown>[] {
  const names = new Set<string>();
  const merged: ToolManifest<unknown, unknown>[] = [];

  for (const manifest of [...core, ...contextual]) {
    if (names.has(manifest.name)) continue;
    names.add(manifest.name);
    merged.push(manifest);
  }

  return merged;
}

export interface StableWebMcpManifestSets {
  readonly core: readonly ToolManifest<unknown, unknown>[];
  readonly search: readonly ToolManifest<unknown, unknown>[];
  readonly detail: readonly ToolManifest<unknown, unknown>[];
  readonly comparison: readonly ToolManifest<unknown, unknown>[];
  readonly saved: readonly ToolManifest<unknown, unknown>[];
  readonly application: readonly ToolManifest<unknown, unknown>[];
}

export function composeStableWebMcpManifests(
  sets: StableWebMcpManifestSets,
): readonly ToolManifest<unknown, unknown>[] {
  return mergeToolManifests(sets.core, [
    ...sets.search,
    ...sets.detail,
    ...sets.comparison,
    ...sets.saved,
    ...sets.application,
  ]);
}
