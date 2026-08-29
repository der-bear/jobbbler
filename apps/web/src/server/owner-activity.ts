import type { Storage } from "@jobbbler/storage";

import { getServerStorage } from "./context";
import { getIdentityRouteDependencies } from "./identity";
import type { IdentityRouteDependencies } from "./identity-route-handlers";
import {
  createOwnerActivityCursorCodec,
  type OwnerActivityRouteDependencies,
} from "./owner-activity-route-handlers";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

function pollAfterMs(environment: RuntimeEnvironment): number {
  const parsed = Number(environment["ACTIVITY_POLL_INTERVAL_MS"] ?? "5000");
  if (!Number.isSafeInteger(parsed) || parsed < 1_000 || parsed > 30_000) {
    throw new Error("ACTIVITY_POLL_INTERVAL_MS must be an integer between 1000 and 30000.");
  }
  return parsed;
}

export function createOwnerActivityRouteDependencies(
  storage: Storage,
  identity: IdentityRouteDependencies,
  environment: RuntimeEnvironment = process.env,
): OwnerActivityRouteDependencies {
  return {
    identity,
    activity: storage.ownerActivity,
    cursor: createOwnerActivityCursorCodec(environment),
    pollAfterMs: pollAfterMs(environment),
  };
}

const registry = globalThis as typeof globalThis & {
  __jobbblerOwnerActivityDependencies?: OwnerActivityRouteDependencies;
};

export function getOwnerActivityRouteDependencies(): OwnerActivityRouteDependencies {
  const existing = registry.__jobbblerOwnerActivityDependencies;
  if (existing !== undefined) return existing;
  const dependencies = createOwnerActivityRouteDependencies(
    getServerStorage(),
    getIdentityRouteDependencies(),
  );
  registry.__jobbblerOwnerActivityDependencies = dependencies;
  return dependencies;
}
