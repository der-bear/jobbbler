export interface NotificationDeliveryIdentityInput {
  readonly scheduleId: string;
  readonly searchRunId: string;
  readonly endpointId: string;
  readonly digestContentHash: string;
  readonly variant: string;
}

export interface NotificationFailure {
  readonly kind: "transient" | "permanent" | "cancelled";
  readonly retryAfterSeconds?: number;
}

export interface NotificationRetryInput {
  readonly attempt: number;
  readonly maxAttempts: number;
  readonly failure: NotificationFailure;
}

export type NotificationRetryDecision =
  | { readonly action: "retry"; readonly delaySeconds: number }
  | { readonly action: "dead"; readonly reason: "permanent" | "attempt_limit" }
  | { readonly action: "cancelled" };

export interface NotificationDelivery {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly contentHash: string;
  readonly subject: string;
  readonly text: string;
}

export interface NotificationDeliveryReceipt {
  readonly deliveryId: string;
  readonly status: "accepted";
  readonly acceptedAt: string;
}

export interface NotificationAdapter {
  deliver(input: NotificationDelivery): Promise<NotificationDeliveryReceipt>;
}

export interface SafeCapturedDelivery {
  readonly deliveryId: string;
  readonly endpointId: string;
  readonly contentHash: string;
  readonly acceptedAt: string;
}

export interface CaptureNotificationAdapter extends NotificationAdapter {
  safeDeliveries(): readonly SafeCapturedDelivery[];
}

const retryDelaysSeconds = [30, 120, 600, 3_600] as const;

function nonEmpty(value: string, label: string): void {
  if (value.trim().length === 0) throw new TypeError(`${label} must not be empty.`);
}

function validAttempt(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive integer.`);
  }
}

function hex(bytes: ArrayBuffer): string {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

export async function createNotificationDeliveryIdentity(
  input: NotificationDeliveryIdentityInput,
): Promise<string> {
  nonEmpty(input.scheduleId, "Schedule ID");
  nonEmpty(input.searchRunId, "Search run ID");
  nonEmpty(input.endpointId, "Endpoint ID");
  nonEmpty(input.digestContentHash, "Digest content hash");
  nonEmpty(input.variant, "Delivery variant");
  const canonicalIdentity = [
    input.scheduleId,
    input.searchRunId,
    input.endpointId,
    input.digestContentHash,
    input.variant,
  ].join("\u0000");
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(canonicalIdentity));
  return `delivery_${hex(digest)}`;
}

export function classifyNotificationRetry(
  input: NotificationRetryInput,
): NotificationRetryDecision {
  validAttempt(input.attempt, "Attempt");
  validAttempt(input.maxAttempts, "Maximum attempts");
  if (input.attempt > input.maxAttempts)
    throw new RangeError("Attempt cannot exceed maximum attempts.");
  if (input.failure.kind === "cancelled") return { action: "cancelled" };
  if (input.failure.kind === "permanent") return { action: "dead", reason: "permanent" };
  if (input.attempt === input.maxAttempts) return { action: "dead", reason: "attempt_limit" };

  const retryAfter = input.failure.retryAfterSeconds;
  if (retryAfter !== undefined) {
    if (!Number.isSafeInteger(retryAfter) || retryAfter < 0 || retryAfter > 24 * 60 * 60) {
      throw new TypeError("Retry-After must be a whole number of seconds within one day.");
    }
    return { action: "retry", delaySeconds: retryAfter };
  }
  return {
    action: "retry",
    delaySeconds: retryDelaysSeconds[Math.min(input.attempt - 1, retryDelaysSeconds.length - 1)]!,
  };
}

export function createCaptureNotificationAdapter(now: () => string): CaptureNotificationAdapter {
  const deliveries: SafeCapturedDelivery[] = [];
  return {
    async deliver(input) {
      nonEmpty(input.deliveryId, "Delivery ID");
      nonEmpty(input.endpointId, "Endpoint ID");
      nonEmpty(input.contentHash, "Content hash");
      const acceptedAt = now();
      deliveries.push({
        deliveryId: input.deliveryId,
        endpointId: input.endpointId,
        contentHash: input.contentHash,
        acceptedAt,
      });
      return { deliveryId: input.deliveryId, status: "accepted", acceptedAt };
    },
    safeDeliveries: () => deliveries.map((delivery) => ({ ...delivery })),
  };
}
