import { describe, expect, it } from "vitest";

import { jobbblerUserAgent, resolvePublicOrigin } from "./public-origin.js";

describe("public origin", () => {
  it("normalizes the configured origin and builds an honest product contact", () => {
    const environment = {
      NODE_ENV: "production",
      PUBLIC_BASE_URL: "https://jobs.example.org/",
    };

    expect(resolvePublicOrigin(environment)).toBe("https://jobs.example.org");
    expect(jobbblerUserAgent(environment)).toBe("Jobbbler/0.1 (+https://jobs.example.org)");
    expect(jobbblerUserAgent(environment, "/about/sources")).toBe(
      "Jobbbler/0.1 (+https://jobs.example.org/about/sources)",
    );
  });

  it("fails closed when a production contact is missing or not a clean HTTPS origin", () => {
    expect(() => resolvePublicOrigin({ NODE_ENV: "production" })).toThrow("PUBLIC_BASE_URL");
    expect(() =>
      resolvePublicOrigin({
        NODE_ENV: "production",
        PUBLIC_BASE_URL: "http://jobs.example.org/path?unsafe=true",
      }),
    ).toThrow("clean HTTPS origin");
  });
});
