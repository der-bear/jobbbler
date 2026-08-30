import { afterEach, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Job } from "@jobbbler/contracts";

import { handleListApplications, handleStartApplication } from "./application-route-handlers";
import { createApplicationRouteDependencies } from "./applications";
import {
  handleCompleteEmailVerificationRequest,
  handleCreateOwnerSessionRequest,
  handleGetOwnerSessionRequest,
  handleStartEmailVerificationRequest,
} from "./identity-route-handlers";
import { createConfiguredStorage } from "./context";
import { createIdentityRouteDependencies } from "./identity";
import {
  handleCompleteOwnerRecoveryRequest,
  handleStartOwnerRecoveryRequest,
} from "./owner-privacy-route-handlers";

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
      data: { owner: { kind: "guest", verified: true } },
    });

    const current = await handleGetOwnerSessionRequest(
      new Request("https://jobbbler.example/api/v1/owners/session", {
        headers: { cookie: cookie ?? "" },
      }),
      dependencies,
    );
    await expect(current.json()).resolves.toMatchObject({
      ok: true,
      data: { owner: { kind: "guest", verified: true } },
    });
    storage.close();
  });

  it("recovers an application-only workspace and lists the same private application", async () => {
    const directory = await mkdtemp(join(tmpdir(), "jobbbler-application-recovery-route-"));
    directories.push(directory);
    const storage = createConfiguredStorage({
      DATABASE_DRIVER: "sqlite",
      SQLITE_DATABASE_PATH: join(directory, "jobbbler.sqlite"),
    });
    const identity = createIdentityRouteDependencies(storage, environment, () => now);
    const applications = createApplicationRouteDependencies(storage, identity);
    const organizationId = "org_82000000-0000-7000-8000-000000000001";
    const job: Job = {
      id: "job_82000000-0000-7000-8000-000000000001",
      organizationId,
      organizationName: "Recoverable Systems",
      title: "Product Platform Engineer",
      summary: "Build calm application workflows.",
      categories: ["software_engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Europe"],
      skills: ["TypeScript"],
      salary: null,
      source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
      applyMode: "internal",
      status: "open",
      publishedAt: now,
      updatedAt: now,
    };
    await storage.organizations.upsert({
      id: organizationId,
      name: job.organizationName,
      slug: "recoverable-systems",
      website: "https://example.com",
      description: "A fictional organization used for recovery integration tests.",
      createdAt: now,
      updatedAt: now,
    });
    await storage.jobs.upsert(job);

    const created = await handleCreateOwnerSessionRequest(
      mutation("/api/v1/owners/session"),
      identity,
    );
    const originalCookie = created.headers.get("set-cookie")?.split(";", 1)[0];
    expect(originalCookie).toMatch(/^jobbbler_owner=/);

    const application = await handleStartApplication(
      mutation("/api/v1/applications", { jobId: job.id }, originalCookie),
      applications,
    );
    const applicationBody = (await application.json()) as {
      readonly data: { readonly draft: { readonly id: string } };
    };
    expect(application.status).toBe(201);

    const verification = await handleStartEmailVerificationRequest(
      mutation("/api/v1/owners/email/start", { email: "Person@Example.com" }, originalCookie),
      identity,
    );
    const verificationBody = (await verification.json()) as {
      readonly data: { readonly challengeId: string; readonly developmentCode: string };
    };
    const verified = await handleCompleteEmailVerificationRequest(
      mutation(
        "/api/v1/owners/email/complete",
        {
          challengeId: verificationBody.data.challengeId,
          code: verificationBody.data.developmentCode,
        },
        originalCookie,
      ),
      identity,
    );
    expect(verified.status).toBe(200);

    const recovery = await handleStartOwnerRecoveryRequest(
      mutation("/api/v1/owners/recovery/start", { email: "person@example.com" }),
      identity,
    );
    const recoveryBody = (await recovery.json()) as {
      readonly data: { readonly recoveryId: string; readonly developmentCode: string };
    };
    expect(recovery.status).toBe(202);

    const completed = await handleCompleteOwnerRecoveryRequest(
      mutation("/api/v1/owners/recovery/complete", {
        recoveryId: recoveryBody.data.recoveryId,
        code: recoveryBody.data.developmentCode,
      }),
      identity,
    );
    const recoveredCookie = completed.headers.get("set-cookie")?.split(";", 1)[0];
    expect(completed.status).toBe(200);
    expect(recoveredCookie).toMatch(/^jobbbler_owner=/);
    expect(recoveredCookie).not.toBe(originalCookie);

    const listed = await handleListApplications(
      new Request("https://jobbbler.example/api/v1/applications", {
        headers: { cookie: recoveredCookie ?? "" },
      }),
      applications,
    );
    await expect(listed.json()).resolves.toMatchObject({
      ok: true,
      data: [{ draftId: applicationBody.data.draft.id, job: { id: job.id } }],
    });
    storage.close();
  });
});
