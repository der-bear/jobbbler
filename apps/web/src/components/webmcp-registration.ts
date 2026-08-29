import type { ToolManifest } from "@jobbbler/webmcp";

export const stableWebMcpCoreNames = [
  "plan_job_workflow",
  "get_site_capabilities",
  "get_search_filters",
  "search_jobs",
  "open_job_details",
  "open_jobbbler_page",
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
