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
export type RequestAgentDelegation = z.infer<typeof requestAgentDelegationSchema>;
export type RequestDataGrant = z.infer<typeof requestDataGrantSchema>;
