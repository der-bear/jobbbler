import type { ZodType } from "zod";

import {
  applicationDraftSchema,
  ownerSessionResultSchema,
  type ApplicationDraft,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi, type QueryApiOptions } from "@/lib/query-client";

interface StartApplicationDependencies {
  readonly request: <T>(url: string, schema: ZodType<T>, options?: QueryApiOptions) => Promise<T>;
  navigate(href: string): void;
}

const defaultDependencies: Pick<StartApplicationDependencies, "request"> = {
  request: queryApi,
};

async function createDraft(
  jobId: string,
  request: StartApplicationDependencies["request"],
): Promise<ApplicationDraft> {
  return request("/api/v1/applications", applicationDraftSchema, {
    method: "POST",
    body: { jobId },
  });
}

export async function startApplication(
  jobId: string,
  dependencies: StartApplicationDependencies,
): Promise<void> {
  let draft: ApplicationDraft;
  try {
    draft = await createDraft(jobId, dependencies.request);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "UNAUTHORIZED") throw error;
    await dependencies.request("/api/v1/owners/session", ownerSessionResultSchema, {
      method: "POST",
    });
    draft = await createDraft(jobId, dependencies.request);
  }
  dependencies.navigate(`/apply/${encodeURIComponent(draft.id)}`);
}

export const applicationStartRequest = defaultDependencies.request;
