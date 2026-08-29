import type { ZodType } from "zod";

import {
  applicationStartResultSchema,
  ownerSessionResultSchema,
  type ApplicationStartResult,
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
  signal?: AbortSignal,
): Promise<ApplicationStartResult> {
  return request("/api/v1/applications", applicationStartResultSchema, {
    method: "POST",
    body: { jobId },
    ...(signal === undefined ? {} : { signal }),
  });
}

export async function startApplication(
  jobId: string,
  dependencies: StartApplicationDependencies,
  options: Readonly<{ signal?: AbortSignal }> = {},
): Promise<ApplicationStartResult> {
  let result: ApplicationStartResult;
  try {
    result = await createDraft(jobId, dependencies.request, options.signal);
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "UNAUTHORIZED") throw error;
    await dependencies.request("/api/v1/owners/session", ownerSessionResultSchema, {
      method: "POST",
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    });
    result = await createDraft(jobId, dependencies.request, options.signal);
  }
  dependencies.navigate(`/apply/${encodeURIComponent(result.draft.id)}`);
  return result;
}

export const applicationStartRequest = defaultDependencies.request;
