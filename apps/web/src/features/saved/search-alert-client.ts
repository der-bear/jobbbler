import type { ZodType } from "zod";

import {
  decideSearchAlertResultSchema,
  ownerSessionResultSchema,
  requestSearchAlertResultSchema,
  type DecideSearchAlertInput,
  type DecideSearchAlertResult,
  type RequestSearchAlertInput,
  type RequestSearchAlertResult,
} from "@jobbbler/contracts";

import { ApiClientError, queryApi, type QueryApiOptions } from "@/lib/query-client";

interface SearchAlertClientDependencies {
  readonly request: <T>(url: string, schema: ZodType<T>, options?: QueryApiOptions) => Promise<T>;
  createIdempotencyKey(): string;
  readonly requestKeys?: Map<string, SearchAlertRequestKey>;
  readonly requestKeyStorage?: SearchAlertRequestKeyStorage | undefined;
  nowMs?(): number;
}

interface SearchAlertRequestKeyStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): unknown;
}

interface SearchAlertRequestKey {
  readonly key: string;
  readonly expiresAtMs: number;
}

const REQUEST_KEY_LIFETIME_MS = 15 * 60 * 1_000;
const REQUEST_KEY_CACHE_LIMIT = 64;
const REQUEST_KEY_STORAGE_KEY = "jobbbler.search-alert-request-keys.v1";
const REQUEST_FINGERPRINT_SECRET_KEY = "jobbbler.search-alert-fingerprint-secret.v1";
const defaultRequestKeys = new Map<string, SearchAlertRequestKey>();
const moduleFingerprintSecret = crypto.randomUUID();

function defaultRequestKeyStorage(): SearchAlertRequestKeyStorage | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

const defaultDependencies: SearchAlertClientDependencies = {
  request: queryApi,
  createIdempotencyKey: () => crypto.randomUUID(),
  requestKeys: defaultRequestKeys,
  requestKeyStorage: defaultRequestKeyStorage(),
  nowMs: Date.now,
};

function fingerprintSecret(storage: SearchAlertRequestKeyStorage | undefined): string {
  if (storage === undefined) return moduleFingerprintSecret;
  try {
    const existing = storage.getItem(REQUEST_FINGERPRINT_SECRET_KEY);
    if (existing !== null && /^[0-9a-f-]{36}$/u.test(existing)) return existing;
    const created = crypto.randomUUID();
    storage.setItem(REQUEST_FINGERPRINT_SECRET_KEY, created);
    return created;
  } catch {
    return moduleFingerprintSecret;
  }
}

async function requestFingerprint(input: RequestSearchAlertInput, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(`jobbbler.search-alert-request-fingerprint.v1:${secret}`),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(JSON.stringify(input)),
  );
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function hydrateRequestKeys(
  requestKeys: Map<string, SearchAlertRequestKey>,
  storage: SearchAlertRequestKeyStorage | undefined,
): void {
  if (storage === undefined) return;
  try {
    const encoded = storage.getItem(REQUEST_KEY_STORAGE_KEY);
    if (encoded === null) return;
    const parsed: unknown = JSON.parse(encoded);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("version" in parsed) ||
      parsed.version !== 1 ||
      !("entries" in parsed) ||
      !Array.isArray(parsed.entries)
    ) {
      return;
    }
    for (const entry of parsed.entries.slice(-REQUEST_KEY_CACHE_LIMIT)) {
      if (
        !Array.isArray(entry) ||
        entry.length !== 3 ||
        typeof entry[0] !== "string" ||
        !/^[0-9a-f]{64}$/u.test(entry[0]) ||
        typeof entry[1] !== "string" ||
        entry[1].length < 1 ||
        entry[1].length > 200 ||
        typeof entry[2] !== "number" ||
        !Number.isFinite(entry[2])
      ) {
        continue;
      }
      if (!requestKeys.has(entry[0])) {
        requestKeys.set(entry[0], { key: entry[1], expiresAtMs: entry[2] });
      }
    }
  } catch {
    // Session persistence is best-effort; the in-memory idempotency guard remains active.
  }
}

