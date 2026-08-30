import { describe, expect, it, vi } from "vitest";

import {
  subscribeToSupabaseActivityWakeups,
  type ActivityRealtimeClient,
} from "./supabase-activity-wakeup";

const ownerId = "owner_550e8400-e29b-41d4-a716-446655440000";
const config = {
  enabled: true,
  url: "https://project.supabase.co",
  anonKey: "public-anon-key-with-at-least-32-characters",
};

function client(
  claim: unknown = ownerId,
  subscribeStatus: "SUBSCRIBED" | "CHANNEL_ERROR" = "SUBSCRIBED",
) {
  let broadcast: (() => void) | undefined;
  const channel = {
    on: vi.fn(
      (_type: "broadcast", _filter: { readonly event: "changed" }, callback: () => void) => {
        broadcast = callback;
        return channel;
      },
    ),
    subscribe: vi.fn((callback?: (status: "SUBSCRIBED" | "CHANNEL_ERROR") => void) => {
      callback?.(subscribeStatus);
      return channel;
    }),
  };
  const realtimeClient = {
    auth: {
      getSession: vi.fn(async () => ({
        data: {
          session: {
            access_token: "signed-supabase-user-jwt",
            user: { app_metadata: { jobbbler_owner_id: claim } },
          },
        },
      })),
    },
    realtime: { setAuth: vi.fn(async () => undefined) },
    channel: vi.fn(() => channel),
    removeChannel: vi.fn(async () => "ok"),
  } satisfies ActivityRealtimeClient;
  return { realtimeClient, channel, broadcast: () => broadcast?.() };
}

describe("Supabase activity wakeup adapter", () => {
  it("is disabled without explicit public configuration", async () => {
    const createClient = vi.fn();
    const subscription = await subscribeToSupabaseActivityWakeups(vi.fn(), {
      config: { enabled: false, url: null, anonKey: null },
      createClient,
    });
    expect(createClient).not.toHaveBeenCalled();
    expect(subscription).toBeNull();
  });

  it("refuses a channel unless a signed Supabase session carries a valid owner claim", async () => {
    const invalid = client("not-an-owner-id");
    const subscription = await subscribeToSupabaseActivityWakeups(vi.fn(), {
      config,
      createClient: () => invalid.realtimeClient,
    });
    expect(invalid.realtimeClient.channel).not.toHaveBeenCalled();
    expect(invalid.realtimeClient.realtime.setAuth).not.toHaveBeenCalled();
    expect(subscription).toBeNull();
  });

  it("reports an inactive transport when the private channel cannot confirm subscription", async () => {
    const rejected = client(ownerId, "CHANNEL_ERROR");
    const subscription = await subscribeToSupabaseActivityWakeups(vi.fn(), {
      config,
      createClient: () => rejected.realtimeClient,
    });

    expect(subscription).toBeNull();
    expect(rejected.realtimeClient.removeChannel).toHaveBeenCalledWith(rejected.channel);
  });

  it("uses a private owner channel carrying only an empty wakeup signal", async () => {
    const configured = client();
    const wakeup = vi.fn();
    const remove = await subscribeToSupabaseActivityWakeups(wakeup, {
      config,
      createClient: vi.fn(() => configured.realtimeClient),
    });

    expect(configured.realtimeClient.realtime.setAuth).toHaveBeenCalledWith(
      "signed-supabase-user-jwt",
    );
    expect(configured.realtimeClient.channel).toHaveBeenCalledWith(`owner_activity:${ownerId}`, {
      config: { private: true, broadcast: { ack: false, self: false } },
    });
    expect(configured.channel.on).toHaveBeenCalledWith(
      "broadcast",
      { event: "changed" },
      expect.any(Function),
    );
    configured.broadcast();
    expect(wakeup).toHaveBeenCalledOnce();
    expect(JSON.stringify(configured.realtimeClient.channel.mock.calls)).not.toContain(
      "signed-supabase-user-jwt",
    );

    expect(remove).not.toBeNull();
    remove?.();
    expect(configured.realtimeClient.removeChannel).toHaveBeenCalledWith(configured.channel);
  });
});
