import { describe, expect, it, vi } from "vitest";

import type {
  DecideSearchAlertResult,
  JobAlertSchedule,
  RequestSearchAlertResult,
  SavedSearch,
} from "@jobbbler/contracts";

import { MAX_WEBMCP_RESULT_BYTES, webMcpResultSize } from "@/lib/webmcp-tool-result";
import { createSearchAlertReviewCodec } from "@/server/search-alert-review-token";

import { createSavedToolManifests } from "./webmcp-tools";

const savedSearch: SavedSearch = {
  id: "saved_00000001-0000-7000-8000-000000000001",
  ownerId: "owner_00000001-0000-7000-8000-000000000001",
  name: "Senior platform roles",
  criteria: {
    query: "platform",
    categories: ["software_engineering"],
    workModels: ["remote"],
    seniorities: ["senior"],
    locations: ["Europe"],
    skills: [],
    excludeKeywords: [],
    salary: null,
    postedWithinDays: null,
    sort: "relevance",
    cursor: null,
    limit: 20,
    unresolvedAssumptions: [],
  },
  version: 0,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
};

const schedule: JobAlertSchedule = {
  id: "schedule_00000001-0000-7000-8000-000000000001",
  ownerId: savedSearch.ownerId,
  savedSearchId: savedSearch.id,
  recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
  delivery: {
    channel: "email",
    endpointId: "endpoint_00000001-0000-7000-8000-000000000001",
  },
  enabled: true,
  nextRunAt: "2026-08-30T06:00:00.000Z",
  version: 2,
  createdAt: "2026-08-29T08:00:00.000Z",
  updatedAt: "2026-08-29T08:00:00.000Z",
};

const alertReview: RequestSearchAlertResult = {
  status: "requires_user_action",
  requestId: "req_00000001-0000-7000-8000-000000000001",
  reviewToken: "signed-search-alert-review",
  expiresAt: "2026-08-29T08:10:00.000Z",
  review: {
    savedSearchId: savedSearch.id,
    savedSearchVersion: savedSearch.version,
    maskedDestination: "a***@example.com",
    deliveryVerification: { required: true, method: "email_code" },
    criteria: savedSearch.criteria,
    recurrence: schedule.recurrence,
    firstRunAt: schedule.nextRunAt,
    purpose: "Store this search and email matching-job updates.",
    dataCategories: ["saved_search_criteria", "delivery_email"],
    retention: "Used only while this search alert is on and your email is attached.",
    withdrawal: "Stop it any time: pause or delete the alert, or remove your email.",
    privacyNoticeVersion: "2026-08-29",
  },
};

const approvedAlert: DecideSearchAlertResult = {
  status: "completed",
  requestId: alertReview.requestId,
  decision: "approved",
  channel: "agent_client",
  savedSearchId: savedSearch.id,
  scheduleId: schedule.id,
  nextRunAt: schedule.nextRunAt,
  decidedAt: "2026-08-29T08:02:00.000Z",
  summary: "Email updates are on for this job search.",
};

function dependencies(
  overrides: Partial<Parameters<typeof createSavedToolManifests>[0]> = {},
): Parameters<typeof createSavedToolManifests>[0] {
  return {
    listSavedSearches: vi.fn(async () => [savedSearch]),
    listSchedules: vi.fn(async () => [schedule]),
    saveSearch: vi.fn(async () => savedSearch),
    requestSearchAlert: vi.fn(async () => alertReview),
    decideSearchAlert: vi.fn(async () => approvedAlert),
    setScheduleEnabled: vi.fn(),
    deleteSavedSearch: vi.fn(async () => ({
      savedSearchId: savedSearch.id,
      scheduleId: schedule.id,
      deleted: true as const,
    })),
    savedSearchHref: () => "/",
    getLatestRun: vi.fn(async () => ({
      savedSearchId: savedSearch.id,
      evaluation: null,
      delivery: null,
    })),
    onNavigate: () => undefined,
    onScheduleCommitted: vi.fn(),
    onSavedSearchCommitted: vi.fn(),
    onSavedSearchDeleted: vi.fn(),
    ...overrides,
  };
}

