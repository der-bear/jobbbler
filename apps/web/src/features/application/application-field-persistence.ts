import type { ZodType } from "zod";

import {
  applicationDraftSchema,
  type ApplicationDraft,
  type ApplicationWorkspace,
} from "@jobbbler/contracts";

import type { QueryApiOptions } from "@/lib/query-client";

type ApplicationRequest = <T>(
  url: string,
  schema: ZodType<T>,
  options?: QueryApiOptions,
) => Promise<T>;

export async function persistApplicationField(
  input: Readonly<{
    workspace: ApplicationWorkspace;
    fieldKey: string;
    value: string;
    request: ApplicationRequest;
  }>,
): Promise<ApplicationDraft> {
  const field = input.workspace.requirements.find(({ fieldKey }) => fieldKey === input.fieldKey);
  if (field === undefined) throw new Error(`Unknown application field: ${input.fieldKey}.`);

  return input.request(
    `/api/v1/applications/${encodeURIComponent(input.workspace.draft.id)}/answer`,
    applicationDraftSchema,
    {
      method: "POST",
      body: {
        expectedVersion: input.workspace.draft.version,
        answer: {
          fieldKey: field.fieldKey,
          value: input.value,
          provenance: "user_entered",
          sensitive: field.sensitive,
          acceptedByHuman: true,
        },
      },
    },
  );
}
