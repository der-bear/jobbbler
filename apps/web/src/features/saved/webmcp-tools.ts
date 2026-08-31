import { z } from "zod";

import {
  decideSearchAlertResultSchema,
  emailAddressSchema,
  entityIdSchema,
  savedSearchDeletionReceiptSchema,
  scheduleRecurrenceSchema,
  type DecideSearchAlertInput,
  type DecideSearchAlertResult,
  type JobAlertSchedule,
  type JobSearchCriteria,
  type RequestSearchAlertInput,
  type RequestSearchAlertResult,
  type SavedSearch,
  type SavedSearchDeletionReceipt,
  type SetJobAlertEnabledInput,
} from "@jobbbler/contracts";
import { normalizeJobSearchCriteria } from "@jobbbler/jobs-domain";
import type { JsonSchema, JsonValue, ToolManifest } from "@jobbbler/webmcp";

import { jobSearchToolInput, jobSearchToolInputJsonSchema } from "@/features/search/webmcp-tools";
import type { LatestSearchRun } from "@/lib/latest-run";
import { maskEmailAddress } from "@/lib/mask-email-address";

import {
  MAX_WEBMCP_RESULT_BYTES,
  completedWebMcpResult,
  requiresUserActionWebMcpResult,
  safeWebMcpErrorResult,
  webMcpResultSize,
  type CompletedWebMcpResult,
  type RequiresUserActionWebMcpResult,
  type SafeWebMcpErrorResult,
} from "@/lib/webmcp-tool-result";
import type { WebMcpNavigate } from "@/lib/webmcp-navigation";
import { searchAlertReviewPolicy } from "@/lib/search-alert-review-policy";

const emptyInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {},
} as const satisfies JsonSchema;

const emptyInput = z.strictObject({});
const deletionConfirmation = "DELETE_SAVED_SEARCH_AND_ALERT" as const;

const scheduleStateBranch = (action: "pause" | "resume") =>
  ({
    type: "object",
    additionalProperties: false,
    properties: {
      action: {
        type: "string",
        enum: [action],
        description:
          action === "pause"
            ? "Temporarily stop this alert. The saved search remains available."
            : "Resume checking this paused alert.",
      },
      scheduleId: {
        type: "string",
        description: "The exact schedule ID returned by get_saved_alerts.",
        pattern: "^schedule_[0-9a-f-]{36}$",
      },
    },
    required: ["action", "scheduleId"],
  }) as const;

const stateInputSchema = {
  oneOf: [
    scheduleStateBranch("pause"),
    scheduleStateBranch("resume"),
    {
      type: "object",
      additionalProperties: false,
      properties: {
        action: {
          type: "string",
          enum: ["delete"],
          description: "Permanently delete one saved search and stop its alert, if present.",
        },
        savedSearchId: {
          type: "string",
          description: "The exact saved search ID returned by get_saved_alerts.",
          pattern: "^saved_search_[0-9a-f-]{36}$",
        },
        confirmation: {
          type: "string",
          enum: [deletionConfirmation],
          description:
            "Required only after the person explicitly asks to permanently delete this saved search and its alert.",
        },
      },
      required: ["action", "savedSearchId", "confirmation"],
    },
  ],
} as const satisfies JsonSchema;

const stateInput = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("pause"), scheduleId: entityIdSchema }),
  z.strictObject({ action: z.literal("resume"), scheduleId: entityIdSchema }),
  z.strictObject({
    action: z.literal("delete"),
    savedSearchId: entityIdSchema,
    confirmation: z.literal(deletionConfirmation),
  }),
]);

const recurrenceInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        frequency: { type: "string", enum: ["daily"] },
        time: {
          type: "string",
          description: "Local 24-hour time in HH:mm format.",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        },
        timeZone: {
          type: "string",
          description: "IANA time zone, for example Europe/Kyiv.",
          maxLength: 120,
        },
      },
      required: ["frequency", "time", "timeZone"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        frequency: { type: "string", enum: ["weekly"] },
        time: {
          type: "string",
          description: "Local 24-hour time in HH:mm format.",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        },
        timeZone: {
          type: "string",
          description: "IANA time zone, for example Europe/Kyiv.",
          maxLength: 120,
        },
        days: {
          type: "array",
          description: "Unique weekdays on which to check.",
          minItems: 1,
          maxItems: 7,
          uniqueItems: true,
          items: {
            type: "string",
            enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
          },
        },
      },
      required: ["frequency", "time", "timeZone", "days"],
    },
  ],
} as const satisfies JsonSchema;

const requestAlertInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "Short human-readable name for this alert.",
      minLength: 1,
      maxLength: 100,
    },
    criteria: {
      ...jobSearchToolInputJsonSchema,
      description: "Raw search_jobs preferences or get_search_state exact criteria.",
    },
    recurrence: recurrenceInputSchema,
    email: {
      type: "string",
      description: "Delivery email the person explicitly supplied.",
      format: "email",
      maxLength: 320,
    },
  },
  required: ["name", "criteria", "recurrence", "email"],
} as const satisfies JsonSchema;

const saveSearchInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    name: {
      type: "string",
      description: "Short human-readable name for this saved search.",
      minLength: 1,
      maxLength: 100,
    },
    criteria: {
      ...jobSearchToolInputJsonSchema,
      description: "Raw search_jobs preferences or get_search_state exact criteria.",
    },
  },
  required: ["name", "criteria"],
} as const satisfies JsonSchema;

const decisionInputSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: {
          type: "string",
          description: "Exact request ID returned by request_search_alert.",
          pattern: "^[a-z][a-z0-9_]*_[0-9a-f-]{36}$",
        },
        reviewToken: {
          type: "string",
          description: "Opaque review token returned by request_search_alert.",
          maxLength: 4_096,
        },
        decision: { type: "string", enum: ["approved"] },
        code: {
          type: "string",
          description:
            "6-digit code the person received when request_search_alert says email verification is required. Omit it when the destination is already verified.",
          pattern: "^\\d{6}$",
        },
      },
      required: ["requestId", "reviewToken", "decision"],
    },
    {
      type: "object",
      additionalProperties: false,
      properties: {
        requestId: {
          type: "string",
          description: "Exact request ID returned by request_search_alert.",
          pattern: "^[a-z][a-z0-9_]*_[0-9a-f-]{36}$",
        },
        reviewToken: {
          type: "string",
          description: "Opaque review token returned by request_search_alert.",
          maxLength: 4_096,
        },
        decision: { type: "string", enum: ["declined"] },
      },
      required: ["requestId", "reviewToken", "decision"],
    },
  ],
} as const satisfies JsonSchema;

const requestAlertInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  criteria: jobSearchToolInput,
  recurrence: scheduleRecurrenceSchema,
  email: emailAddressSchema,
});
const saveSearchInput = z.strictObject({
  name: z.string().trim().min(1).max(100),
  criteria: jobSearchToolInput,
});
const decisionInput = z.discriminatedUnion("decision", [
  z.strictObject({
    requestId: entityIdSchema,
    reviewToken: z.string().min(1).max(4_096),
    decision: z.literal("approved"),
    code: z
      .string()
      .regex(/^\d{6}$/u)
      .optional(),
  }),
  z.strictObject({
    requestId: entityIdSchema,
    reviewToken: z.string().min(1).max(4_096),
    decision: z.literal("declined"),
  }),
]);

const openSavedInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    savedSearchId: {
      type: "string",
      description: "A saved search ID returned by get_saved_alerts.",
      pattern: "^saved_search_[0-9a-f-]{36}$",
    },
  },
  required: ["savedSearchId"],
} as const satisfies JsonSchema;

const openSavedInput = z.strictObject({ savedSearchId: entityIdSchema });

const latestUpdateInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    savedSearchId: {
      type: "string",
      description: "A saved search ID returned by get_saved_alerts.",
      pattern: "^saved_search_[0-9a-f-]{36}$",
    },
  },
  required: ["savedSearchId"],
} as const satisfies JsonSchema;

