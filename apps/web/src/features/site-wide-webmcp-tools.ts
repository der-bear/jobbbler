import { z } from "zod";

import { entityIdSchema, jobIdSchema } from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

const openPageInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        page: { type: "string", enum: ["search", "saved", "applications", "webmcp_guide"] },
      },
      required: ["page"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        page: { type: "string", enum: ["comparison"] },
        jobIds: {
          type: "array",
          minItems: 2,
          maxItems: 3,
          uniqueItems: true,
          items: { type: "string", pattern: "^job_[0-9a-f-]{36}$" },
        },
      },
      required: ["page", "jobIds"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        page: { type: "string", enum: ["application"] },
        draftId: { type: "string", pattern: "^application_[0-9a-f-]{36}$" },
      },
      required: ["page", "draftId"],
    },
  ],
} as const satisfies JsonSchema;

const startApplicationInput = z.strictObject({ jobId: jobIdSchema });
const applicationIdSchema = entityIdSchema.refine((value) => value.startsWith("application_"), {
  message: "Expected an application draft ID.",
});
const openPageInput = z.discriminatedUnion("page", [
  z.strictObject({ page: z.literal("search") }),
  z.strictObject({ page: z.literal("saved") }),
  z.strictObject({ page: z.literal("applications") }),
  z.strictObject({ page: z.literal("webmcp_guide") }),
  z.strictObject({
    page: z.literal("comparison"),
    jobIds: z
      .array(jobIdSchema)
      .min(2)
      .max(3)
      .refine((ids) => new Set(ids).size === ids.length, {
        message: "Job IDs must be unique.",
      }),
  }),
  z.strictObject({ page: z.literal("application"), draftId: applicationIdSchema }),
]);

export interface SiteWideToolDependencies {
  onNavigate(href: string): Promise<void> | void;
  startApplication(
    jobId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<
    Readonly<{
      draftId: string;
      href: string;
      disposition: "created" | "reopened";
      nextTool: "get_application_readiness";
    }>
  >;
}

type SiteWideToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

function destinationHref(input: z.infer<typeof openPageInput>): string {
  if (input.page === "search") return "/jobs";
  if (input.page === "saved") return "/saved";
  if (input.page === "applications") return "/applications";
  if (input.page === "webmcp_guide") return "/about/webmcp";
  if (input.page === "application") return `/apply/${encodeURIComponent(input.draftId)}`;
  const parameters = new URLSearchParams();
  for (const jobId of input.jobIds) parameters.append("id", jobId);
  return `/compare?${parameters.toString()}`;
}

export function createSiteWideToolManifests(
  dependencies: SiteWideToolDependencies,
): readonly ToolManifest<unknown, SiteWideToolOutput>[] {
  const openJobbblerPage: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "open_jobbbler_page",
    purpose: "Open a Jobbbler workspace from any page using explicit validated identifiers.",
    description:
      "Navigate to Search, Saved alerts, Applications, the WebMCP guide, a two- or three-role Comparison, or one existing private Application. Comparison and private-application destinations require exact IDs; this tool creates no authority.",
    inputSchema: openPageInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = openPageInput.parse(input);
        const href = destinationHref(parsed);
        await dependencies.onNavigate(href);
        return completedWebMcpResult({
          summary: `Opened the ${parsed.page.replaceAll("_", " ")} workspace.`,
          data: { page: parsed.page, href },
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Choose a supported page and provide the required IDs.",
        );
      }
    },
  };

  const startApplication: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "prepare_application",
    purpose:
      "Create or reopen one private application draft for an explicitly chosen managed internal role.",
    description:
      "Call get_job_application_capability first. Use this only for a managed internal role when the person asks to start an application. For an external role, open the validated HTTPS employer site only when employerSite.available is true; otherwise stop. External roles create no Jobbbler draft. This tool grants no preparation authority, shares no candidate data, and submits nothing.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        jobId: {
          type: "string",
          description: "A job ID returned by search_jobs or get_job_details.",
          pattern: "^job_[0-9a-f-]{36}$",
        },
      },
      required: ["jobId"],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = startApplicationInput.parse(input);
        const workspace = await dependencies.startApplication(parsed.jobId, { signal });
        return completedWebMcpResult({
          summary:
            workspace.disposition === "created"
              ? "Application draft created and ready for preparation."
              : "Application draft reopened and ready for preparation.",
          data: workspace,
          resources: [{ type: "application", id: workspace.draftId, label: "Private application" }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one valid job ID returned by Jobbbler.",
        );
      }
    },
  };

  return [openJobbblerPage, startApplication];
}
