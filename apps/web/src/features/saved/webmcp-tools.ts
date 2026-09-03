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

const deletionConfirmation = "DELETE_SAVED_SEARCH_AND_ALERT" as const;
const savedAlertsPageSize = 6;
const savedAlertsInputSchema = {
  type: "object",
  additionalProperties: false,
  properties: {
    limit: {
      type: "integer",
      description: "How many saved searches to return, from 1 to 6. If omitted, return 6.",
      minimum: 1,
      maximum: savedAlertsPageSize,
      default: savedAlertsPageSize,
    },
    offset: {
      type: "integer",
      description:
        "How many saved searches to skip, starting with the newest. If omitted, skip none.",
      minimum: 0,
      default: 0,
    },
  },
} as const satisfies JsonSchema;
const savedAlertsInput = z.strictObject({
  limit: z.number().int().min(1).max(savedAlertsPageSize).default(savedAlertsPageSize),
  offset: z.number().int().nonnegative().default(0),
});

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
            ? "Pause email updates. Keep the saved search."
            : "Turn email updates back on for this paused alert.",
      },
      scheduleId: {
        type: "string",
        description: "The scheduleId returned by get_saved_alerts for this alert.",
        pattern: "^schedule_[0-9a-f-]{36}$",
      },
      savedSearchId: {
        type: "string",
        description:
          "Alternatively, the savedSearchId returned by save_job_search or decide_search_alert; its alert is resolved for you.",
        pattern: "^saved_[0-9a-f-]{36}$",
      },
    },
    required: ["action"],
    anyOf: [{ required: ["scheduleId"] }, { required: ["savedSearchId"] }],
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
          description: "Permanently delete one saved search and stop its email updates, if any.",
        },
        savedSearchId: {
          type: "string",
          description: "The savedSearchId returned by get_saved_alerts for this search.",
          pattern: "^saved_[0-9a-f-]{36}$",
        },
        confirmation: {
          type: "string",
          enum: [deletionConfirmation],
          description:
            "Use only after the person clearly asks to permanently delete this saved search and its email updates.",
        },
      },
      required: ["action", "savedSearchId", "confirmation"],
    },
  ],
} as const satisfies JsonSchema;