export interface SavedToolDependencies {
  listSavedSearches(options: Readonly<{ signal: AbortSignal }>): Promise<readonly SavedSearch[]>;
  listSchedules(options: Readonly<{ signal: AbortSignal }>): Promise<readonly JobAlertSchedule[]>;
  saveSearch(
    input: Readonly<{ name: string; criteria: JobSearchCriteria }>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<SavedSearch>;
  requestSearchAlert(
    input: RequestSearchAlertInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<RequestSearchAlertResult>;
  decideSearchAlert(
    input: DecideSearchAlertInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<DecideSearchAlertResult>;
  setScheduleEnabled(
    scheduleId: string,
    input: SetJobAlertEnabledInput,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<JobAlertSchedule>;
  deleteSavedSearch(
    savedSearchId: string,
    input: Readonly<{ confirmation: typeof deletionConfirmation }>,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<SavedSearchDeletionReceipt>;
  onScheduleCommitted(schedule: JobAlertSchedule): Promise<void> | void;
  onSavedSearchCommitted(savedSearch: SavedSearch): Promise<void> | void;
  onSavedSearchDeleted(receipt: SavedSearchDeletionReceipt): Promise<void> | void;
  savedSearchHref(savedSearch: SavedSearch): string;
  onNavigate: WebMcpNavigate;
  getLatestRun(
    savedSearchId: string,
    options: Readonly<{ signal: AbortSignal }>,
  ): Promise<LatestSearchRun>;
}

type SavedToolOutput =
  CompletedWebMcpResult<JsonValue> | RequiresUserActionWebMcpResult | SafeWebMcpErrorResult;

function short(value: string, maximum: number): string {
  return value.length <= maximum ? value : `${value.slice(0, maximum - 1)}…`;
}

function humanize(value: string): string {
  const words = value.replaceAll("_", " ");
  return `${words.slice(0, 1).toUpperCase()}${words.slice(1)}`;
}

function naturalList(values: readonly string[]): string {
  if (values.length <= 1) return values[0] ?? "";
  if (values.length === 2) return `${values[0]} and ${values[1]}`;
  return `${values.slice(0, -1).join(", ")}, and ${values.at(-1)}`;
}

function describeSearchCriteria(criteria: RequestSearchAlertResult["review"]["criteria"]): string {
  const parts: string[] = [];
  if (criteria.query !== null) parts.push(`“${criteria.query}”`);
  if (criteria.categories.length > 0) {
    parts.push(`categories: ${criteria.categories.map(humanize).join(", ")}`);
  }
  if (criteria.workModels.length > 0) {
    parts.push(`work model: ${criteria.workModels.map(humanize).join(", ")}`);
  }
  if (criteria.seniorities.length > 0) {
    parts.push(`seniority: ${criteria.seniorities.map(humanize).join(", ")}`);
  }
  if (criteria.locations.length > 0) parts.push(`location: ${criteria.locations.join(", ")}`);
  if (criteria.skills.length > 0) parts.push(`skills: ${criteria.skills.join(", ")}`);
  if (criteria.excludeKeywords.length > 0) {
    parts.push(`exclude: ${criteria.excludeKeywords.join(", ")}`);
  }
  if (criteria.salary !== null) {
    const range = [criteria.salary.minimum, criteria.salary.maximum]
      .filter((value): value is number => value !== null)
      .map((value) => value.toLocaleString("en-US"));
    const amount =
      range.length === 2 ? `${range[0]}–${range[1]}` : range[0] === undefined ? "any" : range[0];
    const currency =
      criteria.salary.currency === null ? "currency unspecified" : criteria.salary.currency;
    parts.push(
      `salary: ${currency} ${amount} per ${criteria.salary.period}; undisclosed: ${criteria.salary.unknownPolicy}`,
    );
  }
  if (criteria.postedWithinDays !== null) {
    parts.push(`posted within ${String(criteria.postedWithinDays)} days`);
  }
  parts.push(`sort: ${humanize(criteria.sort)}`, `up to ${String(criteria.limit)} matches`);
  if (criteria.unresolvedAssumptions.length > 0) {
    parts.push(`assumptions: ${criteria.unresolvedAssumptions.join(", ")}`);
  }
  return parts.join(" · ");
}

function describeRecurrence(recurrence: RequestSearchAlertResult["review"]["recurrence"]): string {
  if (recurrence.frequency === "daily") {
    return `Daily at ${recurrence.time} (${recurrence.timeZone})`;
  }
  return `Weekly on ${naturalList(recurrence.days.map(humanize))} at ${recurrence.time} (${recurrence.timeZone})`;
}

function searchAlertReviewResult(
  result: RequestSearchAlertResult,
  maximumBytes = MAX_WEBMCP_RESULT_BYTES,
): RequiresUserActionWebMcpResult {
  const verificationRequired = result.review.deliveryVerification.required;
  return requiresUserActionWebMcpResult({
    summary: "Review this exact job alert in the agent client.",
    kind: "data_consent",
    surface: "search_alert_consent",
    requestId: result.requestId,
    nextTool: "decide_search_alert",
    decisionContext: {
      reviewToken: result.reviewToken,
      verificationMode: verificationRequired ? "email_code" : "existing_verified_email",
    },
    presentation: {
      title: "Review this job alert",
      prompt: verificationRequired
        ? "Confirm the exact alert and enter the 6-digit code sent to the reviewed email."
        : "Confirm the exact search, schedule, masked destination, data use, retention, and withdrawal.",
      confirmLabel: verificationRequired ? "Verify and turn on" : "Turn on alert",
      facts: [
        { key: "Search", value: describeSearchCriteria(result.review.criteria) },
        { key: "Delivery", value: result.review.maskedDestination },
        {
          key: "Email check",
          value: verificationRequired ? "6-digit code required" : "Already verified — no new code",
        },
        { key: "Schedule", value: describeRecurrence(result.review.recurrence) },
        { key: "Purpose", value: result.review.purpose },
        {
          key: "Data",
          value: result.review.dataCategories
            .map((category, index) =>
              index === 0 ? humanize(category) : category.replaceAll("_", " "),
            )
            .join(" and "),
        },
        { key: "Retention", value: result.review.retention },
        { key: "Withdrawal", value: result.review.withdrawal },
      ],
    },
    maximumBytes,
  });
}

function assertPresentableSearchAlertReview(
  criteria: RequestSearchAlertResult["review"]["criteria"],
  recurrence: RequestSearchAlertResult["review"]["recurrence"],
  email: string,
): void {
  const maximumEntityId = `${"r".repeat(31)}_00000000-0000-7000-8000-000000000000`;
  const preview = searchAlertReviewResult(
    {
      status: "requires_user_action",
      requestId: maximumEntityId,
      reviewToken: `r1.${"z".repeat(13)}.${"x".repeat(43)}`,
      expiresAt: "2026-08-30T09:15:00.000+00:00",
      review: {
        savedSearchId: maximumEntityId,
        savedSearchVersion: Number.MAX_SAFE_INTEGER,
        maskedDestination: maskEmailAddress(email),
        deliveryVerification: { required: true, method: "email_code" },
        criteria,
        recurrence,
        firstRunAt: "2026-08-31T09:15:00.000+00:00",
        purpose: searchAlertReviewPolicy.purpose,
        dataCategories: [...searchAlertReviewPolicy.dataCategories],
        retention: searchAlertReviewPolicy.retention,
        withdrawal: searchAlertReviewPolicy.withdrawal,
        privacyNoticeVersion: searchAlertReviewPolicy.privacyNoticeVersion,
      },
    },
    Number.MAX_SAFE_INTEGER,
  );
  if (webMcpResultSize(preview) <= MAX_WEBMCP_RESULT_BYTES) return;
  throw new z.ZodError([
    {
      code: "custom",
      path: ["criteria"],
      message:
        "The exact consent review is too long for one safe agent response. Narrow this alert or split it into simpler alerts.",
    },
  ]);
}

export function createSavedToolManifests(
  dependencies: SavedToolDependencies,
): readonly ToolManifest<unknown, SavedToolOutput>[] {
  const getSavedAlerts: ToolManifest<unknown, SavedToolOutput> = {
    name: "get_saved_alerts",
    purpose: "List saved searches and their optional update schedules.",
    description:
      "Read up to six saved searches in this private workspace, including any optional email-update schedule and next check. Email destinations and credentials are never returned.",
    inputSchema: emptyInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        emptyInput.parse(input);
        const [savedSearches, schedules] = await Promise.all([
          dependencies.listSavedSearches({ signal }),
          dependencies.listSchedules({ signal }),
        ]);
        const scheduleBySearch = new Map(
          schedules.map((schedule) => [schedule.savedSearchId, schedule]),
        );
        const alerts = savedSearches.slice(0, 6).map((savedSearch) => {
          const schedule = scheduleBySearch.get(savedSearch.id);
          return {
            savedSearchId: savedSearch.id,
            name: short(savedSearch.name, 64),
            scheduleId: schedule?.id ?? null,
            enabled: schedule?.enabled ?? false,
            nextRunAt: schedule?.nextRunAt ?? null,
            frequency: schedule?.recurrence.frequency ?? null,
          };
        });
        return completedWebMcpResult({
          summary: `Read ${String(savedSearches.length)} saved job search${savedSearches.length === 1 ? "" : "es"}; ${String(schedules.filter(({ enabled }) => enabled).length)} alert${schedules.filter(({ enabled }) => enabled).length === 1 ? " is" : "s are"} active.`,
          data: { alerts, truncated: savedSearches.length > alerts.length },
          facts: [
            { key: "saved_searches", value: savedSearches.length },
            { key: "active_alerts", value: schedules.filter(({ enabled }) => enabled).length },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(error, signal, "Saved alert state accepts no arguments.");
      }
    },
  };

  const requestSearchAlert: ToolManifest<unknown, SavedToolOutput> = {
    name: "request_search_alert",
    purpose: "Prepare one email job alert for an explicit decision in the external agent client.",
    description:
      "Prepare an exact review for one saved search, schedule, and email destination. Copy only criteria explicitly supplied in this request or returned by get_search_state(detail=exact). Never add filters such as salary, category, or exclusions by inference or from another task. A new destination receives a 6-digit mailbox code; an already verified destination does not. No alert becomes active until the person's explicit decision through decide_search_alert.",
    inputSchema: requestAlertInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = requestAlertInput.parse(input);
        const criteria = normalizeJobSearchCriteria(parsed.criteria);
        assertPresentableSearchAlertReview(criteria, parsed.recurrence, parsed.email);
        const result = await dependencies.requestSearchAlert(
          {
            name: parsed.name,
            criteria,
            recurrence: parsed.recurrence,
            delivery: { channel: "email", email: parsed.email },
          },
          { signal },
        );
        return searchAlertReviewResult(result);
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide a name, raw search criteria, recurrence, and delivery email.",
        );
      }
    },
  };

  const decideSearchAlert: ToolManifest<unknown, SavedToolOutput> = {
    name: "decide_search_alert",
    purpose: "Record the person's exact alert decision from the external agent client.",
    description:
      "Continue the exact request from request_search_alert. Approval always requires the person's explicit decision. Include the 6-digit code only when that review says email verification is required; omit it for an already verified destination. Decline requires no code. Never infer approval or invent a code. This activates only the unchanged reviewed alert.",
    inputSchema: decisionInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = decisionInput.parse(input);
        const result = decideSearchAlertResultSchema.parse(
          await dependencies.decideSearchAlert({ ...parsed, channel: "agent_client" }, { signal }),
        );
        return completedWebMcpResult({
          summary: result.summary,
          data: {
            requestId: result.requestId,
            decision: result.decision,
            savedSearchId: result.savedSearchId,
            scheduleId: result.scheduleId,
            nextRunAt: result.nextRunAt,
            decidedAt: result.decidedAt,
          },
          resources: [
            { type: "saved_search", id: result.savedSearchId, label: "Saved job search" },
            ...(result.scheduleId === null
              ? []
              : [{ type: "job_alert", id: result.scheduleId, label: "Active job alert" }]),
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide the exact review request and the person's approval, adding a code only when requested, or decline.",
        );
      }
    },
  };

  const setJobAlertState: ToolManifest<unknown, SavedToolOutput> = {
    name: "set_job_alert_state",
    purpose: "Pause, resume, or permanently delete one saved job search in this workspace.",
    description:
      "Use action=pause or action=resume with the exact schedule ID returned as scheduleId by get_saved_alerts. Use action=delete only after the person explicitly asks to permanently delete one exact saved search; pass its savedSearchId and the literal confirmation DELETE_SAVED_SEARCH_AND_ALERT. 'Stop', 'turn off', or 'not now' means pause, never delete. If several alerts could match, ask which one.",
    inputSchema: stateInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = stateInput.parse(input);
        if (parsed.action === "delete") {
          const savedSearches = await dependencies.listSavedSearches({ signal });
          if (!savedSearches.some(({ id }) => id === parsed.savedSearchId)) {
            throw new z.ZodError([
              {
                code: "custom",
                path: ["savedSearchId"],
                message: "The saved search is not in the current private workspace.",
              },
            ]);
          }
          const receipt = savedSearchDeletionReceiptSchema.parse(
            await dependencies.deleteSavedSearch(
              parsed.savedSearchId,
              { confirmation: parsed.confirmation },
              { signal },
            ),
          );
          await dependencies.onSavedSearchDeleted(receipt);
          return completedWebMcpResult({
            summary:
              receipt.scheduleId === null
                ? "Deleted this saved search."
                : "Deleted this saved search and stopped its job alert.",
            data: receipt,
            resources: [
              { type: "saved_search", id: receipt.savedSearchId, label: "Deleted saved search" },
            ],
            facts: [{ key: "deleted", value: true }],
          });
        }
        const schedules = await dependencies.listSchedules({ signal });
        const current = schedules.find(({ id }) => id === parsed.scheduleId);
        if (current === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["scheduleId"],
              message: "The schedule is not in the current private workspace.",
            },
          ]);
        }
        const enabled = parsed.action === "resume";
        const updated =
          current.enabled === enabled
            ? current
            : await dependencies.setScheduleEnabled(
                current.id,
                { expectedVersion: current.version, enabled },
                { signal },
              );
        await dependencies.onScheduleCommitted(updated);
        return completedWebMcpResult({
          summary: updated.enabled
            ? "Resumed this job alert and updated the visible workspace."
            : "Paused this job alert and updated the visible workspace.",
          data: {
            scheduleId: updated.id,
            savedSearchId: updated.savedSearchId,
            enabled: updated.enabled,
            nextRunAt: updated.nextRunAt,
            version: updated.version,
          },
          resources: [{ type: "job_alert", id: updated.id, label: "Saved job alert" }],
          facts: [{ key: "enabled", value: updated.enabled }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Use action=pause or action=resume with a scheduleId from get_saved_alerts. Permanent deletion requires action=delete, a savedSearchId, and the exact confirmation literal.",
        );
      }
    },
  };

