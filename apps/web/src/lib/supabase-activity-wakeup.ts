import { entityIdSchema } from "@jobbbler/contracts";

export type ActivityRealtimeSubscribeStatus =
  "SUBSCRIBED" | "TIMED_OUT" | "CLOSED" | "CHANNEL_ERROR";

export interface ActivityRealtimeChannel {
  on(
    type: "broadcast",
    filter: { readonly event: "changed" },
    callback: () => void,
  ): ActivityRealtimeChannel;
  subscribe(callback?: (status: ActivityRealtimeSubscribeStatus) => void): ActivityRealtimeChannel;
}

export interface ActivityRealtimeClient {
  readonly auth: {
    getSession(): Promise<{
      readonly data: {
        readonly session: {
          readonly access_token: string;
          readonly user: { readonly app_metadata: Readonly<Record<string, unknown>> };
        } | null;
      };
    }>;
  };
  readonly realtime: { setAuth(token: string): Promise<void> };
  channel(
    topic: string,
    options: {
      readonly config: {
        readonly private: true;
        readonly broadcast: { readonly ack: false; readonly self: false };
      };
    },
  ): ActivityRealtimeChannel;
  removeChannel(channel: ActivityRealtimeChannel): Promise<unknown>;
}

export interface SupabaseActivityWakeupConfig {
  readonly enabled: boolean;
  readonly url: string | null;
  readonly anonKey: string | null;
}

export interface SupabaseActivityWakeupOptions {
  readonly config: SupabaseActivityWakeupConfig;
  readonly createClient?: (url: string, anonKey: string) => ActivityRealtimeClient;
}

function validConfig(
  config: SupabaseActivityWakeupConfig,
): config is SupabaseActivityWakeupConfig & { readonly url: string; readonly anonKey: string } {
  if (!config.enabled || config.url === null || config.anonKey === null) return false;
  if (config.anonKey.length < 20 || config.anonKey.length > 4_096) return false;
  try {
    return new URL(config.url).protocol === "https:";
  } catch {
    return false;
  }
}

async function defaultClient(url: string, anonKey: string): Promise<ActivityRealtimeClient> {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(url, anonKey, {
    auth: {
      autoRefreshToken: true,
      detectSessionInUrl: false,
      persistSession: true,
    },
  }) as unknown as ActivityRealtimeClient;
}

export async function subscribeToSupabaseActivityWakeups(
  wakeup: () => void,
  options: SupabaseActivityWakeupOptions,
): Promise<(() => void) | null> {
  if (!validConfig(options.config)) return null;
  try {
    const client =
      options.createClient === undefined
        ? await defaultClient(options.config.url, options.config.anonKey)
        : options.createClient(options.config.url, options.config.anonKey);
    const { data } = await client.auth.getSession();
    const session = data.session;
    if (
      session === null ||
      session.access_token.length < 20 ||
      session.access_token.length > 8_192
    ) {
      return null;
    }
    const ownerClaim = entityIdSchema.safeParse(session.user.app_metadata["jobbbler_owner_id"]);
    if (!ownerClaim.success || !ownerClaim.data.startsWith("owner_")) return null;

    await client.realtime.setAuth(session.access_token);
    const channel = client.channel(`owner_activity:${ownerClaim.data}`, {
      config: { private: true, broadcast: { ack: false, self: false } },
    });
    let removed = false;
    const remove = () => {
      if (removed) return;
      removed = true;
      void client.removeChannel(channel).catch(() => undefined);
    };
    const subscribed = await new Promise<boolean>((resolve) => {
      channel
        .on("broadcast", { event: "changed" }, () => wakeup())
        .subscribe((status) => resolve(status === "SUBSCRIBED"));
    });
    if (!subscribed) {
      remove();
      return null;
    }
    return remove;
  } catch {
    return null;
  }
}

export function publicSupabaseActivityWakeupConfig(): SupabaseActivityWakeupConfig {
  return {
    enabled: process.env.NEXT_PUBLIC_SUPABASE_ACTIVITY_WAKEUPS === "true",
    url: process.env.NEXT_PUBLIC_SUPABASE_URL ?? null,
    anonKey: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ?? null,
  };
}

export function subscribeToConfiguredSupabaseActivityWakeups(
  wakeup: () => void,
): Promise<(() => void) | null> {
  return subscribeToSupabaseActivityWakeups(wakeup, {
    config: publicSupabaseActivityWakeupConfig(),
  });
}
