import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebMcpNavigator } from "./webmcp-navigation";

describe("createWebMcpNavigator", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves only after the destination URL is committed", async () => {
    vi.useFakeTimers();
    let currentUrl = "https://jobbbler.test/about/webmcp";
    const navigate = createWebMcpNavigator({
      currentUrl: () => currentUrl,
      navigate(href) {
        globalThis.setTimeout(() => {
          currentUrl = new URL(href, currentUrl).href;
        }, 50);
      },
      pollIntervalMilliseconds: 10,
      timeoutMilliseconds: 1_000,
    });
    let settled = false;

    const navigation = Promise.resolve(
      navigate("/jobs?q=platform", {
        signal: new AbortController().signal,
      }),
    ).then(() => {
      settled = true;
    });

    await vi.advanceTimersByTimeAsync(40);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(10);
    await navigation;
    expect(settled).toBe(true);
    expect(currentUrl).toBe("https://jobbbler.test/jobs?q=platform");
  });
});
