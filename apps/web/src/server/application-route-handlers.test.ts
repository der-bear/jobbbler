import { describe, expect, it, vi } from "vitest";

import {
  confirmationCookie,
  handleRequestConfirmation,
  handleStartApplication,
  type ApplicationRouteDependencies,
} from "./application-route-handlers.js";

const draftId = "application_550e8400-e29b-41d4-a716-446655440000";
const reviewId = "review_550e8400-e29b-41d4-a716-446655440000";
const confirmationId = "confirmation_550e8400-e29b-41d4-a716-446655440000";

function dependencies(nodeEnv: "test" | "production" = "test"): ApplicationRouteDependencies {
  return {
    identity: {
      environment: { NODE_ENV: nodeEnv },
      now: () => "2026-08-29T10:00:00.000Z",
      identity: {
        resolveSession: vi.fn(async () => ({
          owner: { id: "owner_550e8400-e29b-41d4-a716-446655440000" },
        })),
      },
    } as never,
    authorization: {} as never,
    operations: {
      start: vi.fn(),
      requestConfirmation: vi.fn(async () => ({
        id: confirmationId,
        expiresAt: "2026-08-29T10:05:00.000Z",
      })),
    } as never,
    confirmation: { create: () => "not-returned-secret", hash: () => "a".repeat(64) },
  };
}

function request(headers: HeadersInit = {}): Request {
  return new Request(
    `https://jobbbler.test/api/v1/applications/${draftId}/reviews/${reviewId}/confirm`,
    {
      method: "POST",
      headers: {
        origin: "https://jobbbler.test",
        cookie: "jobbbler_owner_session=owner",
        ...headers,
      },
    },
  );
}

describe("application confirmation route", () => {
  it("uses a development-safe cookie name and never returns its secret", async () => {
    const response = await handleRequestConfirmation(
      request(),
      { params: Promise.resolve({ draftId, reviewId }) },
      dependencies(),
    );
    expect(response.status).toBe(201);
    expect(response.headers.get("set-cookie")).toContain("jobbbler_confirmation=");
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("SameSite=Strict");
    expect(response.headers.get("set-cookie")).not.toContain("Secure");
    expect(JSON.stringify(await response.json())).not.toContain("not-returned-secret");
  });

  it("uses the __Host prefix only with Secure in production", async () => {
    const response = await handleRequestConfirmation(
      request(),
      { params: Promise.resolve({ draftId, reviewId }) },
      dependencies("production"),
    );
    expect(response.headers.get("set-cookie")).toContain(
      "__Host-jobbbler_confirmation=not-returned-secret",
    );
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(
      confirmationCookie(request({ cookie: "__Host-jobbbler_confirmation=production-secret" }), {
        NODE_ENV: "production",
      }),
    ).toBe("production-secret");
  });

  it("never lets an agent mint the human confirmation", async () => {
    const response = await handleRequestConfirmation(
      request({ authorization: `Bearer ${"a".repeat(43)}` }),
      { params: Promise.resolve({ draftId, reviewId }) },
      dependencies(),
    );
    expect(response.status).toBe(403);
  });
});

describe("application request bodies", () => {
  it("publishes one sanitized durable activity after creating a draft", async () => {
    const publish = vi.fn(async () => true);
    const routeDependencies: ApplicationRouteDependencies = {
      ...dependencies(),
      activity: { publish },
    };
    vi.mocked(routeDependencies.operations.start).mockResolvedValue({
      id: draftId,
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      jobId: "job_550e8400-e29b-41d4-a716-446655440000",
      state: "draft",
      version: 0,
      answers: [],
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    });

    const response = await handleStartApplication(
      new Request("https://jobbbler.test/api/v1/applications", {
        method: "POST",
        headers: {
          origin: "https://jobbbler.test",
          cookie: "jobbbler_owner_session=owner",
          "content-type": "application/json",
        },
        body: JSON.stringify({ jobId: "job_550e8400-e29b-41d4-a716-446655440000" }),
      }),
      routeDependencies,
    );

    expect(response.status).toBe(201);
    expect(publish).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "application",
        key: "start_application",
        safeSummary: "Application workspace created.",
        actorKind: "human",
        aggregate: { type: "application_draft", version: 0 },
      }),
    );
    expect(JSON.stringify(publish.mock.calls)).not.toContain(draftId);
  });

  it("stops reading a chunked body once the physical byte cap is exceeded", async () => {
    const encoder = new TextEncoder();
    let pulls = 0;
    let cancelled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        controller.enqueue(encoder.encode("x".repeat(7_000)));
        if (pulls === 3) controller.close();
      },
      cancel() {
        cancelled = true;
      },
    });
    const routeDependencies = dependencies();
    const response = await handleStartApplication(
      new Request("https://jobbbler.test/api/v1/applications", {
        method: "POST",
        headers: {
          origin: "https://jobbbler.test",
          cookie: "jobbbler_owner_session=owner",
          "content-type": "application/json",
        },
        body,
        duplex: "half",
      } as RequestInit & { duplex: "half" }),
      routeDependencies,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      ok: false,
      error: { code: "VALIDATION", message: "The request body is too large." },
    });
    expect(routeDependencies.operations.start).not.toHaveBeenCalled();
    expect(cancelled).toBe(true);
  });
});
