import { afterEach, describe, expect, it, vi } from "vitest";

import { createWebMcpNavigator } from "./webmcp-navigation";

describe("createWebMcpNavigator", () => {
  afterEach(() => vi.useRealTimers());

  it("resolves only after the destination URL is committed", async () => {
    vi.useFakeTimers();
    let currentUrl = "https://jobbbler.test/about/webmcp";
    const onCommitted = vi.fn();
    const navigate = createWebMcpNavigator({
      currentUrl: () => currentUrl,
      onCommitted,
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
    expect(onCommitted).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(10);
    await navigation;
    expect(settled).toBe(true);
    expect(currentUrl).toBe("https://jobbbler.test/jobs?q=platform");
    expect(onCommitted).toHaveBeenCalledTimes(1);
  });

  it("keeps a cold client-side route transition alive beyond four seconds", async () => {
    vi.useFakeTimers();
    let currentUrl = "https://jobbbler.test/jobs/job_1";
    const navigate = createWebMcpNavigator({
      currentUrl: () => currentUrl,
      navigate(href) {
        globalThis.setTimeout(() => {
          currentUrl = new URL(href, currentUrl).href;
        }, 4_500);
      },
      pollIntervalMilliseconds: 50,
    });

    const navigation = navigate("/jobs?q=platform", {
      signal: new AbortController().signal,
    });

    await vi.advanceTimersByTimeAsync(4_500);
    await expect(navigation).resolves.toBeUndefined();
    expect(currentUrl).toBe("https://jobbbler.test/jobs?q=platform");
  });
});
