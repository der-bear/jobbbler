import type { Clock } from "./clock.js";
import { toIsoInstant } from "./clock.js";

export interface DomainEvent<TPayload = Readonly<Record<string, unknown>>> {
  readonly id: string;
  readonly type: string;
  readonly aggregate: {
    readonly type: string;
    readonly id: string;
    readonly version: number;
  };
  readonly payload: TPayload;
  readonly occurredAt: string;
  readonly correlationId: string;
  readonly causationId?: string;
}

export interface CreateDomainEventInput<TPayload> {
  id: string;
  type: string;
  aggregate: DomainEvent<TPayload>["aggregate"];
  payload: TPayload;
  correlationId: string;
  causationId?: string;
}

export function createDomainEvent<TPayload>(
  input: CreateDomainEventInput<TPayload>,
  clock: Clock,
): DomainEvent<TPayload> {
  return {
    ...input,
    occurredAt: toIsoInstant(clock),
  };
}
