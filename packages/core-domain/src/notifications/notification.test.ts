import { describe, expect, it } from "vitest";

import {
  classifyNotificationRetry,
  createCaptureNotificationAdapter,
  createNotificationDeliveryIdentity,
} from "./notification.js";

describe("notification delivery policy", () => {
  it("derives one stable content-bound delivery identity", async () => {
    await expect(
      createNotificationDeliveryIdentity({
        scheduleId: "schedule_1",
        searchRunId: "run_1",
        endpointId: "endpoint_1",
        digestContentHash: "a".repeat(64),
        variant: "standard",
      }),
    ).resolves.toBe("delivery_81d1fc5d52606235158f47ad68a3ae7d0aa1e2e8485fa63f4d1fe4a3e0e3d742");
  });

  it("retries transient delivery failures with bounded delays and a provider retry-after", () => {
    expect(
      classifyNotificationRetry({
        attempt: 1,
        maxAttempts: 5,
        failure: { kind: "transient" },
      }),
    ).toEqual({ action: "retry", delaySeconds: 30 });
    expect(
      classifyNotificationRetry({
        attempt: 2,
        maxAttempts: 5,
        failure: { kind: "transient", retryAfterSeconds: 73 },
      }),
    ).toEqual({ action: "retry", delaySeconds: 73 });
    expect(
      classifyNotificationRetry({
        attempt: 5,
        maxAttempts: 5,
        failure: { kind: "transient" },
      }),
    ).toEqual({ action: "dead", reason: "attempt_limit" });
  });

  it("does not retry permanent or cancelled delivery failures", () => {
    expect(
      classifyNotificationRetry({
        attempt: 1,
        maxAttempts: 5,
        failure: { kind: "permanent" },
      }),
    ).toEqual({ action: "dead", reason: "permanent" });
    expect(
      classifyNotificationRetry({
        attempt: 1,
        maxAttempts: 5,
        failure: { kind: "cancelled" },
      }),
    ).toEqual({ action: "cancelled" });
  });

  it("captures only safe delivery metadata for local tests", async () => {
    const capture = createCaptureNotificationAdapter(() => "2026-08-29T10:00:00.000Z");
    const receipt = await capture.deliver({
      deliveryId: "delivery_1",
      endpointId: "endpoint_1",
      contentHash: "b".repeat(64),
      subject: "Roles for person@example.com",
      text: "Contact person@example.com about this role.",
    });

    expect(receipt).toEqual({
      deliveryId: "delivery_1",
      status: "accepted",
      acceptedAt: "2026-08-29T10:00:00.000Z",
    });
    expect(capture.safeDeliveries()).toEqual([
      {
        deliveryId: "delivery_1",
        endpointId: "endpoint_1",
        contentHash: "b".repeat(64),
        acceptedAt: "2026-08-29T10:00:00.000Z",
      },
    ]);
    expect(JSON.stringify(capture.safeDeliveries())).not.toContain("person@example.com");
  });
});