  const openSavedSearch: ToolManifest<unknown, SavedToolOutput> = {
    name: "open_saved_search",
    purpose: "Open one saved search on the results page with its exact stored criteria.",
    description:
      "Navigate to the search page with the exact criteria of a saved search returned by get_saved_alerts. The search tools then apply to that restored search.",
    inputSchema: openSavedInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = openSavedInput.parse(input);
        const savedSearches = await dependencies.listSavedSearches({ signal });
        const savedSearch = savedSearches.find(({ id }) => id === parsed.savedSearchId);
        if (savedSearch === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["savedSearchId"],
              message: "The saved search is not in the current private workspace.",
            },
          ]);
        }
        await dependencies.onNavigate(dependencies.savedSearchHref(savedSearch), { signal });
        return completedWebMcpResult({
          summary: "Opened the saved search on the results page with its stored criteria.",
          data: { savedSearchId: savedSearch.id, route: "/" },
          resources: [
            { type: "saved_search", id: savedSearch.id, label: short(savedSearch.name, 64) },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one saved search ID from get_saved_alerts.",
        );
      }
    },
  };

  const getLatestSearchUpdate: ToolManifest<unknown, SavedToolOutput> = {
    name: "get_latest_search_update",
    purpose: "Read what changed since a saved search was last checked, not the full result list.",
    description:
      "Read the most recent server-side check of one saved search: counts of new, updated, closed, and no-longer-matching roles, plus up to five change references. Monitoring runs without an open tab.",
    inputSchema: latestUpdateInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = openSavedInput.parse(input);
        const savedSearches = await dependencies.listSavedSearches({ signal });
        const savedSearch = savedSearches.find(({ id }) => id === parsed.savedSearchId);
        if (savedSearch === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["savedSearchId"],
              message: "The saved search is not in the current private workspace.",
            },
          ]);
        }
        const run = await dependencies.getLatestRun(savedSearch.id, { signal });
        if (run.evaluation === null) {
          return completedWebMcpResult({
            summary:
              "This saved search has not been checked yet. The next scheduled run will establish its baseline.",
            data: { savedSearchId: savedSearch.id, checked: false },
          });
        }
        const counts = { new: 0, updated: 0, closed: 0, no_longer_matching: 0 };
        for (const item of run.evaluation.changes.items) counts[item.kind] += 1;
        const parts = [
          counts.new > 0 ? `${String(counts.new)} new` : null,
          counts.updated > 0 ? `${String(counts.updated)} updated` : null,
          counts.closed > 0 ? `${String(counts.closed)} closed` : null,
          counts.no_longer_matching > 0
            ? `${String(counts.no_longer_matching)} no longer matching`
            : null,
        ].filter((part): part is string => part !== null);
        return completedWebMcpResult({
          summary:
            parts.length === 0
              ? "No meaningful changes since the last check."
              : `Since the last check: ${parts.join(", ")}.`,
          data: {
            savedSearchId: savedSearch.id,
            checked: true,
            checkedAt: run.evaluation.createdAt,
            baselineCount: run.evaluation.baselineCount,
            counts,
            truncated: run.evaluation.changes.truncated,
            changes: run.evaluation.changes.items
              .slice(0, 5)
              .map(({ jobId, kind }) => ({ jobId, kind })),
            deliveryStatus: run.delivery?.status ?? null,
          },
          facts: [{ key: "changes_total", value: run.evaluation.changes.total }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide one saved search ID from get_saved_alerts.",
        );
      }
    },
  };

  const saveJobSearch: ToolManifest<unknown, SavedToolOutput> = {
    name: "save_job_search",
    purpose: "Save one reusable job search without turning on email updates.",
    description:
      "Use when the person says save, remember, or bookmark this search. Save only criteria explicitly supplied in this request or returned by get_search_state(detail=exact). Do not ask for an email: email updates remain off. If the person explicitly asks for notifications, monitoring, or emailed updates, use request_search_alert instead.",
    inputSchema: saveSearchInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = saveSearchInput.parse(input);
        const savedSearch = await dependencies.saveSearch(
          {
            name: parsed.name,
            criteria: normalizeJobSearchCriteria(parsed.criteria),
          },
          { signal },
        );
        await dependencies.onSavedSearchCommitted(savedSearch);
        return completedWebMcpResult({
          summary: "Saved this job search. Email updates are off.",
          data: {
            savedSearchId: savedSearch.id,
            name: short(savedSearch.name, 100),
            emailUpdates: false,
          },
          resources: [
            { type: "saved_search", id: savedSearch.id, label: short(savedSearch.name, 64) },
          ],
          facts: [{ key: "email_updates", value: false }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Provide a short name and the exact search criteria to save. Email is not needed.",
        );
      }
    },
  };

  return [
    getSavedAlerts,
    requestSearchAlert,
    decideSearchAlert,
    setJobAlertState,
    openSavedSearch,
    getLatestSearchUpdate,
    saveJobSearch,
  ];
}
