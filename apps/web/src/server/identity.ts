import { createEntityId, createIdentityService } from "@jobbbler/core-domain";
import type { Storage } from "@jobbbler/storage";

import { getServerStorage } from "./context";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import { createEmailProtector, createSecretCodec } from "./identity-security";
import { createVerificationDelivery } from "./verification-delivery";
import { createStorageRateLimiter } from "./rate-limit";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

export function createIdentityRouteDependencies(
  storage: Storage,
  environment: RuntimeEnvironment = process.env,
  now: () => string = () => new Date().toISOString(),
  fetcher: typeof fetch = fetch,
): IdentityRouteDependencies {
  const email = createEmailProtector(environment);
  return {
    identity: createIdentityService({
      store: storage.identity,
      ids: {
        owner: () => createEntityId("owner"),
        session: () => createEntityId("session"),
        endpoint: () => createEntityId("endpoint"),
        challenge: () => createEntityId("challenge"),
        recovery: () => createEntityId("recovery"),
        deletion: () => createEntityId("deletion"),
      },
      secrets: createSecretCodec(environment),
      email,
    }),
    delivery: createVerificationDelivery(environment, email, fetcher),
    environment,
    now,
    nowMs: () => Date.parse(now()),
    rateLimiter: createStorageRateLimiter(storage.rateLimits),
    activity: storage.ownerActivity,
  };
}

const globalRegistry = globalThis as typeof globalThis & {
  __jobbblerIdentityDependencies?: IdentityRouteDependencies;
};

export function getIdentityRouteDependencies(): IdentityRouteDependencies {
  const existing = globalRegistry.__jobbblerIdentityDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createIdentityRouteDependencies(getServerStorage());
  globalRegistry.__jobbblerIdentityDependencies = dependencies;
  return dependencies;
}
