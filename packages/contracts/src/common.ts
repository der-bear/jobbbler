import { z } from "zod";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ENTITY_ID_PATTERN =
  /^[a-z][a-z0-9_]{0,30}_[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const entityIdSchema = z
  .string()
  .min(38)
  .max(68)
  .regex(ENTITY_ID_PATTERN, "Expected a portable prefixed UUID entity ID.");

export const uuidSchema = z.string().regex(UUID_PATTERN, "Expected a valid UUID.");

export const isoInstantSchema = z.iso.datetime({ offset: true });

export const nonEmptyTextSchema = z.string().trim().min(1);

export type EntityId = z.infer<typeof entityIdSchema>;
