import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  handleCompleteEmailVerificationRequest,
  handleCreateOwnerSessionRequest,
  handleGetOwnerSessionRequest,
  handleStartEmailVerificationRequest,
} from "./identity-route-handlers";
import { createConfiguredStorage } from "./context";
import { createIdentityRouteDependencies } from "./identity";

const directories: string[] = [];
const environment = {
  NODE_ENV: "test",
  PUBLIC_BASE_URL: "https://jobbbler.example",
  NOTIFICATION_DRIVER: "capture",
  ALLOW_LOCAL_OTP_CAPTURE: "true",
  TOKEN_HASH_SECRET: "token-hash-secret-that-is-long-enough-for-tests",
  PII_ENCRYPTION_KEY: "pii-encryption-secret-that-is-long-enough-for-tests",
};
const now = "2026-08-29T10:00:00.000Z";

function mutation(path: string, body?: unknown, cookie?: string): Request {
  return new Request(`https://jobbbler.example${path}`, {
    method: "POST",
    headers: {
      origin: "https://jobbbler.example",
      "sec-fetch-site": "same-origin",
      ...(body === undefined ? {} : { "content-type": "application/json" }),
      ...(cookie === undefined ? {} : { cookie }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("progressive identity integration", () => {
  it("keeps one owner from anonymous private action through verified recoverability", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-identity-route-"));
    directories.push(directory);
    const storage = createConfiguredStorage({
      DATABASE_DRIVER: "sqlite",
      SQLITE_DATABASE_PATH: join(directory, "jobbbler.sqlite"),
    });
    const dependencies = createIdentityRouteDependencies(storage, environment, () => now);

    const created = await handleCreateOwnerSessionRequest(
      mutation("/api/v1/owners/session"),
      dependencies,
    );
    const cookie = created.headers.get("set-cookie")?.split(";", 1)[0];
    expect(created.status).toBe(201);
    expect(cookie).toMatch(/^jobbbler_owner=/);

    const started = await handleStartEmailVerificationRequest(
      mutation("/api/v1/owners/email/start", { email: "Person@Example.com" }, cookie),
      dependencies,
    );
    const startedBody = (await started.json()) as {
      readonly data: { readonly challengeId: string; readonly developmentCode: string };
    };
    expect(started.status).toBe(202);

    const completed = await handleCompleteEmailVerificationRequest(
      mutation(
        "/api/v1/owners/email/complete",
        {
          challengeId: startedBody.data.challengeId,
          code: startedBody.data.developmentCode,
        },
        cookie,
      ),
      dependencies,
    );
    await expect(completed.json()).resolves.toMatchObject({
      ok: true,
      data: { owner: { kind: "guest", verified: true, recoverable: true } },
    });

    const current = await handleGetOwnerSessionRequest(
      new Request("https://jobbbler.example/api/v1/owners/session", {
        headers: { cookie: cookie ?? "" },
      }),
      dependencies,
    );
    await expect(current.json()).resolves.toMatchObject({
      ok: true,
      data: { owner: { kind: "guest", verified: true, recoverable: true } },
    });
    storage.close();
  });
});
