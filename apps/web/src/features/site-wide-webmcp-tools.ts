import { z } from "zod";

import {
  emailAddressSchema,
  entityIdSchema,
  jobIdSchema,
  type ApplicationListItem,
  type CompleteEmailVerificationInput,
  type CompleteEmailVerificationResult,
  type CompleteOwnerRecoveryInput,
  type OwnerSessionResult,
  type StartEmailVerificationInput,
  type StartEmailVerificationResult,
  type StartOwnerRecoveryInput,
  type StartOwnerRecoveryResult,
} from "@jobbbler/contracts";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import {
  completedWebMcpResult,
  safeWebMcpErrorResult,
  type CompletedWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";
import type { WebMcpNavigate } from "@/lib/webmcp-navigation";

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
  message: "Expected an application ID.",
});
const recoveryIdSchema = entityIdSchema.refine((value) => value.startsWith("recovery_"), {
  message: "Expected a recovery ID returned by the start action.",
});
const challengeIdSchema = entityIdSchema.refine((value) => value.startsWith("challenge_"), {
  message: "Expected a challenge ID returned by the start action.",
});
const recoverWorkspaceInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), email: emailAddressSchema }),
  z.strictObject({
    action: z.literal("complete"),
    recoveryId: recoveryIdSchema,
    code: z.string().regex(/^\d{6}$/u),
  }),
]);
const enableRecoveryInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("start"), email: emailAddressSchema }),
  z.strictObject({
    action: z.literal("complete"),
    challengeId: challengeIdSchema,
    code: z.string().regex(/^\d{6}$/u),
  }),
]);
const getApplicationsInput = z.strictObject({
  limit: z.number().int().min(1).max(20).default(10),
  offset: z.number().int().nonnegative().default(0),
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
  onNavigate: WebMcpNavigate;
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
  startOwnerRecovery(
    input: StartOwnerRecoveryInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<StartOwnerRecoveryResult>;
  completeOwnerRecovery(
    input: CompleteOwnerRecoveryInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<OwnerSessionResult>;
  startEmailVerification(
    input: StartEmailVerificationInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<StartEmailVerificationResult>;
  completeEmailVerification(
    input: CompleteEmailVerificationInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<CompleteEmailVerificationResult>;
  listApplications(
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<readonly ApplicationListItem[]>;
  onWorkspaceRecovered(expiresAt: string): void;
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
      "Navigate to Search, Saved searches, Applications, the WebMCP guide, a two- or three-role Comparison, or one existing private Application. Comparison and private-application destinations require exact IDs; this tool creates no authority.",
    inputSchema: openPageInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = openPageInput.parse(input);
        const href = destinationHref(parsed);
        await dependencies.onNavigate(href, { signal });
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
    purpose: "Create or reopen one private Jobbbler application for a chosen role.",
    description:
      "Create or reopen the private application for one Jobbbler role when the person asks to apply. Returns its application ID and opens its workspace so the agent can check missing facts next. It grants no preparation authority, shares no candidate data, and submits nothing.",
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
              ? "Application created and ready for preparation."
              : "Application reopened and ready for preparation.",
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

  const getApplications: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "get_applications",
    purpose: "List this private workspace's applications without returning candidate answers.",
    description:
      "List private Jobbbler applications newest first after a current or recovered owner session is present. Returns only application and job identifiers, role title and organization, role and application status, update time, and receipt availability. It never returns answers, candidate fields, email, or credentials.",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        limit: {
          type: "integer",
          minimum: 1,
          maximum: 20,
          default: 10,
          description: "Number of applications to return, from 1 to 20. Defaults to 10.",
        },
        offset: {
          type: "integer",
          minimum: 0,
          default: 0,
          description: "Zero-based offset into applications sorted newest first. Defaults to 0.",
        },
      },
    },
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const { limit, offset } = getApplicationsInput.parse(input);
        const items = await dependencies.listApplications({ signal });
        const sorted = [...items].sort(
          (left, right) =>
            right.updatedAt.localeCompare(left.updatedAt) ||
            left.draftId.localeCompare(right.draftId),
        );
        const page = sorted.slice(offset, offset + limit);
        const nextOffset = offset + page.length < sorted.length ? offset + page.length : null;
        return completedWebMcpResult({
          summary:
            page.length === 0
              ? "No applications found in this page."
              : `Returned ${String(page.length)} private application${page.length === 1 ? "" : "s"}.`,
          data: {
            total: sorted.length,
            returned: page.length,
            nextOffset,
            applications: page.map((item) => ({
              applicationId: item.draftId,
              jobId: item.job.id,
              title: item.job.title,
              organization: item.job.organizationName,
              jobStatus: item.job.status,
              state: item.state,
              updatedAt: item.updatedAt,
              receiptAvailable: item.state === "submitted" || item.state === "handed_off",
            })),
          },
          maximumBytes: 16_000,
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Use optional limit from 1 to 20 and a non-negative offset.",
        );
      }
    },
  };

  const enableWorkspaceRecovery: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "enable_workspace_recovery",
    purpose: "Optionally add passwordless recovery to the current private Jobbbler workspace.",
    description:
      "Enable optional passwordless recovery for the current private workspace in two calls; a current owner session is required. This is not consent, not application submission approval, and not an alert subscription. First use action=start with the person's email; then ask for the six-digit code in the agent client and use action=complete with the exact challengeId. Returns no email, endpoint, owner, or session data.",
    inputSchema: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["start"] },
            email: {
              type: "string",
              format: "email",
              maxLength: 320,
              description: "Email explicitly supplied by the person for optional recovery.",
            },
          },
          required: ["action", "email"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["complete"] },
            challengeId: {
              type: "string",
              pattern: "^challenge_[0-9a-f-]{36}$",
              description: "Exact challengeId returned by this tool's start action.",
            },
            code: {
              type: "string",
              pattern: "^[0-9]{6}$",
              description: "Six-digit code explicitly supplied by the person in the agent client.",
            },
          },
          required: ["action", "challengeId", "code"],
        },
      ],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = enableRecoveryInput.parse(input);
        if (parsed.action === "start") {
          const started = await dependencies.startEmailVerification(
            { email: parsed.email },
            { signal },
          );
          return completedWebMcpResult({
            summary: "Optional passwordless recovery setup started.",
            data: {
              phase: "code_required",
              challengeId: started.challengeId,
              expiresAt: started.expiresAt,
              nextTool: "enable_workspace_recovery",
            },
          });
        }

        await dependencies.completeEmailVerification(
          { challengeId: parsed.challengeId, code: parsed.code },
          { signal },
        );
        return completedWebMcpResult({
          summary: "Optional passwordless workspace recovery is enabled.",
          data: {
            phase: "enabled",
            nextTools: ["get_applications", "get_saved_alerts"],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Use action=start with one email, or action=complete with its exact challengeId and six-digit code.",
        );
      }
    },
  };

  const recoverWorkspace: ToolManifest<unknown, SiteWideToolOutput> = {
    name: "recover_jobbbler_workspace",
    purpose:
      "Restore private Jobbbler applications and saved searches with an email and one-time code.",
    description:
      "Restore private Jobbbler applications and saved searches in two calls. First use action=start with the verified email explicitly supplied by the person. Then ask for the six-digit code in the agent client and use action=complete with the exact recoveryId. The tool never returns the email, code, owner, or session credential.",
    inputSchema: {
      oneOf: [
        {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["start"] },
            email: {
              type: "string",
              format: "email",
              maxLength: 320,
              description: "Verified email explicitly supplied by the person in the agent client.",
            },
          },
          required: ["action", "email"],
        },
        {
          type: "object",
          additionalProperties: false,
          properties: {
            action: { type: "string", enum: ["complete"] },
            recoveryId: {
              type: "string",
              pattern: "^recovery_[0-9a-f-]{36}$",
              description: "Exact recoveryId returned by this tool's start action.",
            },
            code: {
              type: "string",
              pattern: "^[0-9]{6}$",
              description: "Six-digit code explicitly supplied by the person in the agent client.",
            },
          },
          required: ["action", "recoveryId", "code"],
        },
      ],
    },
    annotations: { readOnlyHint: false, untrustedContentHint: false },
    async execute(input, { signal }) {
      try {
        const parsed = recoverWorkspaceInput.parse(input);
        if (parsed.action === "start") {
          const started = await dependencies.startOwnerRecovery(
            { email: parsed.email },
            { signal },
          );
          return completedWebMcpResult({
            summary: "If a verified workspace matches, a six-digit code is on its way.",
            data: {
              phase: "code_required",
              recoveryId: started.recoveryId,
              expiresAt: started.expiresAt,
              nextTool: "recover_jobbbler_workspace",
            },
          });
        }

        const recovered = await dependencies.completeOwnerRecovery(
          { recoveryId: parsed.recoveryId, code: parsed.code },
          { signal },
        );
        dependencies.onWorkspaceRecovered(recovered.expiresAt);
        return completedWebMcpResult({
          summary: "Private workspace access recovered.",
          data: {
            phase: "recovered",
            nextTools: ["get_applications", "get_saved_alerts"],
          },
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Use action=start with one verified email, or action=complete with its exact recoveryId and six-digit code.",
        );
      }
    },
  };

  return [
    openJobbblerPage,
    startApplication,
    getApplications,
    enableWorkspaceRecovery,
    recoverWorkspace,
  ];
}
