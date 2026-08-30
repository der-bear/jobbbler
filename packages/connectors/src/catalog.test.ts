import { describe, expect, it, vi } from "vitest";

import { createCatalogConnectors } from "./catalog.js";

describe("catalog connectors", () => {
  it("uses the deployed public source page in every outbound user agent", () => {
    const connectors = createCatalogConnectors(vi.fn(), {
      userAgent: "Jobbbler/0.1 (+https://jobs.example.org/about/sources)",
    });

    expect(connectors.map(({ policy }) => policy.userAgent)).toEqual([
      "Jobbbler/0.1 (+https://jobs.example.org/about/sources)",
      "Jobbbler/0.1 (+https://jobs.example.org/about/sources)",
      "Jobbbler/0.1 (+https://jobs.example.org/about/sources)",
    ]);
  });
});
