import type { Clock } from "./clock.js";

export type PrincipalKind = "anonymous" | "guest" | "user" | "service";

export interface PrincipalContext {
  readonly kind: PrincipalKind;
  readonly id?: string;
  readonly roles: readonly string[];
}

export interface AgentContext {
  readonly sessionId: string;
  readonly delegationId?: string;
  readonly verifiedClientId?: string;
}

export interface CommandContext {
  readonly requestId: string;
  readonly correlationId: string;
  readonly principal: PrincipalContext;
  readonly agent?: AgentContext;
  readonly clock: Clock;
  readonly idempotencyKey?: string;
}

export interface ApplicationCommand<TInput, TOutput> {
  readonly name: string;
  execute(context: CommandContext, input: TInput): Promise<TOutput>;
}
