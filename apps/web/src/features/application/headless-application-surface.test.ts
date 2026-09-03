import { describe, expect, it, vi } from "vitest";
import type { ZodType } from "zod";

import type {
  ApplicationDelegationSummary,
  ApplicationDraft,
  ApplicationWorkspace,
  Job,
} from "@jobbbler/contracts";
import type { QueryApiOptions } from "@/lib/query-client";

import {
  createHeadlessApplicationSurfaceStore,
  type HeadlessApplicationSurfaceStoreDependencies,
} from "./headless-application-surface";
import {
  clearApplicationAgentCredential,
  storeApplicationAgentCredential,
  type ApplicationAgentCredentialStorage,
} from "./application-agent-credential-vault";
import type { ApplicationAgentCredential } from "./application-model";
import { createStableApplicationToolManifests } from "./webmcp-tools";

const draftId = "application_550e8400-e29b-41d4-a716-446655440000";
const jobId = "job_550e8400-e29b-41d4-a716-446655440000";
const delegationId = "delegation_550e8400-e29b-41d4-a716-446655440000";
const sessionId = "agent_session_550e8400-e29b-41d4-a716-446655440000";
const reviewId = "interaction_550e8400-e29b-41d4-a716-446655440000";

const job: Job = {
  id: jobId,
  organizationId: "organization_550e8400-e29b-41d4-a716-446655440000",
  organizationName: "Northstar Systems",
  title: "Principal Product Designer",
  summary: "Design clear workflows for a growing product platform.",
  categories: ["design_research"],
  skills: ["Product design"],
  locations: ["Berlin, Germany"],
  workModel: "remote",
  employmentType: "full_time",
  seniority: "principal",
  salary: null,
  applyMode: "internal",
  source: { key: "jobbbler_demo", label: "Jobbbler demo", url: null },
  publishedAt: "2026-08-28T10:00:00.000Z",
  updatedAt: "2026-08-29T10:00:00.000Z",
  status: "open",
};

function baseWorkspace(): ApplicationWorkspace {
  return {
    serverNow: "2026-08-29T10:00:00.000Z",
    applyMode: "internal",
    draft: {
      id: draftId,
      ownerId: "owner_550e8400-e29b-41d4-a716-446655440000",
      jobId,
      state: "draft",
      version: 1,
      answers: [],
      createdAt: "2026-08-29T10:00:00.000Z",
      updatedAt: "2026-08-29T10:00:00.000Z",
    },
    job,
    requirements: [
      {
        fieldKey: "full_name",
        label: "Full name",
        description: "Shared with the hiring team.",
        input: "text",
        required: true,
        sensitive: true,
        category: "identity",
        options: [],
      },
    ],
    recipient: { id: job.organizationId, name: job.organizationName },
    purpose: "Submit this reviewed application to Northstar Systems.",
    noticeVersion: "privacy-2026-08-29",
    legalBasis: "consent",
    review: null,
    dataGrant: null,
    delegationRequests: [],
    receipt: null,
  };
}

function credentialStorage(values = new Map<string, string>()): Readonly<{
  storage: ApplicationAgentCredentialStorage;
  values: Map<string, string>;
}> {
  return {
    storage: {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
    },
    values,
  };
}

function activeDelegation(credential: ApplicationAgentCredential): ApplicationDelegationSummary {
  return {
    id: delegationId,
    agentSessionId: credential.sessionId,
    operations: ["read_application", "edit_application"],
    purpose: "Prepare this application with the candidate.",
    status: "active",
    expiresAt: credential.expiresAt,
    approvedAt: "2026-08-29T10:01:00.000Z",
  };
}

