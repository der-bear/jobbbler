import { z } from "zod";

import { entityIdSchema, isoInstantSchema } from "./common.js";

export const applicationStateSchema = z.enum([
  "draft",
  "valid",
  "reviewed",
  "awaiting_confirmation",
  "submitting",
  "submitted",
  "handed_off",
  "withdrawn",
  "failed",
]);

export const answerProvenanceSchema = z.enum([
  "candidate_fact",
  "imported_fact",
  "user_entered",
  "agent_suggestion",
  "unknown",
]);

export const applicationAnswerValueSchema = z.union([
  z.string().max(10_000),
  z.number().finite(),
  z.boolean(),
  z.array(z.string().max(500)).max(50),
  z.null(),
]);

export const applicationAnswerSchema = z.strictObject({
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  value: applicationAnswerValueSchema,
  provenance: answerProvenanceSchema,
  sensitive: z.boolean(),
  acceptedByHuman: z.boolean(),
});

export const applicationDraftSchema = z.strictObject({
  id: entityIdSchema,
  ownerId: entityIdSchema,
  jobId: entityIdSchema,
  state: applicationStateSchema,
  version: z.number().int().nonnegative(),
  answers: z.array(applicationAnswerSchema),
  createdAt: isoInstantSchema,
  updatedAt: isoInstantSchema,
});

export const agentOperationSchema = z.enum([
  "read_application",
  "edit_application",
  "validate_application",
  "review_application",
  "request_data_consent",
  "request_confirmation",
  "submit_application",
]);

export const requestAgentDelegationSchema = z.strictObject({
  agentSessionId: entityIdSchema,
  draftId: entityIdSchema,
  operations: z.array(agentOperationSchema).min(1).max(7),
  purpose: z.string().trim().min(1).max(240),
  requestedTtlSeconds: z.number().int().min(60).max(3_600),
});

export const dataCategorySchema = z.enum([
  "identity",
  "contact",
  "work_history",
  "education",
  "skills",
  "compensation",
  "work_authorization",
  "demographics",
  "documents",
  "application_answers",
]);

export const legalBasisSchema = z.enum([
  "consent",
  "contract",
  "legitimate_interest",
  "legal_obligation",
  "user_instruction",
]);

export const applicationFieldInputSchema = z.enum([
  "text",
  "email",
  "url",
  "textarea",
  "select",
]);

export const applicationFieldDefinitionSchema = z.strictObject({
  fieldKey: z.string().regex(/^[a-z][a-z0-9_]{0,63}$/),
  label: z.string().trim().min(1).max(80),
  description: z.string().trim().min(1).max(240),
  input: applicationFieldInputSchema,
  required: z.boolean(),
  sensitive: z.boolean(),
  category: dataCategorySchema,
  options: z.array(z.string().trim().min(1).max(100)).max(20),
});

export const applicationReviewSummarySchema = z.strictObject({
  id: entityIdSchema,
  draftId: entityIdSchema,
  draftVersion: z.number().int().nonnegative(),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  status: z.enum(["active", "invalidated"]),
  createdAt: isoInstantSchema,
});

export const applicationDataGrantSummarySchema = z.strictObject({
  id: entityIdSchema,
  status: z.enum(["requested", "active", "withdrawn"]),
  expiresAt: isoInstantSchema,
});

export const applicationDelegationSummarySchema = z.strictObject({
  id: entityIdSchema,
  agentSessionId: entityIdSchema,
  operations: z.array(agentOperationSchema).min(1).max(7),
  purpose: z.string().trim().min(1).max(240),
  status: z.enum(["requested", "active", "revoked"]),
  expiresAt: isoInstantSchema,
  approvedAt: isoInstantSchema.nullable(),
});

export const applicationReceiptSummarySchema = z.strictObject({
  id: entityIdSchema,
  status: z.enum(["submitted", "handed_off"]),
  externalUrl: z.string().url().startsWith("https://").nullable(),
  createdAt: isoInstantSchema,
});

