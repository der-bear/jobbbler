import { describe, expect, it } from "vitest";

import { securityHeaders } from "./security-headers";

describe("security headers", () => {
  it("sets baseline clickjacking, sniffing, referrer, and permissions defenses", () => {
    const headers = securityHeaders({ NODE_ENV: "development" });
    expect(headers).toMatchObject({
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "strict-origin-when-cross-origin",
      "X-Frame-Options": "DENY",
      "Origin-Agent-Cluster": "?1",
      "Permissions-Policy": expect.stringContaining("tools=(self)"),
    });
    expect(headers["Permissions-Policy"]).toContain("camera=()");
    expect(headers["Content-Security-Policy"]).toBeUndefined();
    expect(headers["Origin-Trial"]).toBeUndefined();
    expect(headers["Strict-Transport-Security"]).toBeUndefined();
  });

  it("serves a configured WebMCP origin-trial token as a response header", () => {
    const originTrialToken = "A".repeat(96);
    const headers = securityHeaders({
      NODE_ENV: "production",
      WEBMCP_ORIGIN_TRIAL_TOKEN: originTrialToken,
    });

    expect(headers["Origin-Trial"]).toBe(originTrialToken);
  });

  it.each([
    "too-short",
    `A${"B".repeat(64)}\nInjected: value`,
    `A${"B".repeat(64)} value`,
    "A".repeat(4_097),
  ])("rejects an unsafe WebMCP origin-trial token", (originTrialToken) => {
    expect(() =>
      securityHeaders({
        NODE_ENV: "production",
        WEBMCP_ORIGIN_TRIAL_TOKEN: originTrialToken,
      }),
    ).toThrow(/WEBMCP_ORIGIN_TRIAL_TOKEN/u);
  });

  it("adds a production CSP, HSTS, and the configured Supabase realtime origin", () => {
    const headers = securityHeaders({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://safe-project.supabase.co",
    });

    expect(headers["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
    expect(headers["Content-Security-Policy"]).toContain("default-src 'self'");
    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Content-Security-Policy"]).toContain("https://safe-project.supabase.co");
    expect(headers["Content-Security-Policy"]).toContain("wss://safe-project.supabase.co");
    expect(headers["Content-Security-Policy"]).not.toContain("unsafe-eval");
  });

  it("ignores a malformed realtime URL instead of reflecting it into CSP", () => {
    const headers = securityHeaders({
      NODE_ENV: "production",
      NEXT_PUBLIC_SUPABASE_URL: "https://safe.test; script-src *",
    });
    expect(headers["Content-Security-Policy"]).not.toContain("safe.test");
  });
});
