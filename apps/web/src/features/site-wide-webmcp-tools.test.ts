import { describe, expect, it, vi } from "vitest";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";

import { createSiteWideToolManifests } from "./site-wide-webmcp-tools";

const firstJobId = "job_00000001-0000-7000-8000-000000000001";
const secondJobId = "job_00000004-0000-7000-8000-000000000004";
const draftId = "application_00000001-0000-7000-8000-000000000001";

type ToolOutput = Readonly<{ status: string; [key: string]: unknown }>;

function findTool(manifests: ReturnType<typeof createSiteWideToolManifests>, name: string) {
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (manifest === undefined) throw new Error(`Missing ${name}.`);
  return manifest;
}

describe("site-wide WebMCP tools", () => {
  it("publishes a compact, read-only capability guide", async () => {
    const manifests = createSiteWideToolManifests({ onNavigate: vi.fn() });

    expect(manifests.map(({ name }) => name)).toEqual([
      "get_site_capabilities",
      "open_jobbbler_page",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([true, false]);

    const result = (await findTool(manifests, "get_site_capabilities").execute(
      {},
      { signal: new AbortController().signal },
    )) as ToolOutput;

    expect(result).toMatchObject({
      status: "completed",
      data: {
        interactionModel: "global_core_plus_context",
        humanBoundaries: expect.arrayContaining([expect.stringContaining("consent")]),
        workflows: expect.arrayContaining([
          expect.objectContaining({ goal: "prepare_application" }),
        ]),
      },
    });
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it.each([
    [{ page: "search" }, "/"],
    [{ page: "saved" }, "/saved"],
    [{ page: "webmcp_guide" }, "/about/webmcp"],
    [
      { page: "comparison", jobIds: [firstJobId, secondJobId] },
      `/compare?id=${firstJobId}&id=${secondJobId}`,
    ],
    [{ page: "application", draftId }, `/apply/${draftId}`],
  ])("opens the requested workspace from any page", async (input, expectedHref) => {
    const onNavigate = vi.fn();
    const manifests = createSiteWideToolManifests({ onNavigate });

    const result = await findTool(manifests, "open_jobbbler_page").execute(input, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({ status: "completed" });
    expect(onNavigate).toHaveBeenCalledWith(expectedHref);
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it.each([
    { page: "comparison" },
    { page: "comparison", jobIds: [firstJobId] },
    { page: "application" },
    { page: "saved", draftId },
    { page: "unknown" },
  ])("rejects incomplete or ambiguous destinations safely", async (input) => {
    const onNavigate = vi.fn();
    const manifests = createSiteWideToolManifests({ onNavigate });

    const result = await findTool(manifests, "open_jobbbler_page").execute(input, {
      signal: new AbortController().signal,
    });

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "VALIDATION", retryable: false },
    });
    expect(onNavigate).not.toHaveBeenCalled();
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });
});
