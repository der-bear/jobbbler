import { createHmac } from "node:crypto";

import {
  decideSearchAlertResultSchema,
  entityIdSchema,
  isoInstantSchema,
  jobSearchCriteriaSchema,
  scheduleRecurrenceSchema,
  type JobSearchCriteria,
  type ScheduleRecurrence,
} from "@jobbbler/contracts";
import { z } from "zod";

type RuntimeEnvironment = Readonly<Record<string, string | undefined>>;

const SECRET_MINIMUM_LENGTH = 32;
const LOCAL_BINDING_SECRET = "jobbbler-local-search-alert-binding-change-before-production";
const REQUEST_BINDING_DOMAIN = "jobbbler:search-alert-request-binding:v1";
const REVIEW_BINDING_DOMAIN = "jobbbler:search-alert-review-binding:v1";

function bindingSecret(environment: RuntimeEnvironment): string {
  const configured = environment["TOKEN_HASH_SECRET"];
  if (configured !== undefined && configured.length >= SECRET_MINIMUM_LENGTH) return configured;
  if (environment["NODE_ENV"] !== "production") return LOCAL_BINDING_SECRET;
  throw new Error(
    `TOKEN_HASH_SECRET must contain at least ${String(SECRET_MINIMUM_LENGTH)} characters.`,
  );
}

export interface SearchAlertRequestPolicy {
  readonly name: string;
  readonly criteria: JobSearchCriteria;
  readonly recurrence: ScheduleRecurrence;
  readonly delivery: { readonly channel: "email" };
}

export function createSearchAlertRequestBinding(
  environment: RuntimeEnvironment,
  policy: SearchAlertRequestPolicy,
  keyedAddressId: string,
): string {
  return createHmac("sha256", bindingSecret(environment))
    .update(REQUEST_BINDING_DOMAIN)
    .update("\u0000")
    .update(JSON.stringify({ policy, keyedAddressId }))
    .digest("hex");
}

export function createSearchAlertReviewBinding(
  environment: RuntimeEnvironment,
  review: unknown,
  decision: "approved" | "declined" | "review",
): string {
  return createHmac("sha256", bindingSecret(environment))
    .update(REVIEW_BINDING_DOMAIN)
    .update("\u0000")
    .update(JSON.stringify({ review, decision }))
    .digest("hex");
}

export const searchAlertRequestSagaSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal("preparing"),
  ownerId: entityIdSchema,
  requestId: entityIdSchema,
  savedSearchId: entityIdSchema,
  endpointId: entityIdSchema,
  challengeId: entityIdSchema,
  scheduleId: entityIdSchema,
  issuedAt: isoInstantSchema,
});

export type SearchAlertRequestSaga = z.infer<typeof searchAlertRequestSagaSchema>;

export const searchAlertDecisionIntentSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal("deciding"),
  requestId: entityIdSchema,
  reviewBinding: z.string().regex(/^[a-f0-9]{64}$/u),
  decision: z.enum(["approved", "declined"]),
  recordedAt: isoInstantSchema,
});

export type SearchAlertDecisionIntent = z.infer<typeof searchAlertDecisionIntentSchema>;

export const searchAlertConsentEvidenceSchema = z.strictObject({
  reviewBinding: z.string().regex(/^[a-f0-9]{64}$/u),
  purpose: z.string().trim().min(1).max(240),
  dataCategories: z.tuple([z.literal("saved_search_criteria"), z.literal("delivery_email")]),
  retention: z.string().trim().min(1).max(240),
  withdrawal: z.string().trim().min(1).max(240),
  criteria: jobSearchCriteriaSchema,
  savedSearchId: entityIdSchema,
  savedSearchVersion: z.number().int().nonnegative(),
  endpointId: entityIdSchema,
  recurrence: scheduleRecurrenceSchema,
  firstRunAt: isoInstantSchema,
  privacyNoticeVersion: z.string().trim().min(1).max(40),
  channel: z.literal("agent_client"),
  decidedAt: isoInstantSchema,
});

export const searchAlertDecisionEnvelopeSchema = z.strictObject({
  version: z.literal(1),
  status: z.literal("completed"),
  receipt: decideSearchAlertResultSchema,
  evidence: searchAlertConsentEvidenceSchema,
});

export type SearchAlertDecisionEnvelope = z.infer<typeof searchAlertDecisionEnvelopeSchema>;
