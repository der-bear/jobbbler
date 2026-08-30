import type { ApplicationListItem } from "@jobbbler/contracts";
import { isDomainError } from "@jobbbler/core-domain";

import { getApplicationRouteDependencies } from "./applications";
import type { ApplicationRouteDependencies } from "./application-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";

interface InitialApplicationsLoadOptions {
  readonly request: Request;
  readonly dependencies?: ApplicationRouteDependencies;
}

export async function loadInitialApplications(
  options: InitialApplicationsLoadOptions,
): Promise<readonly ApplicationListItem[] | null> {
  try {
    const dependencies = options.dependencies ?? getApplicationRouteDependencies();
    const owner = await requireOwnerSession(options.request, dependencies.identity);
    return await dependencies.operations.list(owner.owner.id, dependencies.identity.now());
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORIZED") return null;
    throw error;
  }
}
