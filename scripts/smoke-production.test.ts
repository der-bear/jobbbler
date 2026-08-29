import { describe, expect, it, vi } from "vitest";

import { normalizeSmokeBaseUrl, runProductionSmoke } from "./smoke-production";

function jsonResponse(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

describe("production smoke", () => {
  it("accepts only credential-free HTTP(S) origins", () => {
    expect(normalizeSmokeBaseUrl("https://jobbbler.example/path/")).toBe(
      "https://jobbbler.example",
    );
    expect(() => normalizeSmokeBaseUrl("https://user:secret@example.com")).toThrow();
    expect(() => normalizeSmokeBaseUrl("file:///tmp/jobbbler")).toThrow();
  });

  it("verifies public UI, database readiness, discovery, and the private auth boundary", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response("<!doctype html><title>Jobbbler</title><main>Signal over noise</main>", {
          headers: { "content-type": "text/html; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { status: "live" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: { status: "ready", driver: "postgres", migrations: 9, organizations: 12, jobs: 36 },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: {
            jobs: [{ id: "job_demo", title: "Platform Engineer" }],
            total: 1,
          },
        }),
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            ok: false,
            error: {
              code: "UNAUTHORIZED",
              message: "A private owner session is required.",
            },
          },
          401,
          { "cache-control": "no-store" },
        ),
      );

    await expect(
      runProductionSmoke({ baseUrl: "https://jobbbler.example", fetchImpl: request }),
    ).resolves.toEqual({
      baseUrl: "https://jobbbler.example",
      driver: "postgres",
      migrations: 9,
      jobs: 36,
      searchResults: 1,
    });
    expect(request).toHaveBeenCalledTimes(5);
  });

  it("fails closed when readiness does not report a populated database", async () => {
    const request = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response("<title>Jobbbler</title>", { headers: { "content-type": "text/html" } }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, data: { status: "live" } }))
      .mockResolvedValueOnce(
        jsonResponse({
          ok: true,
          data: { status: "ready", driver: "postgres", migrations: 9, organizations: 0, jobs: 0 },
        }),
      );

    await expect(
      runProductionSmoke({ baseUrl: "https://jobbbler.example", fetchImpl: request }),
    ).rejects.toThrow("populated catalog");
  });
});
