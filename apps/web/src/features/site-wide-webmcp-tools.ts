import { z } from "zod";

import { entityIdSchema, jobIdSchema } from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import { webMcpCatalog } from "@/lib/webmcp-catalog";
import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";

import { workflowPlans, workflowVersion, type WorkflowGoal } from "./webmcp-workflows";

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const openPageInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: { page: { type: "string", enum: ["search", "saved", "webmcp_guide"] } },
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

const emptyInput = z.strictObject({});
const applicationIdSchema = entityIdSchema.refine((value) => value.startsWith("application_"), {
  message: "Expected an application draft ID.",
});
const openPageInput = z.discriminatedUnion("page", [
  z.strictObject({ page: z.literal("search") }),
  z.strictObject({ page: z.literal("saved") }),
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
}

type SiteWideToolOutput = CompletedWebMcpResult<JsonValue> | SafeWebMcpErrorResult;

const workflowOrder: readonly WorkflowGoal[] = [
  "find_roles",
  "compare_roles",
  "monitor_search",
  "prepare_application",
  "recover_workspace",
];

function destinationHref(input: z.infer<typeof openPageInput>): string {
  if (input.page === "search") return "/";
  if (input.page === "saved") return "/saved";
  if (input.page === "webmcp_guide") return "/about/webmcp";
  if (input.page === "application") return `/apply/${encodeURIComponent(input.draftId)}`;
  const parameters = new URLSearchParams();
  for (const jobId of input.jobIds) parameters.append("id", jobId);
  return `/compare?${parameters.toString()}`;
}

export function createSiteWideToolManifests(
  dependencies: SiteWideToolDependencies,
): readonly ToolManifest<unknown, SiteWideToolOutput>[] {
  const getSiteCapabilities: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "get_site_capabilities",
    purpose: "Read Jobbbler's workflows, tool coverage, route requirements, and human boundaries.",
    description:
      "Discover what an agent can accomplish across Jobbbler before choosing tools. Returns compact outcome workflows, the global-plus-context interaction model, and the decisions that always remain with the human.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const tools = webMcpCatalog.flatMap((surface) => surface.tools);
        return completedWebMcpResult({
          summary: `Jobbbler exposes ${String(tools.length)} capabilities through a global core plus contextual tools.`,
          data: {
            workflowVersion,
            interactionModel: "global_core_plus_context",
            totalCapabilities: tools.length,
            workflows: workflowOrder.map((goal) => ({
              goal,
              outcome: workflowPlans[goal].title,
            })),
            navigation: {
              search: "search_jobs",
              role: "open_job_details",
              otherWorkspace: "open_jobbbler_page",
            },
            contextualSurfaces: ["role", "comparison", "saved", "application_stage"],
            humanBoundaries: [
              "Human consent is required for exact application data disclosure.",
              "Final application confirmation remains a fresh human decision.",
              "External applications are prepared for handoff, never reported as submitted.",
            ],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Site capabilities accept no arguments.");
      }
    },
  };

  const openJobbblerPage: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "open_jobbbler_page",
    purpose: "Open a Jobbbler workspace from any page using explicit validated identifiers.",
    description:
      "Navigate to Search, Saved alerts, the WebMCP guide, a two- or three-role Comparison, or an existing private Application. Comparison and Application destinations require exact IDs; this tool creates no authority.",
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

  return [getSiteCapabilities, openJobbblerPage];
}
