import { describe, expect, it } from "vitest";

import {
  createSearchAlertReviewCodec,
  type SearchAlertReviewPayload,
} from "./search-alert-review-token";

const environment = {
  NODE_ENV: "test",
  TOKEN_HASH_SECRET: "search-alert-review-test-secret-at-least-32-characters",
} as const;

const payload: SearchAlertReviewPayload = {
  version: 1,
  purpose: "search_alert_activation",
  ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
  requestId: "req_550e8400-e29b-41d4-a716-446655440001",
  savedSearchId: "saved_550e8400-e29b-41d4-a716-446655440002",
  savedSearchVersion: 0,
  criteria: {
    query: "TypeScript",
    categories: ["software_engineering"],
    workModels: ["remote"],
    seniorities: ["senior"],
    locations: ["Europe"],
    skills: ["React"],
    excludeKeywords: [],
    salary: null,
    postedWithinDays: 30,
    sort: "newest",
    cursor: null,
    limit: 20,
    unresolvedAssumptions: [],
  },
  endpointId: "endpoint_550e8400-e29b-41d4-a716-446655440003",
  challengeId: "challenge_550e8400-e29b-41d4-a716-446655440004",
  deliveryVerificationRequired: true,
  scheduleId: "schedule_550e8400-e29b-41d4-a716-446655440005",
  recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
  firstRunAt: "2026-08-31T06:00:48.000Z",
  privacyNoticeVersion: "search-alert-v1",
  issuedAt: "2026-08-30T09:00:00.000Z",
  expiresAt: "2026-08-30T09:15:00.000Z",
};

describe("search alert review token", () => {
  it("round-trips the exact signed owner, request, purpose, and reviewed policy", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);

    expect(
      codec.verify(
        token,
        payload.ownerId,
        payload.requestId,
        payload.expiresAt,
        "2026-08-30T09:05:00.000Z",
      ),
    ).toEqual({
      ownerId: payload.ownerId,
      requestId: payload.requestId,
      expiresAt: payload.expiresAt,
    });
  });

  it("keeps the client token opaque and bound to one owner, request, and expiry", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);

    expect(token).toMatch(/^r1\.[a-z0-9]+\.[A-Za-z0-9_-]{43}$/u);
    expect(token.length).toBeLessThan(64);
    expect(token).not.toContain(payload.requestId);
    expect(token).not.toContain(payload.endpointId);
    expect(() =>
      codec.authenticate(token, payload.ownerId, "req_650e8400-e29b-41d4-a716-446655440001"),
    ).toThrow();
  });

  it("rejects an altered payload, signature, owner, request purpose, and expiry", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);
    const [version, expiry, signature] = token.split(".");
    const alteredVersion = `r2.${expiry}.${signature}`;
    const alteredSignature = `${version}.${expiry}.${signature?.slice(0, -1)}${signature?.endsWith("A") === true ? "B" : "A"}`;

    expect(() =>
      codec.verify(
        alteredVersion,
        payload.ownerId,
        payload.requestId,
        payload.expiresAt,
        payload.issuedAt,
      ),
    ).toThrow();
    expect(() =>
      codec.verify(
        alteredSignature,
        payload.ownerId,
        payload.requestId,
        payload.expiresAt,
        payload.issuedAt,
      ),
    ).toThrow();
    expect(() =>
      codec.verify(
        token,
        "owner_650e8400-e29b-41d4-a716-446655440000",
        payload.requestId,
        payload.expiresAt,
        payload.issuedAt,
      ),
    ).toThrow();
    expect(() => codec.sign({ ...payload, purpose: "some_other_purpose" } as never)).toThrow();
    expect(() =>
      codec.verify(token, payload.ownerId, payload.requestId, payload.expiresAt, payload.expiresAt),
    ).toThrow();
  });

  it("authenticates an expired review binding so its provisional data can be removed safely", () => {
    const codec = createSearchAlertReviewCodec(environment);
    const token = codec.sign(payload);

    expect(codec.authenticate(token, payload.ownerId, payload.requestId)).toEqual({
      ownerId: payload.ownerId,
      requestId: payload.requestId,
      expiresAt: payload.expiresAt,
    });
    expect(() =>
      codec.verify(token, payload.ownerId, payload.requestId, payload.expiresAt, payload.expiresAt),
    ).toThrow();
    expect(() =>
      codec.authenticate(token, "owner_650e8400-e29b-41d4-a716-446655440000", payload.requestId),
    ).toThrow();
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
