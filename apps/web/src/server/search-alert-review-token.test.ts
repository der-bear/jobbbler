import { Buffer } from "node:buffer";

import { describe, expect, it } from "vitest";

import { createSearchAlertReviewCodec } from "./search-alert-review-token";

const environment = {
  NODE_ENV: "test",
  TOKEN_HASH_SECRET: "search-alert-review-test-secret-at-least-32-characters",
} as const;

const payload = {
  version: 1,
  purpose: "search_alert_activation",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  requestId: "req_550e8400-e29b-41d4-a716-446655440001",
  savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440002",
  savedSearchVersion: 0,
  endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440003",
  challengeId: "challenge_550e8400-e29b-41d4-a716-446655440004",
  recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
  firstRunAt: "2026-08-31T06:00:48.000Z",
  privacyNoticeVersion: "search-alert-v1",
  issuedAt: "2026-08-30T09:00:00.000Z",
  expiresAt: "2026-08-30T09:15:00.000Z",
} as const;

describe("search alert review token", () => {
  it("round-trips the exact signed owner, request, purpose, and reviewed policy", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);

    expect(codec.verify(token, payload.ownerId, "2026-08-30T09:05:00.000Z")).toEqual(payload);
  });

  it("carries endpoint identifiers but never the email or verification code", () => {
    const token = createSearchAlertReviewCodec(environment).sign(payload);
    const [encoded] = token.split(".");
    const decoded = Buffer.from(encoded ?? "", "base64url").toString("utf8");

    expect(decoded).toContain(payload.endpointId);
    expect(decoded).toContain(payload.challengeId);
    expect(decoded).not.toMatch(/@/u);
    expect(decoded).not.toContain("042197");
    expect(decoded).not.toMatch(/email|code/iu);
  });

  it("rejects an altered payload, signature, owner, request purpose, and expiry", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);
    const [encoded, signature] = token.split(".");
    const alteredPayload = `${encoded?.slice(0, -1)}${encoded?.endsWith("A") === true ? "B" : "A"}.${signature}`;
    const alteredSignature = `${encoded}.${signature?.slice(0, -1)}${signature?.endsWith("A") === true ? "B" : "A"}`;

    expect(() => codec.verify(alteredPayload, payload.ownerId, payload.issuedAt)).toThrow();
    expect(() => codec.verify(alteredSignature, payload.ownerId, payload.issuedAt)).toThrow();
    expect(() =>
      codec.verify(token, "owner_650e8400-e29b-41d4-a716-446655440000", payload.issuedAt),
    ).toThrow();
    expect(() => codec.sign({ ...payload, purpose: "some_other_purpose" } as never)).toThrow();
    expect(() => codec.verify(token, payload.ownerId, payload.expiresAt)).toThrow();
  });

  it("refuses tokens with a lifetime longer than fifteen minutes or invalid time order", () => {
    const codec = createSearchAlertReviewCodec(environment);
    expect(() => codec.sign({ ...payload, expiresAt: "2026-08-30T09:15:00.001Z" })).toThrow(
      /15 minutes/i,
    );
    expect(() => codec.sign({ ...payload, expiresAt: payload.issuedAt })).toThrow();
  });

  it("requires a strong configured signing secret in production", () => {
    expect(() => createSearchAlertReviewCodec({ NODE_ENV: "production" })).toThrow(
      /TOKEN_HASH_SECRET/u,
    );
    expect(() =>
      createSearchAlertReviewCodec({ NODE_ENV: "production", TOKEN_HASH_SECRET: "short" }),
    ).toThrow(/TOKEN_HASH_SECRET/u);
  });
});