describe("saved-route WebMCP tools", () => {
  it("gives every saved-search tool plain and specific instructions", () => {
    const manifests = createSavedToolManifests(dependencies());

    const instructions = manifests.map(({ name, purpose, description }) => ({
      name,
      purpose,
      description,
    }));

    expect(instructions).toEqual([
      {
        name: "get_saved_alerts",
        purpose: "Show saved job searches and whether email updates are on.",
        description:
          "Use optional limit and offset with the current private owner to list saved searches newest first, returning each saved-search ID, email-update state, next check, and nextOffset without exposing an email address or sign-in information.",
      },
      {
        name: "request_search_alert",
        purpose:
          "Prepare Jobbbler-managed email updates for one search; use this instead of a client timer.",
        description:
          "When the person asks Jobbbler to keep checking a search or email changes, ask in the agent client for any missing name, schedule, time zone, or email, then use the exact supplied values to return one review for approve or decline with decide_search_alert. This is server-side monitoring that continues after the browser closes; do not substitute client automation. Require a six-digit code only for a new email.",
      },
      {
        name: "decide_search_alert",
        purpose: "Use the person's answer to turn the reviewed email updates on or leave them off.",
        description:
          "Use the exact requestId and reviewToken from request_search_alert, the person's explicit approved or declined decision, and a six-digit code only when requested to return the decision and turn on only the unchanged reviewed updates.",
      },
      {
        name: "set_job_alert_state",
        purpose: "Pause, resume, or permanently delete one saved job search and its email updates.",
        description:
          "Use a scheduleId from get_saved_alerts to pause or resume email updates, or an exact savedSearchId and confirmation after the person clearly requests permanent deletion, and return the resulting state or deletion receipt; an ambiguous stop request means pause, and more than one possible match requires a question.",
      },
      {
        name: "open_saved_search",
        purpose: "Open one saved search and show its saved choices on the results page.",
        description:
          "Use a savedSearchId from get_saved_alerts to open its exact choices on the results page and return the opened route and saved-search ID without changing the criteria.",
      },
      {
        name: "get_latest_search_update",
        purpose: "Show what changed the last time a saved job search was checked.",
        description:
          "Use a savedSearchId plus optional limit and offset to return counts and a paged list of job IDs that are new, updated, closed, or no longer match since the latest check, including nextOffset when more changes remain.",
      },
      {
        name: "save_job_search",
        purpose: "Save one job search without turning on email updates.",
        description:
          "Use a short name and exact choices the person supplied or get_search_state(detail=exact) to save and return a saved-search ID with email updates off; ask for missing values, and use request_search_alert instead when the person wants notifications.",
      },
    ]);
    expect(JSON.stringify(instructions)).not.toMatch(
      /\b(?:workspace|recovery|destination|digest|session)\b/iu,
    );
  });

  it("reads a bounded owner-scoped alert summary without destinations", async () => {
    const manifests = createSavedToolManifests(dependencies());

    expect(manifests.map(({ name }) => name)).toEqual([
      "get_saved_alerts",
      "request_search_alert",
      "decide_search_alert",
      "set_job_alert_state",
      "open_saved_search",
      "get_latest_search_update",
      "save_job_search",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
      false,
    ]);
    const result = await manifests[0]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "completed",
      summary: "Found 1 saved job search. 1 has email updates turned on.",
      data: {
        alerts: [
          {
            savedSearchId: savedSearch.id,
            scheduleId: schedule.id,
            enabled: true,
            name: savedSearch.name,
          },
        ],
      },
    });
    expect(JSON.stringify(result)).not.toContain(schedule.delivery.endpointId);
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
  });

  it("paginates saved searches with the exact IDs returned by the service", async () => {
    const savedSearches = Array.from({ length: 8 }, (_, index) => ({
      ...savedSearch,
      id: `saved_0000000${String(index + 1)}-0000-7000-8000-00000000000${String(index + 1)}`,
      name: `Search ${String(index + 1)}`,
      updatedAt: `2026-08-${String(29 - index).padStart(2, "0")}T08:00:00.000Z`,
    }));
    const manifests = createSavedToolManifests(
      dependencies({
        listSavedSearches: vi.fn(async () => savedSearches),
        listSchedules: vi.fn(async () => []),
      }),
    );

    const result = await manifests[0]!.execute(
      { limit: 3, offset: 3 },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        total: 8,
        returned: 3,
        nextOffset: 6,
        alerts: savedSearches.slice(3, 6).map(({ id, name }) => ({
          savedSearchId: id,
          name,
        })),
      },
    });
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);

    const schemas = manifests
      .filter(({ name }) =>
        ["set_job_alert_state", "open_saved_search", "get_latest_search_update"].includes(name),
      )
      .map(({ inputSchema }) => JSON.stringify(inputSchema));
    for (const schema of schemas) {
      expect(schema).toContain("^saved_[0-9a-f-]{36}$");
      expect(schema).not.toContain("^saved_search_");
    }
  });

  it("saves reusable criteria without asking for an email or enabling updates", async () => {
    const saveSearch = vi.fn(async () => savedSearch);
    const onSavedSearchCommitted = vi.fn();
    const manifests = createSavedToolManifests(
      dependencies({ saveSearch, onSavedSearchCommitted }),
    );
    const manifest = manifests.find(({ name }) => name === "save_job_search");
    expect(manifest).toBeDefined();
    expect(JSON.stringify(manifest?.inputSchema)).not.toMatch(/email|recurrence|schedule/iu);
    const signal = new AbortController().signal;

    const result = await manifest!.execute(
      {
        name: "Senior platform roles",
        criteria: {
          query: "  platform  ",
          workModels: ["remote"],
          seniorities: ["senior"],
          locations: ["Europe"],
        },
      },
      { signal },
    );

    expect(saveSearch).toHaveBeenCalledWith(
      {
        name: "Senior platform roles",
        criteria: {
          query: "platform",
          categories: [],
          workModels: ["remote"],
          employmentTypes: [],
          seniorities: ["senior"],
          locations: ["Europe"],
          skills: [],
          excludeKeywords: [],
          salary: null,
          postedWithinDays: null,
          sort: "relevance",
          cursor: null,
          limit: 20,
          unresolvedAssumptions: [],
        },
      },
      { signal },
    );
    expect(onSavedSearchCommitted).toHaveBeenCalledWith(savedSearch);
    expect(result).toMatchObject({
      status: "completed",
      summary: "Saved this job search. Email updates are off.",
      data: {
        savedSearchId: savedSearch.id,
        name: savedSearch.name,
        emailUpdates: false,
      },
    });
    expect(JSON.stringify(result)).not.toMatch(/owner_|email.*@|endpoint|schedule_/iu);
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("preserves a city-or-remote search when the agent saves it", async () => {
    const saveSearch = vi.fn(async () => savedSearch);
    const manifests = createSavedToolManifests(dependencies({ saveSearch }));
    const manifest = manifests.find(({ name }) => name === "save_job_search");
    const signal = new AbortController().signal;

    await manifest!.execute(
      {
        name: "Principal design · Berlin or remote",
        criteria: {
          query: "Principal Product Designer",
          locations: ["Berlin"],
          remoteOrLocations: true,
          salary: { minimum: 120_000, currency: "USD" },
        },
      },
      { signal },
    );

    expect(saveSearch).toHaveBeenCalledWith(
      expect.objectContaining({
        criteria: expect.objectContaining({
          locations: ["Berlin"],
          remoteOrLocations: true,
          workModels: expect.arrayContaining(["remote", "hybrid", "onsite", "flexible"]),
          salary: expect.objectContaining({ minimum: 120_000, currency: "USD" }),
        }),
      }),
      { signal },
    );
  });

  it("paginates the bounded change references for a saved search", async () => {
    const changes = Array.from({ length: 12 }, (_, index) => ({
      id: `change_0000000${String(index + 1)}-0000-7000-8000-00000000000${String(index + 1)}`,
      jobId: `job_0000000${String(index + 1)}-0000-7000-8000-00000000000${String(index + 1)}`,
      kind: index % 2 === 0 ? ("new" as const) : ("updated" as const),
      createdAt: "2026-08-29T08:00:00.000Z",
    }));
    const manifests = createSavedToolManifests(
      dependencies({
        getLatestRun: vi.fn(async () => ({
          savedSearchId: savedSearch.id,
          evaluation: {
            id: "evaluation_00000001-0000-7000-8000-000000000001",
            createdAt: "2026-08-29T08:00:00.000Z",
            catalogUpdatedAt: "2026-08-29T07:55:00.000Z",
            baselineCount: 80,
            changes: { total: 12, truncated: false, items: changes },
          },
          delivery: null,
        })),
      }),
    );

    const result = await manifests[5]!.execute(
      { savedSearchId: savedSearch.id, limit: 4, offset: 4 },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "completed",
      data: {
        total: 12,
        returned: 4,
        nextOffset: 8,
        truncated: true,
        sourceTruncated: false,
        changes: changes.slice(4, 8).map(({ jobId, kind }) => ({ jobId, kind })),
      },
    });
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("prepares one exact alert review from model-friendly search criteria", async () => {
    const requestSearchAlert = vi.fn(async () => alertReview);
    const manifests = createSavedToolManifests(dependencies({ requestSearchAlert }));
    const signal = new AbortController().signal;

    const result = await manifests[1]!.execute(
      {
        name: "Senior platform roles",
        criteria: {
          query: "  platform  ",
          workModels: ["remote"],
          seniorities: ["senior"],
          locations: ["Europe"],
        },
        recurrence: { frequency: "daily", time: "09:00", timeZone: "Europe/Kyiv" },
        email: "ADA@EXAMPLE.COM",
      },
      { signal },
    );

    expect(requestSearchAlert).toHaveBeenCalledWith(
      {
        name: "Senior platform roles",
        criteria: {
          query: "platform",
          categories: [],
          workModels: ["remote"],
          employmentTypes: [],
          seniorities: ["senior"],
          locations: ["Europe"],
          skills: [],
          excludeKeywords: [],
          salary: null,
          postedWithinDays: null,
          sort: "relevance",
          cursor: null,
          limit: 20,
          unresolvedAssumptions: [],
        },
        recurrence: schedule.recurrence,
        delivery: { channel: "email", email: "ada@example.com" },
      },
      { signal },
    );
    expect(result).toMatchObject({
      status: "requires_user_action",
      requestId: alertReview.requestId,
      nextTool: "decide_search_alert",
      userAction: { kind: "data_consent", surface: "search_alert_consent" },
      decisionContext: {
        reviewToken: alertReview.reviewToken,
        verificationMode: "email_code",
      },
      presentation: {
        title: "Review this job alert",
        prompt:
          "Check the search, email address, and timing. Then enter the 6-digit code sent to that email.",
        confirmLabel: "Verify and turn on",
        facts: expect.arrayContaining([
          { key: "Search", value: expect.stringContaining("platform") },
          { key: "Purpose", value: alertReview.review.purpose },
          { key: "Data", value: "Your job search choices and email address." },
          { key: "Retention", value: alertReview.review.retention },
          { key: "Withdrawal", value: alertReview.review.withdrawal },
        ]),
      },
    });
    expect("decisionContext" in result ? result.decisionContext : undefined).toEqual({
      reviewToken: alertReview.reviewToken,
      verificationMode: "email_code",
    });
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    expect(JSON.stringify(result)).not.toContain('"review"');
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
  });

  it("describes city-or-remote scope plainly in the agent-client consent review", async () => {
    const cityOrRemoteReview: RequestSearchAlertResult = {
      ...alertReview,
      review: {
        ...alertReview.review,
        criteria: {
          ...alertReview.review.criteria,
          locations: ["Berlin"],
          workModels: ["flexible", "hybrid", "onsite", "remote"],
          remoteOrLocations: true,
        },
      },
    };
    const manifests = createSavedToolManifests(
      dependencies({ requestSearchAlert: vi.fn(async () => cityOrRemoteReview) }),
    );

    const result = await manifests[1]!.execute(
      {
        name: "Berlin or remote",
        criteria: {
          query: "platform",
          locations: ["Berlin"],
          remoteOrLocations: true,
        },
        recurrence: schedule.recurrence,
        email: "ada@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "requires_user_action",
      presentation: {
        facts: expect.arrayContaining([
          { key: "Search", value: expect.stringContaining("location: Berlin or remote") },
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("work model: Flexible, Hybrid, Onsite, Remote");
  });

  it("keeps a real server-signed alert review inside the operational output budget", async () => {
    const reviewToken = createSearchAlertReviewCodec({
      NODE_ENV: "test",
      TOKEN_HASH_SECRET: "search-alert-review-test-secret-at-least-32-characters",
    }).sign({
      version: 1,
      purpose: "search_alert_activation",
      ownerId: savedSearch.ownerId,
      requestId: alertReview.requestId,
      savedSearchId: savedSearch.id,
      savedSearchVersion: savedSearch.version,
      criteria: savedSearch.criteria,
      endpointId: schedule.delivery.endpointId,
      challengeId: "challenge_00000001-0000-7000-8000-000000000001",
      deliveryVerificationRequired: true,
      scheduleId: schedule.id,
      recurrence: schedule.recurrence,
      firstRunAt: schedule.nextRunAt,
      privacyNoticeVersion: alertReview.review.privacyNoticeVersion,
      issuedAt: "2026-08-29T08:00:00.000Z",
      expiresAt: alertReview.expiresAt,
    });
    const manifests = createSavedToolManifests(
      dependencies({
        requestSearchAlert: vi.fn(async () => ({ ...alertReview, reviewToken })),
      }),
    );

    const result = await manifests[1]!.execute(
      {
        name: "Senior platform roles",
        criteria: {
          query: "platform",
          workModels: ["remote"],
          seniorities: ["senior"],
          locations: ["Europe"],
        },
        recurrence: schedule.recurrence,
        email: "ada@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "requires_user_action",
      decisionContext: { reviewToken },
    });
    expect(webMcpResultSize(result)).toBeLessThanOrEqual(MAX_WEBMCP_RESULT_BYTES);
  });

  it("rejects an exact alert review that cannot fit before starting verification", async () => {
    const requestSearchAlert = vi.fn(async () => alertReview);
    const manifests = createSavedToolManifests(dependencies({ requestSearchAlert }));

    const result = await manifests[1]!.execute(
      {
        name: "Unreviewable alert",
        criteria: { query: "x".repeat(500) },
        recurrence: schedule.recurrence,
        email: "ada@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "failed",
      error: { code: "VALIDATION", retryable: false },
    });
    expect(JSON.stringify(result)).toMatch(/use fewer filters/i);
    expect(requestSearchAlert).not.toHaveBeenCalled();
  });

  it("shows every weekly check day in the external-client consent facts", async () => {
    const weeklyReview: RequestSearchAlertResult = {
      ...alertReview,
      review: {
        ...alertReview.review,
        recurrence: {
          frequency: "weekly",
          time: "08:30",
          timeZone: "Europe/London",
          days: ["monday", "thursday"],
        },
      },
    };
    const manifests = createSavedToolManifests(
      dependencies({ requestSearchAlert: vi.fn(async () => weeklyReview) }),
    );

    const result = await manifests[1]!.execute(
      {
        name: "UK product design",
        criteria: { query: "product design", locations: ["United Kingdom"] },
        recurrence: weeklyReview.review.recurrence,
        email: "ada@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "requires_user_action",
      presentation: {
        facts: expect.arrayContaining([
          {
            key: "Schedule",
            value: "Weekly on Monday and Thursday at 08:30 (Europe/London)",
          },
        ]),
      },
    });
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
  });

  it("tells the agent client when the reviewed destination is already verified", async () => {
    const verifiedReview: RequestSearchAlertResult = {
      ...alertReview,
      review: {
        ...alertReview.review,
        deliveryVerification: { required: false, method: null },
      },
    };
    const manifests = createSavedToolManifests(
      dependencies({ requestSearchAlert: vi.fn(async () => verifiedReview) }),
    );

    const result = await manifests[1]!.execute(
      {
        name: "Senior platform roles",
        criteria: { query: "platform", workModels: ["remote"] },
        recurrence: schedule.recurrence,
        email: "ada@example.com",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({
      status: "requires_user_action",
      presentation: {
        confirmLabel: "Turn on alert",
        facts: expect.arrayContaining([
          { key: "Email check", value: "Already verified — no new code" },
        ]),
      },
      decisionContext: { verificationMode: "existing_verified_email" },
    });
  });

  it("passes the person's exact approval with a code only when the review requires one", async () => {
    const decideSearchAlert = vi.fn(async () => approvedAlert);
    const manifests = createSavedToolManifests(dependencies({ decideSearchAlert }));
    const signal = new AbortController().signal;

    const missingCode = await manifests[2]!.execute(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "approved",
      },
      { signal },
    );
    const inventedChannel = await manifests[2]!.execute(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "approved",
        code: "421973",
        channel: "first_party_ui",
      },
      { signal },
    );

    expect(missingCode).toMatchObject({ status: "completed" });
    expect(inventedChannel).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(decideSearchAlert).toHaveBeenCalledWith(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "approved",
        channel: "agent_client",
      },
      { signal },
    );

    decideSearchAlert.mockClear();

    const result = await manifests[2]!.execute(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "approved",
        code: "421973",
      },
      { signal },
    );

    expect(decideSearchAlert).toHaveBeenCalledWith(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "approved",
        code: "421973",
        channel: "agent_client",
      },
      { signal },
    );
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email updates are on for this job search.",
      data: {
        decision: "approved",
        scheduleId: schedule.id,
        nextRunAt: schedule.nextRunAt,
      },
    });
  });

  it("records a decline without asking the person for a verification code", async () => {
    const declined: DecideSearchAlertResult = {
      ...approvedAlert,
      decision: "declined",
      scheduleId: null,
      nextRunAt: null,
      summary: "Email updates were not turned on.",
    };
    const decideSearchAlert = vi.fn(async () => declined);
    const manifests = createSavedToolManifests(dependencies({ decideSearchAlert }));
    const signal = new AbortController().signal;

    const result = await manifests[2]!.execute(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "declined",
      },
      { signal },
    );

    expect(decideSearchAlert).toHaveBeenCalledWith(
      {
        requestId: alertReview.requestId,
        reviewToken: alertReview.reviewToken,
        decision: "declined",
        channel: "agent_client",
      },
      { signal },
    );
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email updates were not turned on.",
      data: { decision: "declined", scheduleId: null, nextRunAt: null },
    });
  });

  it("pauses with the authoritative schedule version", async () => {
    const setScheduleEnabled = vi.fn(async () => ({ ...schedule, enabled: false, version: 3 }));
    const onScheduleCommitted = vi.fn();
    const manifests = createSavedToolManifests(
      dependencies({ setScheduleEnabled, onScheduleCommitted }),
    );
    const signal = new AbortController().signal;
    const result = await manifests[3]!.execute(
      { action: "pause", scheduleId: schedule.id },
      { signal },
    );

    expect(setScheduleEnabled).toHaveBeenCalledWith(
      schedule.id,
      { expectedVersion: schedule.version, enabled: false },
      { signal },
    );
    expect(onScheduleCommitted).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email updates for this job search are paused.",
      data: { enabled: false, version: 3 },
    });
  });

  it("resumes a paused schedule with the explicit resume action", async () => {
    const pausedSchedule = { ...schedule, enabled: false, version: 3 };
    const resumedSchedule = { ...pausedSchedule, enabled: true, version: 4 };
    const setScheduleEnabled = vi.fn(async () => resumedSchedule);
    const manifests = createSavedToolManifests(
      dependencies({
        listSchedules: vi.fn(async () => [pausedSchedule]),
        setScheduleEnabled,
      }),
    );
    const signal = new AbortController().signal;

    const result = await manifests[3]!.execute(
      { action: "resume", scheduleId: pausedSchedule.id },
      { signal },
    );

    expect(setScheduleEnabled).toHaveBeenCalledWith(
      pausedSchedule.id,
      { expectedVersion: pausedSchedule.version, enabled: true },
      { signal },
    );
    expect(result).toMatchObject({
      status: "completed",
      summary: "Email updates for this job search are on again.",
      data: { enabled: true, version: 4 },
    });
  });

  it("permanently deletes one exact saved search and bridges the bounded receipt", async () => {
    const receipt = {
      savedSearchId: savedSearch.id,
      scheduleId: schedule.id,
      deleted: true as const,
    };
    const deleteSavedSearch = vi.fn(async () => receipt);
    const onSavedSearchDeleted = vi.fn();
    const current = { ...dependencies(), deleteSavedSearch, onSavedSearchDeleted };
    const manifests = createSavedToolManifests(current);
    const signal = new AbortController().signal;

    const result = await manifests[3]!.execute(
      {
        action: "delete",
        savedSearchId: savedSearch.id,
        confirmation: "DELETE_SAVED_SEARCH_AND_ALERT",
      },
      { signal },
    );

    expect(deleteSavedSearch).toHaveBeenCalledWith(
      savedSearch.id,
      { confirmation: "DELETE_SAVED_SEARCH_AND_ALERT" },
      { signal },
    );
    expect(onSavedSearchDeleted).toHaveBeenCalledWith(receipt);
    expect(result).toMatchObject({
      status: "completed",
      data: receipt,
      facts: [{ key: "deleted", value: true }],
    });
    expect(JSON.stringify(result)).not.toMatch(/endpoint|email/iu);
  });

  it("deletes a saved search that has no schedule", async () => {
    const unscheduled = { ...savedSearch, id: "saved_00000002-0000-7000-8000-000000000002" };
    const receipt = { savedSearchId: unscheduled.id, scheduleId: null, deleted: true as const };
    const deleteSavedSearch = vi.fn(async () => receipt);
    const manifests = createSavedToolManifests({
      ...dependencies({
        listSavedSearches: vi.fn(async () => [unscheduled]),
        listSchedules: vi.fn(async () => []),
      }),
      deleteSavedSearch,
      onSavedSearchDeleted: vi.fn(),
    });

    const result = await manifests[3]!.execute(
      {
        action: "delete",
        savedSearchId: unscheduled.id,
        confirmation: "DELETE_SAVED_SEARCH_AND_ALERT",
      },
      { signal: new AbortController().signal },
    );

    expect(result).toMatchObject({ status: "completed", data: receipt });
    expect(deleteSavedSearch).toHaveBeenCalledTimes(1);
  });

  it("rejects unknown targets, legacy booleans, mixed branches, and missing confirmation", async () => {
    const setScheduleEnabled = vi.fn();
    const deleteSavedSearch = vi.fn();
    const manifests = createSavedToolManifests({
      ...dependencies({ setScheduleEnabled }),
      deleteSavedSearch,
      onSavedSearchDeleted: vi.fn(),
    });
    const signal = new AbortController().signal;
    const unknown = await manifests[3]!.execute(
      {
        action: "pause",
        scheduleId: "schedule_00000002-0000-7000-8000-000000000002",
      },
      { signal },
    );
    const legacy = await manifests[3]!.execute(
      { scheduleId: schedule.id, enabled: false },
      { signal },
    );
    const mixed = await manifests[3]!.execute(
      {
        action: "delete",
        scheduleId: schedule.id,
        savedSearchId: savedSearch.id,
        confirmation: "DELETE_SAVED_SEARCH_AND_ALERT",
      },
      { signal },
    );
    const unconfirmed = await manifests[3]!.execute(
      { action: "delete", savedSearchId: savedSearch.id },
      { signal },
    );

    for (const result of [unknown, legacy, mixed, unconfirmed]) {
      expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    }
    expect(setScheduleEnabled).not.toHaveBeenCalled();
    expect(deleteSavedSearch).not.toHaveBeenCalled();
  });
});
