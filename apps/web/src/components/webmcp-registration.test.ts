import { describe, expect, it } from "vitest";

import type { ToolManifest } from "@jobbbler/webmcp";

import { composeStableWebMcpManifests, mergeToolManifests } from "./webmcp-registration";

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
      [coreSearch, manifest("plan_job_workflow")],
      [contextualSearch, manifest("get_search_state")],
    );

    expect(merged.map(({ name }) => name)).toEqual([
      "search_jobs",
      "plan_job_workflow",
      "get_search_state",
    ]);
    expect(merged[0]).toBe(coreSearch);
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

describe("composeStableWebMcpManifests", () => {
  it("keeps feature tools discoverable when the visible route changes", () => {
    const core = [manifest("search_jobs"), manifest("plan_job_workflow")];
    const search = [manifest("search_jobs"), manifest("get_search_state")];
    const detail = [manifest("get_job_details"), manifest("compare_jobs")];
    const comparison = [manifest("get_comparison")];
    const saved = [manifest("get_saved_alerts")];

    const fromSearch = composeStableWebMcpManifests({
      core,
      search,
      detail,
      comparison,
      saved,
      application: [],
    });
    const fromSaved = composeStableWebMcpManifests({
      core,
      search,
      detail,
      comparison,
      saved,
      application: [manifest("get_application_readiness")],
    });

    expect(fromSearch.map(({ name }) => name)).toEqual([
      "search_jobs",
      "plan_job_workflow",
      "get_search_state",
      "get_job_details",
      "compare_jobs",
      "get_comparison",
      "get_saved_alerts",
    ]);
    expect(fromSaved.map(({ name }) => name)).toEqual([
      ...fromSearch.map(({ name }) => name),
      "get_application_readiness",
    ]);
  });
});
