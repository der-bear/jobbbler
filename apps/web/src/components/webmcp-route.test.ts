import { describe, expect, it } from "vitest";

import { resolveWebMcpRoute } from "./webmcp-route";

describe("resolveWebMcpRoute", () => {
  it("selects an exact small tool surface for supported routes", () => {
    expect(resolveWebMcpRoute("/")).toEqual({ kind: "search" });
    expect(resolveWebMcpRoute("/jobs/job_00000001-0000-7000-8000-000000000001")).toEqual({
      kind: "detail",
      jobId: "job_00000001-0000-7000-8000-000000000001",
    });
    expect(resolveWebMcpRoute("/compare")).toEqual({ kind: "compare" });
  });

  it("does not expose tools on unsupported or malformed routes", () => {
    expect(resolveWebMcpRoute("/about/webmcp")).toEqual({ kind: "none" });
    expect(resolveWebMcpRoute("/jobs/not-a-job-id")).toEqual({ kind: "none" });
    expect(resolveWebMcpRoute("/jobs/job_00000001-0000-7000-8000-000000000001/extra")).toEqual({
      kind: "none",
    });
  });
});
