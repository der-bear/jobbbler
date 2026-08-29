import { z } from "zod";

import { entityIdSchema, isoInstantSchema } from "./common.js";

export const ownerKindSchema = z.enum(["ephemeral", "guest", "user", "service"]);

export const ownerSummarySchema = z.strictObject({
  id: entityIdSchema,
  kind: ownerKindSchema,
  verified: z.boolean(),
  recoverable: z.boolean(),
});

export const emailAddressSchema = z
  .string()
  .trim()
  .min(3)
  .max(320)
  .email()
  .transform((value) => value.toLowerCase());

export const startEmailVerificationInputSchema = z.strictObject({
  email: emailAddressSchema,
});

export const startEmailVerificationResultSchema = z.strictObject({
  challengeId: entityIdSchema,
  endpointId: entityIdSchema,
  expiresAt: isoInstantSchema,
  maskedDestination: z.string().min(3).max(320),
  delivery: z.enum(["queued", "captured"]),
  developmentCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const completeEmailVerificationInputSchema = z.strictObject({
  challengeId: entityIdSchema,
  code: z.string().regex(/^\d{6}$/),
});

export const completeEmailVerificationResultSchema = z.strictObject({
  owner: ownerSummarySchema,
  endpointId: entityIdSchema,
  verifiedAt: isoInstantSchema,
});

export const startOwnerRecoveryInputSchema = z.strictObject({
  email: emailAddressSchema,
});

export const startOwnerRecoveryResultSchema = z.strictObject({
  recoveryId: entityIdSchema,
  expiresAt: isoInstantSchema,
  delivery: z.literal("accepted"),
  developmentCode: z
    .string()
    .regex(/^\d{6}$/)
    .optional(),
});

export const completeOwnerRecoveryInputSchema = z.strictObject({
  recoveryId: entityIdSchema,
  code: z.string().regex(/^\d{6}$/),
});

export const createOwnerDeletionIntentInputSchema = z.strictObject({
  confirmation: z.literal("DELETE MY PRIVATE DATA"),
});

export const createOwnerDeletionIntentResultSchema = z.strictObject({
  deletionId: entityIdSchema,
  expiresAt: isoInstantSchema,
});

export const completeOwnerDeletionInputSchema = z.strictObject({
  deletionId: entityIdSchema,
  confirmation: z.literal("DELETE"),
});

export const completeOwnerDeletionResultSchema = z.strictObject({
  deleted: z.literal(true),
});

export const ownerSessionResultSchema = z.strictObject({
  owner: ownerSummarySchema,
  expiresAt: isoInstantSchema,
});

export const verificationEndpointSummarySchema = z.strictObject({
  id: entityIdSchema,
  kind: z.literal("email"),
  maskedDestination: z.string().min(3).max(320),
  status: z.enum(["pending", "verified", "revoked"]),
  verifiedAt: isoInstantSchema.nullable(),
});

export type OwnerKind = z.infer<typeof ownerKindSchema>;
export type OwnerSummary = z.infer<typeof ownerSummarySchema>;
export type StartEmailVerificationInput = z.input<typeof startEmailVerificationInputSchema>;
export type StartEmailVerificationResult = z.infer<typeof startEmailVerificationResultSchema>;
export type CompleteEmailVerificationInput = z.infer<typeof completeEmailVerificationInputSchema>;
export type CompleteEmailVerificationResult = z.infer<typeof completeEmailVerificationResultSchema>;
export type StartOwnerRecoveryInput = z.input<typeof startOwnerRecoveryInputSchema>;
export type StartOwnerRecoveryResult = z.infer<typeof startOwnerRecoveryResultSchema>;
export type CompleteOwnerRecoveryInput = z.infer<typeof completeOwnerRecoveryInputSchema>;
export type CreateOwnerDeletionIntentInput = z.infer<typeof createOwnerDeletionIntentInputSchema>;
export type CreateOwnerDeletionIntentResult = z.infer<typeof createOwnerDeletionIntentResultSchema>;
export type CompleteOwnerDeletionInput = z.infer<typeof completeOwnerDeletionInputSchema>;
export type CompleteOwnerDeletionResult = z.infer<typeof completeOwnerDeletionResultSchema>;
export type OwnerSessionResult = z.infer<typeof ownerSessionResultSchema>;
export type VerificationEndpointSummary = z.infer<typeof verificationEndpointSummarySchema>;
