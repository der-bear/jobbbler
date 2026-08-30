import type { ApplicationWorkspace, Job } from "@jobbbler/contracts";
import { isDomainError } from "@jobbbler/core-domain";

import { getApplicationRouteDependencies } from "./applications";
import type { ApplicationRouteDependencies } from "./application-route-handlers";
import { requireOwnerSession } from "./identity-route-handlers";

export interface InitialApplication {
  readonly workspace: ApplicationWorkspace;
  readonly job: Job;
}

interface InitialApplicationLoadOptions {
  readonly request: Request;
  readonly dependencies?: ApplicationRouteDependencies;
}

export async function loadInitialApplication(
  draftId: string,
  options: InitialApplicationLoadOptions,
): Promise<InitialApplication | null> {
  try {
    const dependencies = options.dependencies ?? getApplicationRouteDependencies();
    const owner = await requireOwnerSession(options.request, dependencies.identity);
    const workspace = await dependencies.operations.get(
      owner.owner.id,
      draftId,
      dependencies.identity.now(),
    );
    if (workspace.job === undefined) return null;
    return { workspace, job: workspace.job };
  } catch (error) {
    if (isDomainError(error) && error.code === "UNAUTHORIZED") return null;
    throw error;
  }
}