const scheduleTarget = {
  scheduleId: entityIdSchema.optional(),
  savedSearchId: entityIdSchema.optional(),
};
const hasOneTarget = (value: {
  scheduleId?: string | undefined;
  savedSearchId?: string | undefined;
}) => value.scheduleId !== undefined || value.savedSearchId !== undefined;
const oneTargetMessage = {
  path: ["scheduleId"],
  message: "Pass the scheduleId from get_saved_alerts or the savedSearchId of the search.",
};
const stateInput = z.discriminatedUnion("action", [
  z
    .strictObject({ action: z.literal("pause"), ...scheduleTarget })
    .refine(hasOneTarget, oneTargetMessage),
  z
    .strictObject({ action: z.literal("resume"), ...scheduleTarget })
    .refine(hasOneTarget, oneTargetMessage),
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
          description:
            "Time on the person's clock, written in 24-hour HH:mm form, for example 09:30.",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        },
        timeZone: {
          type: "string",
          description: "Time zone name, for example Europe/Kyiv.",
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
          description:
            "Time on the person's clock, written in 24-hour HH:mm form, for example 09:30.",
          pattern: "^([01]\\d|2[0-3]):[0-5]\\d$",
        },
        timeZone: {
          type: "string",
          description: "Time zone name, for example Europe/Kyiv.",
          maxLength: 120,
        },
        days: {
          type: "array",
          description: "Days of the week to check. List each day only once.",
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
      description: "A short name the person will recognize for these email updates.",
      minLength: 1,
      maxLength: 100,
    },
    criteria: {
      ...jobSearchToolInputJsonSchema,
      description: "Search choices from search_jobs or the exact choices from get_search_state.",
    },
    recurrence: recurrenceInputSchema,
    email: {
      type: "string",
      description: "Email address the person gave for job updates.",
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
      description: "A short name the person will recognize for this saved search.",
      minLength: 1,
      maxLength: 100,
    },
    criteria: {
      ...jobSearchToolInputJsonSchema,
      description: "Search choices from search_jobs or the exact choices from get_search_state.",
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
          description: "Copy the requestId returned by request_search_alert.",
          pattern: "^[a-z][a-z0-9_]*_[0-9a-f-]{36}$",
        },
        reviewToken: {
          type: "string",
          description: "Copy the reviewToken returned by request_search_alert exactly as given.",
          maxLength: 4_096,
        },
        decision: { type: "string", enum: ["approved"] },
        code: {
          type: "string",
          description:
            "The 6-digit code sent to the person's email. Include it only when request_search_alert asks for it; otherwise leave it out.",
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
          description: "Copy the requestId returned by request_search_alert.",
          pattern: "^[a-z][a-z0-9_]*_[0-9a-f-]{36}$",
        },
        reviewToken: {
          type: "string",
          description: "Copy the reviewToken returned by request_search_alert exactly as given.",
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
      description: "The savedSearchId returned by get_saved_alerts for this search.",
      pattern: "^saved_[0-9a-f-]{36}$",
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
      description: "The savedSearchId returned by get_saved_alerts for this search.",
      pattern: "^saved_[0-9a-f-]{36}$",
    },
    limit: {
      type: "integer",
      description: "How many changed jobs to return, from 1 to 5. If omitted, return 5.",
      minimum: 1,
      maximum: 5,
      default: 5,
    },
    offset: {
      type: "integer",
      description: "How many changed jobs to skip. If omitted, skip none.",
      minimum: 0,
      default: 0,
    },
  },
  required: ["savedSearchId"],
} as const satisfies JsonSchema;
const latestUpdateInput = z.strictObject({
  savedSearchId: entityIdSchema,
  limit: z.number().int().min(1).max(5).default(5),
  offset: z.number().int().nonnegative().default(0),
});

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
  const cityOrRemote = criteria.remoteOrLocations === true && criteria.locations.length > 0;
  if (criteria.query !== null) parts.push(`“${criteria.query}”`);
  if (criteria.categories.length > 0) {
    parts.push(`categories: ${criteria.categories.map(humanize).join(", ")}`);
  }
  const localWorkModels = cityOrRemote
    ? criteria.workModels.filter((value) => value !== "remote")
    : criteria.workModels;
  const includesEveryLocalModel = ["flexible", "hybrid", "onsite"].every((value) =>
    localWorkModels.includes(value as (typeof localWorkModels)[number]),
  );
  if (localWorkModels.length > 0 && !(cityOrRemote && includesEveryLocalModel)) {
    parts.push(`work model: ${criteria.workModels.map(humanize).join(", ")}`);
  }
  if (criteria.seniorities.length > 0) {
    parts.push(`seniority: ${criteria.seniorities.map(humanize).join(", ")}`);
  }
  if (criteria.locations.length > 0) {
    parts.push(`location: ${criteria.locations.join(", ")}${cityOrRemote ? " or remote" : ""}`);
  }
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
    summary: "This job alert is ready for the person's review.",
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
        ? "Check the search, email address, and timing. Then enter the 6-digit code sent to that email."
        : "Check the search, email address, timing, how the information is used, how long it is kept, and how to stop the emails.",
      confirmLabel: verificationRequired ? "Verify and turn on" : "Turn on alert",
      declineLabel: "Not now",
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
          value: "Your job search choices and email address.",
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
      message: "This review is too long to show safely. Use fewer filters or make separate alerts.",
    },
  ]);
}

