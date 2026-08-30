import { afterEach, describe, expect, it, vi } from "vitest";

afterEach(() => {
  vi.doUnmock("@supabase/supabase-js");
  vi.resetModules();
});

describe("Supabase activity wakeup SDK loading", () => {
  it("loads the SDK only after a valid enabled configuration needs the default client", async () => {
    const evaluated = vi.fn();
    vi.doMock("@supabase/supabase-js", () => {
      evaluated();
      return {
        createClient: () => ({
          auth: { getSession: async () => ({ data: { session: null } }) },
          realtime: { setAuth: async () => undefined },
          channel: () => {
            throw new Error("A session-less client must not open a channel.");
          },
          removeChannel: async () => undefined,
        }),
      };
    });

    const { subscribeToSupabaseActivityWakeups } = await import("./supabase-activity-wakeup");
    expect(evaluated).not.toHaveBeenCalled();

    await subscribeToSupabaseActivityWakeups(vi.fn(), {
      config: { enabled: false, url: null, anonKey: null },
    });
    expect(evaluated).not.toHaveBeenCalled();

    await subscribeToSupabaseActivityWakeups(vi.fn(), {
      config: {
        enabled: true,
        url: "https://project.supabase.co",
        anonKey: "public-anon-key-with-at-least-32-characters",
      },
    });
    expect(evaluated).toHaveBeenCalledOnce();
  });
});