describe("headless application surface", () => {
  it("uses a credential approved on the visible surface after navigation returns headlessly", async () => {
    let workspace = baseWorkspace();
    const credential: ApplicationAgentCredential = {
      sessionId,
      token: "A".repeat(43),
      expiresAt: "2026-08-29T10:15:00.000Z",
    };
    const vault = credentialStorage();
    const store = createHeadlessApplicationSurfaceStore({
      storage: vault.storage,
      request: async <T>() => workspace as T,
    });
    const signal = new AbortController().signal;
    const before = await store.resolve(draftId, { signal });
    if (before === null) throw new Error("Expected the application surface.");
    expect(before.surface.hasAgentCredential()).toBe(false);

    storeApplicationAgentCredential(vault.storage, draftId, credential, workspace.serverNow);
    workspace = { ...workspace, delegationRequests: [activeDelegation(credential)] };
    await store.resolve(draftId, { signal, visibleSurface: before.surface });

    const after = await store.resolve(draftId, { signal });
    if (after === null) throw new Error("Expected the application surface.");
    expect(after.surface.hasAgentCredential()).toBe(true);
    expect(after.surface.isOperationAuthorized("edit_application")).toBe(true);
  });

  it("cannot reuse a credential revoked on the visible surface after navigation returns headlessly", async () => {
    let workspace = baseWorkspace();
    const credential: ApplicationAgentCredential = {
      sessionId,
      token: "A".repeat(43),
      expiresAt: "2026-08-29T10:15:00.000Z",
    };
    const vault = credentialStorage();
    storeApplicationAgentCredential(vault.storage, draftId, credential, workspace.serverNow);
    workspace = { ...workspace, delegationRequests: [activeDelegation(credential)] };
    const store = createHeadlessApplicationSurfaceStore({
      storage: vault.storage,
      request: async <T>() => workspace as T,
    });
    const signal = new AbortController().signal;
    const before = await store.resolve(draftId, { signal });
    if (before === null) throw new Error("Expected the application surface.");
    expect(before.surface.hasAgentCredential()).toBe(true);

    clearApplicationAgentCredential(vault.storage, draftId);
    workspace = {
      ...workspace,
      delegationRequests: [{ ...activeDelegation(credential), status: "revoked" }],
    };
    await store.resolve(draftId, { signal, visibleSurface: before.surface });

    const after = await store.resolve(draftId, { signal });
    if (after === null) throw new Error("Expected the application surface.");
    expect(after.surface.hasAgentCredential()).toBe(false);
    expect(after.surface.isOperationAuthorized("edit_application")).toBe(false);
  });

  it("completes the stable assistance-to-decline flow without changing the browser URL", async () => {
    let workspace = baseWorkspace();
    const credential: ApplicationAgentCredential = {
      sessionId,
      token: "A".repeat(43),
      expiresAt: "2026-08-29T10:15:00.000Z",
    };
    const requestUrls: string[] = [];
    const request = async <T>(
      url: string,
      _schema: ZodType<T>,
      options?: QueryApiOptions,
    ): Promise<T> => {
      requestUrls.push(url);
      if (url === `/api/v1/applications/${draftId}`) return workspace as unknown as T;
      if (url.endsWith("/agent-sessions")) return credential as unknown as T;
      if (url.endsWith("/delegations")) {
        const delegation: ApplicationDelegationSummary = {
          id: delegationId,
          agentSessionId: sessionId,
          operations: (options?.body as { operations: ApplicationDelegationSummary["operations"] })
            .operations,
          purpose: "Prepare this application with the candidate.",
          status: "requested",
          expiresAt: credential.expiresAt,
          approvedAt: null,
        };
        workspace = { ...workspace, delegationRequests: [delegation] };
        return delegation as unknown as T;
      }
      if (url.endsWith(`/delegations/${delegationId}/approve`)) {
        const delegation = {
          ...workspace.delegationRequests[0]!,
          status: "active" as const,
          approvedAt: "2026-08-29T10:01:00.000Z",
        };
        workspace = { ...workspace, delegationRequests: [delegation] };
        return delegation as unknown as T;
      }
      if (url.endsWith("/answer")) {
        const body = options?.body as {
          expectedVersion: number;
          answers: ApplicationDraft["answers"];
        };
        workspace = {
          ...workspace,
          draft: {
            ...workspace.draft,
            version: body.expectedVersion + 1,
            answers: body.answers,
          },
        };
        return workspace.draft as unknown as T;
      }
      if (url.endsWith("/consent") && options?.method === "POST") {
        const fullName = workspace.draft.answers.find(({ fieldKey }) => fieldKey === "full_name");
        return {
          id: reviewId,
          draftId,
          draftVersion: workspace.draft.version,
          recipient: workspace.recipient.name,
          purpose: workspace.purpose,
          fields: [
            {
              fieldKey: "full_name",
              label: "Full name",
              value: fullName?.value ?? null,
              sensitive: true,
            },
          ],
          noticeVersion: workspace.noticeVersion,
          expiresAt: "2026-08-29T10:10:00.000Z",
        } as unknown as T;
      }
      if (url.endsWith(`/consent/${reviewId}`) && options?.method === "POST") {
        const body = options.body as {
          expectedVersion: number;
          decision: "approved" | "declined";
          interaction: {
            channel: "agent_client";
            requestId: string;
            affirmation: "approved" | "declined";
            evidenceVersion: "agent-interaction-v1";
          };
        };
        if (
          body.decision !== "declined" ||
          body.interaction.channel !== "agent_client" ||
          body.interaction.requestId !== reviewId ||
          body.interaction.affirmation !== "declined"
        ) {
          throw new Error("The declined decision lost its agent-client evidence.");
        }
        return {
          requestId: reviewId,
          draftId,
          decision: body.decision,
          acceptedDraftVersion: body.expectedVersion,
          decidedAt: "2026-08-29T10:02:00.000Z",
          channel: body.interaction.channel,
          evidenceVersion: body.interaction.evidenceVersion,
        } as unknown as T;
      }
      throw new Error(`Unexpected request: ${url}`);
    };
    const storage = new Map<string, string>();
    const store = createHeadlessApplicationSurfaceStore({
      request: request as unknown as HeadlessApplicationSurfaceStoreDependencies["request"],
      storage: {
        getItem: (key) => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
        removeItem: (key) => storage.delete(key),
      },
    });
    const manifests = createStableApplicationToolManifests({
      resolveApplication: store.resolve,
      withdrawConsent: async () => {
        throw new Error("Consent withdrawal is outside this flow.");
      },
    });
    const tool = (name: string) => {
      const manifest = manifests.find((candidate) => candidate.name === name);
      if (manifest === undefined) throw new Error(`Missing stable tool: ${name}.`);
      return manifest;
    };
    const signal = new AbortController().signal;
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
    const browserUrl = "https://jobbbler.test/about/webmcp";
    const browserLocation = {
      href: browserUrl,
      assign: vi.fn(),
      replace: vi.fn(),
    };
    const pushState = vi.fn();
    const replaceState = vi.fn();
    Object.defineProperty(globalThis, "window", {
      configurable: true,
      value: {
        location: browserLocation,
        history: { pushState, replaceState },
      },
    });

    try {
      const assistance = await tool("request_application_assistance").execute(
        { draftId },
        { signal },
      );
      expect(assistance).toMatchObject({
        status: "completed",
        data: { agentAuthorityStatus: "active", nextTool: "propose_application_updates" },
      });

      const updated = await tool("propose_application_updates").execute(
        {
          draftId,
          patches: [{ fieldKey: "full_name", value: "Avery Morgan" }],
        },
        { signal },
      );
      expect(updated).toMatchObject({
        status: "completed",
        data: { missingCount: 0, nextTool: "request_submission_review" },
      });

      const review = await tool("request_submission_review").execute({ draftId }, { signal });
      expect(review).toMatchObject({
        status: "requires_user_action",
        requestId: reviewId,
        nextTool: "decide_application_submission",
        decisionContext: {
          draftId,
          draftVersion: 2,
          reviewHref: `/apply/${draftId}`,
          fields: [{ fieldKey: "full_name", value: "Avery Morgan" }],
        },
      });

      const declined = await tool("decide_application_submission").execute(
        { draftId, requestId: reviewId, draftVersion: 2, decision: "declined" },
        { signal },
      );
      expect(declined).toMatchObject({
        status: "completed",
        summary: "Declined. No data was shared and nothing was submitted.",
        data: {
          draftId,
          receiptStatus: "none",
          nextTool: "request_submission_review",
        },
      });

      expect(browserLocation.href).toBe(browserUrl);
      expect(browserLocation.assign).not.toHaveBeenCalled();
      expect(browserLocation.replace).not.toHaveBeenCalled();
      expect(pushState).not.toHaveBeenCalled();
      expect(replaceState).not.toHaveBeenCalled();
      expect(requestUrls.every((url) => url.startsWith("/api/"))).toBe(true);
      expect(requestUrls.some((url) => url.startsWith("/apply/"))).toBe(false);
    } finally {
      if (originalWindow === undefined) delete (globalThis as { window?: unknown }).window;
      else Object.defineProperty(globalThis, "window", originalWindow);
    }
  });
});