export const applicationWorkspaceSchema = z.strictObject({
  draft: applicationDraftSchema,
  requirements: z.array(applicationFieldDefinitionSchema).min(1).max(24),
  recipient: z.strictObject({
    id: entityIdSchema,
    name: z.string().trim().min(1).max(160),
  }),
  purpose: z.string().trim().min(1).max(240),
  noticeVersion: z.string().trim().min(1).max(40),
  legalBasis: legalBasisSchema,
  review: applicationReviewSummarySchema.nullable(),
  dataGrant: applicationDataGrantSummarySchema.nullable(),
  delegationRequests: z.array(applicationDelegationSummarySchema).max(20),
  receipt: applicationReceiptSummarySchema.nullable(),
});

export const startApplicationInputSchema = z.strictObject({
  jobId: entityIdSchema,
});

export const applicationConfirmationResultSchema = z.strictObject({
  confirmationId: entityIdSchema,
  expiresAt: isoInstantSchema,
});

export const applicationAgentSessionResultSchema = z.strictObject({
  sessionId: entityIdSchema,
  /** Returned once to the first-party page and kept only in its in-memory closure. */
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  expiresAt: isoInstantSchema,
});

export const applicationAgentStateSchema = z.strictObject({
  draftId: entityIdSchema,
  jobId: entityIdSchema,
  state: applicationStateSchema,
  stage: z.enum(["profile", "review", "permission", "confirmation", "complete"]),
  version: z.number().int().nonnegative(),
  requiredFields: z.number().int().nonnegative(),
  completedRequiredFields: z.number().int().nonnegative(),
  reviewStatus: z.enum(["none", "active", "invalidated"]),
  dataPermissionStatus: z.enum(["none", "requested", "active", "withdrawn"]),
  agentAuthorityStatus: z.enum(["none", "requested", "active", "revoked"]),
  finalConfirmationReady: z.boolean(),
  receiptStatus: z.enum(["none", "submitted", "handed_off"]),
});

export const requestDataGrantSchema = z.strictObject({
  draftId: entityIdSchema,
  recipientId: entityIdSchema,
  purpose: z.string().trim().min(1).max(240),
  categories: z.array(dataCategorySchema).min(1).max(10),
  fieldKeys: z.array(z.string().regex(/^[a-z][a-z0-9_]{0,63}$/)).max(100),
  documentIds: z.array(entityIdSchema).max(10),
  payloadHash: z.string().regex(/^[a-f0-9]{64}$/),
  noticeVersion: z.string().trim().min(1).max(40),
  legalBasis: legalBasisSchema,
});

export const setApplicationAnswerInputSchema = z.strictObject({
  draftId: entityIdSchema,
  expectedVersion: z.number().int().nonnegative(),
  answer: applicationAnswerSchema,
});

export const reviewApplicationInputSchema = z.strictObject({
  draftId: entityIdSchema,
  expectedVersion: z.number().int().nonnegative(),
});

export const submitApplicationInputSchema = z.strictObject({
  draftId: entityIdSchema,
  reviewId: entityIdSchema,
  confirmationId: entityIdSchema,
  idempotencyKey: z.string().uuid(),
});

export type ApplicationState = z.infer<typeof applicationStateSchema>;
export type ApplicationAnswer = z.infer<typeof applicationAnswerSchema>;
export type ApplicationDraft = z.infer<typeof applicationDraftSchema>;
export type AgentOperation = z.infer<typeof agentOperationSchema>;
export type DataCategory = z.infer<typeof dataCategorySchema>;
export type LegalBasis = z.infer<typeof legalBasisSchema>;
export type ApplicationFieldDefinition = z.infer<typeof applicationFieldDefinitionSchema>;
export type ApplicationReviewSummary = z.infer<typeof applicationReviewSummarySchema>;
export type ApplicationDataGrantSummary = z.infer<typeof applicationDataGrantSummarySchema>;
export type ApplicationDelegationSummary = z.infer<typeof applicationDelegationSummarySchema>;
export type ApplicationReceiptSummary = z.infer<typeof applicationReceiptSummarySchema>;
export type ApplicationWorkspace = z.infer<typeof applicationWorkspaceSchema>;
export type ApplicationAgentState = z.infer<typeof applicationAgentStateSchema>;
export type RequestAgentDelegation = z.infer<typeof requestAgentDelegationSchema>;
export type RequestDataGrant = z.infer<typeof requestDataGrantSchema>;