export function createSavedToolManifests(
  dependencies: SavedToolDependencies,
): readonly ToolManifest<unknown, SavedToolOutput>[] {
  const getSavedAlerts: ToolManifest<unknown, SavedToolOutput> = {
    name: "get_saved_alerts",
    purpose: "Show saved job searches and whether email updates are on.",
    description:
      "Use optional limit and offset with the current private owner to list saved searches newest first, returning each saved-search ID, email-update state, next check, and nextOffset without exposing an email address or sign-in information.",
    inputSchema: savedAlertsInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const { limit, offset } = savedAlertsInput.parse(input);
        const [savedSearches, schedules] = await Promise.all([
          dependencies.listSavedSearches({ signal }),
          dependencies.listSchedules({ signal }),
        ]);
        const scheduleBySearch = new Map(
          schedules.map((schedule) => [schedule.savedSearchId, schedule]),
        );
        const page = savedSearches.slice(offset, offset + limit);
        const alerts = page.map((savedSearch) => {
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
        const nextOffset =
          offset + alerts.length < savedSearches.length ? offset + alerts.length : null;
        const activeEmailUpdates = schedules.filter(({ enabled }) => enabled).length;
        return completedWebMcpResult({
          summary: `Found ${String(savedSearches.length)} saved job search${savedSearches.length === 1 ? "" : "es"}. ${String(activeEmailUpdates)} ${activeEmailUpdates === 1 ? "has" : "have"} email updates turned on.`,
          data: {
            total: savedSearches.length,
            returned: alerts.length,
            nextOffset,
            alerts,
            truncated: nextOffset !== null,
          },
          facts: [
            { key: "saved_searches", value: savedSearches.length },
            { key: "active_alerts", value: schedules.filter(({ enabled }) => enabled).length },
          ],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "If needed, ask for 1 to 6 searches and say how many newer searches to skip.",
        );
      }
    },
  };

  const requestSearchAlert: ToolManifest<unknown, SavedToolOutput> = {
    name: "request_search_alert",
    purpose:
      "Prepare Jobbbler-managed email updates for one search; use this instead of a client timer.",
    description:
      "When the person asks Jobbbler to keep checking a search or email changes, ask in the agent client for any missing name, schedule, time zone, or email, then use the exact supplied values to return one review for approve or decline with decide_search_alert. This is server-side monitoring that continues after the browser closes; do not substitute client automation. Require a six-digit code only for a new email.",
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
          "Provide a name, the exact search choices, when to check, and the email address for updates.",
        );
      }
    },
  };

  const decideSearchAlert: ToolManifest<unknown, SavedToolOutput> = {
    name: "decide_search_alert",
    purpose: "Use the person's answer to turn the reviewed email updates on or leave them off.",
    description:
      "Use the exact requestId and reviewToken from request_search_alert, the person's explicit approved or declined decision, and a six-digit code only when requested to return the decision and turn on only the unchanged reviewed updates.",
    inputSchema: decisionInputSchema,
    annotations: { readOnlyHint: false, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = decisionInput.parse(input);
        const result = decideSearchAlertResultSchema.parse(
          await dependencies.decideSearchAlert({ ...parsed, channel: "agent_client" }, { signal }),
        );
        return completedWebMcpResult({
          summary:
            result.decision === "approved"
              ? "Email updates are on for this job search."
              : "Email updates were not turned on.",
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
          "Use the requestId and reviewToken from request_search_alert. Say whether the person approved or declined. Add the code only when asked.",
        );
      }
    },
  };

  const setJobAlertState: ToolManifest<unknown, SavedToolOutput> = {
    name: "set_job_alert_state",
    purpose: "Pause, resume, or permanently delete one saved job search and its email updates.",
    description:
      "Pause or resume email updates with the scheduleId from get_saved_alerts or the savedSearchId of the search; delete permanently only with the exact savedSearchId and confirmation after the person clearly requests it, and return the resulting state or deletion receipt; an ambiguous stop request means pause, and more than one possible match requires a question.",
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
                message: "This saved search was not found.",
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
        // An agent usually holds the savedSearchId it just saved, not the schedule's id.
        const current =
          parsed.scheduleId !== undefined
            ? schedules.find(({ id }) => id === parsed.scheduleId)
            : schedules.find(({ savedSearchId }) => savedSearchId === parsed.savedSearchId);
        if (current === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: [parsed.scheduleId !== undefined ? "scheduleId" : "savedSearchId"],
              message:
                parsed.scheduleId !== undefined
                  ? "This job alert was not found."
                  : "This saved search has no email updates yet; request_search_alert turns them on.",
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
            ? "Email updates for this job search are on again."
            : "Email updates for this job search are paused.",
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
          "To pause or resume, use the scheduleId from get_saved_alerts. To delete permanently, use the savedSearchId and confirmation DELETE_SAVED_SEARCH_AND_ALERT.",
        );
      }
    },
  };

  const openSavedSearch: ToolManifest<unknown, SavedToolOutput> = {
    name: "open_saved_search",
    purpose: "Open one saved search and show its saved choices on the results page.",
    description:
      "Use a savedSearchId from get_saved_alerts to open its exact choices on the results page and return the opened route and saved-search ID without changing the criteria.",
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
              message: "This saved search was not found.",
            },
          ]);
        }
        await dependencies.onNavigate(dependencies.savedSearchHref(savedSearch), { signal });
        return completedWebMcpResult({
          summary: "Opened this saved search on the results page.",
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
    purpose: "Show what changed the last time a saved job search was checked.",
    description:
      "Use a savedSearchId plus optional limit and offset to return counts and a paged list of job IDs that are new, updated, closed, or no longer match since the latest check, including nextOffset when more changes remain.",
    inputSchema: latestUpdateInputSchema,
    annotations: { readOnlyHint: true, untrustedContentHint: true },
    async execute(input, { signal }) {
      try {
        const parsed = latestUpdateInput.parse(input);
        const savedSearches = await dependencies.listSavedSearches({ signal });
        const savedSearch = savedSearches.find(({ id }) => id === parsed.savedSearchId);
        if (savedSearch === undefined) {
          throw new z.ZodError([
            {
              code: "custom",
              path: ["savedSearchId"],
              message: "This saved search was not found.",
            },
          ]);
        }
        const run = await dependencies.getLatestRun(savedSearch.id, { signal });
        if (run.evaluation === null) {
          return completedWebMcpResult({
            summary:
              "This saved search has not been checked yet. Its first check will make the starting list.",
            data: { savedSearchId: savedSearch.id, checked: false },
          });
        }
        const counts = { new: 0, updated: 0, closed: 0, no_longer_matching: 0 };
        for (const item of run.evaluation.changes.items) counts[item.kind] += 1;
        const changePage = run.evaluation.changes.items.slice(
          parsed.offset,
          parsed.offset + parsed.limit,
        );
        const nextOffset =
          parsed.offset + changePage.length < run.evaluation.changes.items.length
            ? parsed.offset + changePage.length
            : null;
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
              ? "No jobs changed since the last check."
              : `Since the last check: ${parts.join(", ")}.`,
          data: {
            savedSearchId: savedSearch.id,
            checked: true,
            checkedAt: run.evaluation.createdAt,
            baselineCount: run.evaluation.baselineCount,
            counts,
            total: run.evaluation.changes.total,
            returned: changePage.length,
            nextOffset,
            truncated: nextOffset !== null || run.evaluation.changes.truncated,
            sourceTruncated: run.evaluation.changes.truncated,
            changes: changePage.map(({ jobId, kind }) => ({ jobId, kind })),
            deliveryStatus: run.delivery?.status ?? null,
          },
          facts: [{ key: "changes_total", value: run.evaluation.changes.total }],
        });
      } catch (error) {
        return safeWebMcpErrorResult(
          error,
          signal,
          "Use a savedSearchId from get_saved_alerts. If needed, ask for 1 to 5 changed jobs and say how many to skip.",
        );
      }
    },
  };

  const saveJobSearch: ToolManifest<unknown, SavedToolOutput> = {
    name: "save_job_search",
    purpose: "Save one job search without turning on email updates.",
    description:
      "Use a short name and exact choices the person supplied or get_search_state(detail=exact) to save and return a saved-search ID with email updates off; ask for missing values, and use request_search_alert instead when the person wants notifications.",
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
          "Provide a short name and the exact search choices to save. No email address is needed.",
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
