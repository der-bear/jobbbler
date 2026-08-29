import { describe, expect, it } from "vitest";

import type { ToolManifest } from "@jobbbler/webmcp";

import { mergeToolManifests } from "./webmcp-registration";

function manifest(name: string, purpose = name): ToolManifest<unknown, unknown> {
  return {
    name,
    purpose,
    description: `Run ${name}.`,
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute() {
      return { status: "completed" };
    },
  };
}

describe("mergeToolManifests", () => {
  it("keeps the stable core first and appends only context-exclusive tools", () => {
    const coreSearch = manifest("search_jobs", "Global search");
    const contextualSearch = manifest("search_jobs", "Route search");

    const merged = mergeToolManifests(
      [manifest("get_site_capabilities"), coreSearch, manifest("plan_job_workflow")],
      [contextualSearch, manifest("get_search_state")],
    );

    expect(merged.map(({ name }) => name)).toEqual([
      "get_site_capabilities",
      "search_jobs",
      "plan_job_workflow",
      "get_search_state",
    ]);
    expect(merged[1]).toBe(coreSearch);
  });

  it("deduplicates repeated contextual manifests without reordering the first occurrence", () => {
    const first = manifest("get_job_details", "First detail reader");

    const merged = mergeToolManifests(
      [],
      [first, manifest("compare_jobs"), manifest("get_job_details", "Duplicate")],
    );

    expect(merged.map(({ name }) => name)).toEqual(["get_job_details", "compare_jobs"]);
    expect(merged[0]).toBe(first);
  });
});