function persistRequestKeys(
  requestKeys: Map<string, SearchAlertRequestKey>,
  storage: SearchAlertRequestKeyStorage | undefined,
): void {
  if (storage === undefined) return;
  try {
    storage.setItem(
      REQUEST_KEY_STORAGE_KEY,
      JSON.stringify({
        version: 1,
        entries: [...requestKeys.entries()]
          .slice(-REQUEST_KEY_CACHE_LIMIT)
          .map(([fingerprint, value]) => [fingerprint, value.key, value.expiresAtMs]),
      }),
    );
  } catch {
    // A storage quota or privacy mode must not make the WebMCP tool unusable.
  }
}

async function idempotencyKeyFor(
  input: RequestSearchAlertInput,
  dependencies: SearchAlertClientDependencies,
): Promise<{ readonly fingerprint: string; readonly key: string }> {
  const requestKeys = dependencies.requestKeys ?? defaultRequestKeys;
  const storage = dependencies.requestKeyStorage;
  const nowMs = dependencies.nowMs?.() ?? Date.now();
  const fingerprint = await requestFingerprint(input, fingerprintSecret(storage));
  hydrateRequestKeys(requestKeys, storage);
  const existing = requestKeys.get(fingerprint);
  if (existing !== undefined && existing.expiresAtMs > nowMs) {
    return { fingerprint, key: existing.key };
  }
  if (existing !== undefined) requestKeys.delete(fingerprint);
  for (const [candidate, entry] of requestKeys) {
    if (entry.expiresAtMs <= nowMs) requestKeys.delete(candidate);
  }
  if (requestKeys.size >= REQUEST_KEY_CACHE_LIMIT) {
    const oldest = requestKeys.keys().next().value as string | undefined;
    if (oldest !== undefined) requestKeys.delete(oldest);
  }
  const key = dependencies.createIdempotencyKey();
  requestKeys.set(fingerprint, { key, expiresAtMs: nowMs + REQUEST_KEY_LIFETIME_MS });
  persistRequestKeys(requestKeys, storage);
  return { fingerprint, key };
}

function rememberReviewExpiry(
  fingerprint: string,
  key: string,
  result: RequestSearchAlertResult,
  dependencies: SearchAlertClientDependencies,
): void {
  const expiresAtMs = Date.parse(result.expiresAt);
  if (!Number.isFinite(expiresAtMs)) return;
  const requestKeys = dependencies.requestKeys ?? defaultRequestKeys;
  requestKeys.set(fingerprint, { key, expiresAtMs });
  persistRequestKeys(requestKeys, dependencies.requestKeyStorage);
}

function postSearchAlertRequest(
  input: RequestSearchAlertInput,
  idempotencyKey: string,
  options: Readonly<{ signal: AbortSignal }>,
  dependencies: SearchAlertClientDependencies,
): Promise<RequestSearchAlertResult> {
  return dependencies.request(
    "/api/v1/agent/search-alerts/request",
    requestSearchAlertResultSchema,
    {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": idempotencyKey },
      signal: options.signal,
    },
  );
}

export async function requestSearchAlert(
  input: RequestSearchAlertInput,
  options: Readonly<{ signal: AbortSignal }>,
  dependencies: SearchAlertClientDependencies = defaultDependencies,
): Promise<RequestSearchAlertResult> {
  const { fingerprint, key: idempotencyKey } = await idempotencyKeyFor(input, dependencies);
  try {
    const result = await postSearchAlertRequest(input, idempotencyKey, options, dependencies);
    rememberReviewExpiry(fingerprint, idempotencyKey, result, dependencies);
    return result;
  } catch (error) {
    if (!(error instanceof ApiClientError) || error.code !== "UNAUTHORIZED") throw error;
    await dependencies.request("/api/v1/owners/session", ownerSessionResultSchema, {
      method: "POST",
      signal: options.signal,
    });
    const result = await postSearchAlertRequest(input, idempotencyKey, options, dependencies);
    rememberReviewExpiry(fingerprint, idempotencyKey, result, dependencies);
    return result;
  }
}

export function decideSearchAlert(
  input: DecideSearchAlertInput,
  options: Readonly<{ signal: AbortSignal }>,
  dependencies: SearchAlertClientDependencies = defaultDependencies,
): Promise<DecideSearchAlertResult> {
  return dependencies.request(
    "/api/v1/agent/search-alerts/decision",
    decideSearchAlertResultSchema,
    {
      method: "POST",
      body: input,
      headers: { "Idempotency-Key": dependencies.createIdempotencyKey() },
      signal: options.signal,
    },
  );
}
