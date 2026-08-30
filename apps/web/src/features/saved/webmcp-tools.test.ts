import { describe, expect, it, vi } from "vitest";

import type {
  DecideSearchAlertResult,
  JobAlertSchedule,
  RequestSearchAlertResult,
  SavedSearch,
} from "@jobbbler/contracts";

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
    criteria: savedSearch.criteria,
    recurrence: schedule.recurrence,
    firstRunAt: schedule.nextRunAt,
    purpose: "Send email when this saved technology-job search changes.",
    dataCategories: ["saved_search_criteria", "delivery_email"],
    retention: "Stored until the alert or private workspace is deleted.",
    withdrawal: "Pause the alert or delete the private workspace at any time.",
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
  summary: "Job alert activated for the reviewed search and destination.",
};

function dependencies(
  overrides: Partial<Parameters<typeof createSavedToolManifests>[0]> = {},
): Parameters<typeof createSavedToolManifests>[0] {
  return {
    listSavedSearches: vi.fn(async () => [savedSearch]),
    listSchedules: vi.fn(async () => [schedule]),
    requestSearchAlert: vi.fn(async () => alertReview),
    decideSearchAlert: vi.fn(async () => approvedAlert),
    setScheduleEnabled: vi.fn(),
    savedSearchHref: () => "/",
    getLatestRun: vi.fn(async () => ({
      savedSearchId: savedSearch.id,
      evaluation: null,
      delivery: null,
    })),
    onNavigate: () => undefined,
    onScheduleCommitted: vi.fn(),
    ...overrides,
  };
}

describe("saved-route WebMCP tools", () => {
  it("reads a bounded owner-scoped alert summary without destinations", async () => {
    const manifests = createSavedToolManifests(dependencies());

    expect(manifests.map(({ name }) => name)).toEqual([
      "get_saved_alerts",
      "request_search_alert",
      "decide_search_alert",
      "set_job_alert_state",
      "open_saved_search",
      "get_latest_search_update",
    ]);
    expect(manifests.map(({ annotations }) => annotations.readOnlyHint)).toEqual([
      true,
      false,
      false,
      false,
      false,
      true,
    ]);
    expect(manifests[1]!.description).toContain("explicit decision");
    expect(manifests[2]!.description).toContain("6-digit code");
    expect(manifests[3]!.description).toContain("exact schedule ID");
    const result = await manifests[0]!.execute({}, { signal: new AbortController().signal });
    expect(result).toMatchObject({
      status: "completed",
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
        expiresAt: alertReview.expiresAt,
        savedSearchId: alertReview.review.savedSearchId,
        savedSearchVersion: alertReview.review.savedSearchVersion,
      },
      presentation: {
        title: "Review this job alert",
        confirmLabel: "Verify and turn on",
        facts: expect.arrayContaining([
          { key: "Search", value: expect.stringContaining("platform") },
          { key: "Data", value: "Saved search criteria and delivery email" },
          { key: "Privacy notice", value: "2026-08-29" },
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    expect(JSON.stringify(result)).not.toContain('"review"');
    expect(new TextEncoder().encode(JSON.stringify(result)).byteLength).toBeLessThanOrEqual(1_500);
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

  it("requires the person's exact approval and mailbox code before activation", async () => {
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

    expect(missingCode).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(inventedChannel).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(decideSearchAlert).not.toHaveBeenCalled();

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
      summary: "Job alert activation declined. No schedule was created.",
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
      data: { decision: "declined", scheduleId: null, nextRunAt: null },
    });
  });

  it("uses the authoritative schedule version and synchronizes the visible workspace", async () => {
    const setScheduleEnabled = vi.fn(async () => ({ ...schedule, enabled: false, version: 3 }));
    const onScheduleCommitted = vi.fn();
    const manifests = createSavedToolManifests(
      dependencies({ setScheduleEnabled, onScheduleCommitted }),
    );
    const signal = new AbortController().signal;
    const result = await manifests[3]!.execute(
      { scheduleId: schedule.id, enabled: false },
      { signal },
    );

    expect(setScheduleEnabled).toHaveBeenCalledWith(
      schedule.id,
      { expectedVersion: schedule.version, enabled: false },
      { signal },
    );
    expect(onScheduleCommitted).toHaveBeenCalledWith(expect.objectContaining({ version: 3 }));
    expect(result).toMatchObject({ status: "completed", data: { enabled: false, version: 3 } });
  });

  it("rejects unknown schedules and extra input before mutation", async () => {
    const setScheduleEnabled = vi.fn();
    const manifests = createSavedToolManifests(dependencies({ setScheduleEnabled }));
    const signal = new AbortController().signal;
    const result = await manifests[3]!.execute(
      {
        scheduleId: "schedule_00000002-0000-7000-8000-000000000002",
        enabled: false,
        secret: "no",
      },
      { signal },
    );
    expect(result).toMatchObject({ status: "failed", error: { code: "VALIDATION" } });
    expect(setScheduleEnabled).not.toHaveBeenCalled();
  });
});
