import { describe, expect, it, vi } from "vitest";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";

import { createSiteWideToolManifests } from "./site-wide-webmcp-tools";

const firstJobId = "job_00000001-0000-7000-8000-000000000001";
const secondJobId = "job_00000004-0000-7000-8000-000000000004";
const draftId = "application_00000001-0000-7000-8000-000000000001";

function findTool(manifests: ReturnType<typeof createSiteWideToolManifests>, name: string) {
  const manifest = manifests.find((candidate) => candidate.name === name);
  if (manifest === undefined) throw new Error(`Missing ${name}.`);
  return manifest;
}

describe("site-wide WebMCP tools", () => {
  it("keeps only distinct site-wide navigation and application actions", () => {
    const manifests = createSiteWideToolManifests({
      onNavigate: vi.fn(),
      startApplication: vi.fn(),
    });

    expect(manifests.map(({ name }) => name)).toEqual([
      "open_jobbbler_page",
      "prepare_application",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([false, false]);
  });

  it.each([
    [{ page: "search" }, "/jobs"],
    [{ page: "saved" }, "/saved"],
    [{ page: "webmcp_guide" }, "/about/webmcp"],
    [
      { page: "comparison", jobIds: [firstJobId, secondJobId] },
      `/compare?id=${firstJobId}&id=${secondJobId}`,
    ],
    [{ page: "application", draftId }, `/apply/${draftId}`],
  ])("opens the requested workspace from any page", async (input, expectedHref) => {
    const onNavigate = vi.fn();
    const manifests = createSiteWideToolManifests({ onNavigate, startApplication: vi.fn() });

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
    const manifests = createSiteWideToolManifests({ onNavigate, startApplication: vi.fn() });

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

  it("prepares one private application from any page and reports whether it was reopened", async () => {
    const startApplication = vi.fn(async () => ({
      draftId,
      href: `/apply/${draftId}`,
      disposition: "reopened" as const,
      nextTool: "get_application_readiness" as const,
    }));
    const manifests = createSiteWideToolManifests({
      onNavigate: vi.fn(),
      startApplication,
    });
    expect(findTool(manifests, "prepare_application").description).toContain(
      "asks to start an application",
    );
    const signal = new AbortController().signal;

    const result = await findTool(manifests, "prepare_application").execute(
      { jobId: firstJobId },
      { signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      summary: "Application draft reopened and ready for preparation.",
      data: {
        draftId,
        href: `/apply/${draftId}`,
        disposition: "reopened",
        nextTool: "get_application_readiness",
      },
    });
    expect(startApplication).toHaveBeenCalledWith(firstJobId, { signal });
  });
});
