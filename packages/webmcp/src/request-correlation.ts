import { entityIdSchema } from "@jobbbler/contracts";

const requestCorrelationBySignal = new WeakMap<AbortSignal, string>();

export function recordToolRequestCorrelation(signal: AbortSignal, correlationId: string): void {
  const parsed = entityIdSchema.safeParse(correlationId);
  if (!parsed.success) return;
  requestCorrelationBySignal.set(signal, parsed.data);
}

export function takeToolRequestCorrelation(signal: AbortSignal): string | undefined {
  const correlationId = requestCorrelationBySignal.get(signal);
  requestCorrelationBySignal.delete(signal);
  return correlationId;
}
