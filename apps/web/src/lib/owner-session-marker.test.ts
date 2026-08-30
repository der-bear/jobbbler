import { afterEach, describe, expect, it, vi } from "vitest";

import {
  clearOwnerSessionMarker,
  hasOwnerSessionMarker,
  markOwnerSessionStarted,
  subscribeOwnerSessionStarted,
} from "./owner-session-marker";

function browserStorage() {
  const values = new Map<string, string>();
  const listeners = new Map<string, Set<(event: { readonly key?: string }) => void>>();
  return {
    localStorage: {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
      removeItem: (key: string) => values.delete(key),
    },
    addEventListener: (name: string, listener: (event: { readonly key?: string }) => void) => {
      const registered = listeners.get(name) ?? new Set();
      registered.add(listener);
      listeners.set(name, registered);
    },
    removeEventListener: (name: string, listener: (event: { readonly key?: string }) => void) =>
      listeners.get(name)?.delete(listener),
    dispatchEvent: (event: { readonly type: string; readonly key?: string }) => {
      listeners.get(event.type)?.forEach((listener) => listener(event));
      return true;
    },
    dispatchStorage: () => {
      listeners.get("storage")?.forEach((listener) => listener({ key: "jobbbler-owner-session" }));
    },
  };
}

afterEach(() => vi.unstubAllGlobals());

describe("owner session marker", () => {
  it("removes expired markers instead of treating them as an active session hint", () => {
    const browser = browserStorage();
    vi.stubGlobal("window", browser);
    browser.localStorage.setItem(
      "jobbbler-owner-session",
      JSON.stringify({ expiresAt: Date.now() - 1 }),
    );

    expect(hasOwnerSessionMarker()).toBe(false);
    expect(browser.localStorage.getItem("jobbbler-owner-session")).toBeNull();
  });

  it("wakes listeners for same-tab and cross-tab session signals", () => {
    const browser = browserStorage();
    vi.stubGlobal("window", browser);
    const listener = vi.fn();
    const unsubscribe = subscribeOwnerSessionStarted(listener);

    markOwnerSessionStarted();
    browser.dispatchStorage();

    expect(listener).toHaveBeenCalledTimes(2);
    clearOwnerSessionMarker();
    browser.dispatchStorage();
    expect(listener).toHaveBeenCalledTimes(2);
    unsubscribe();
  });
});
