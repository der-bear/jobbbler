import { describe, expect, it } from "vitest";

import * as migration from "./import-postgres.js";

const at = "2026-08-29T10:00:00.000Z";

function row(table: string, data: Readonly<Record<string, unknown>>) {
  return { type: "row" as const, table, data };
}

describe("SQLite to PostgreSQL import planning", () => {
  it("canonicalizes PostgreSQL metadata timestamps without rewriting the portable entity body", () => {
    const build = (migration as Record<string, unknown>)["buildSnapshotImportPlan"];
    expect(build).toBeTypeOf("function");
    if (typeof build !== "function") return;

    const compactTimestamp = "2026-08-29T10:00:00Z";
    const plan = build([
      row("jobs", {
        id: "job_timestamp",
        organization_id: "org_timestamp",
        organization_name: "Timestamp Lab",
        title: "Platform Engineer",
        summary: "Build reliable systems",
        categories_json: '["engineering"]',
        work_model: "remote",
        employment_type: "full_time",
        seniority: "senior",
        locations_json: '["Ukraine"]',
        skills_json: '["TypeScript"]',
        salary_minimum: null,
        salary_maximum: null,
        salary_currency: null,
        salary_period: null,
        source_key: "fixture",
        source_label: "Fixture",
        source_url: null,
        apply_mode: "internal",
        status: "open",
        published_at: compactTimestamp,
        updated_at: compactTimestamp,
      }),
    ]) as {
      readonly entities: readonly {
        readonly createdAt: string;
        readonly updatedAt: string;
        readonly body: Record<string, unknown>;
      }[];
    };

    expect(plan.entities[0]).toMatchObject({
      createdAt: at,
      updatedAt: at,
      body: { publishedAt: compactTimestamp, updatedAt: compactTimestamp },
    });
  });

  it("maps aggregate and relational runtime state without losing private continuity", () => {
    const build = (migration as Record<string, unknown>)["buildSnapshotImportPlan"];
    expect(build).toBeTypeOf("function");
    if (typeof build !== "function") return;

    const job = {
      id: "job_1",
      organizationId: "org_1",
      organizationName: "Jobbbler",
      title: "Platform Engineer",
      summary: "Build reliable systems",
      categories: ["engineering"],
      workModel: "remote",
      employmentType: "full_time",
      seniority: "senior",
      locations: ["Ukraine"],
      skills: ["TypeScript"],
      salary: null,
      source: { key: "fixture", label: "Fixture", url: "https://example.com/jobs/1" },
      applyMode: "internal",
      status: "open",
      publishedAt: at,
      updatedAt: at,
    };
    const rows = [
      row("owners", {
        id: "owner_1",
        kind: "guest",
        verified: 1,
        version: 3,
        created_at: at,
        updated_at: at,
      }),
      row("owner_recovery_challenges", {
        id: "recovery_1",
        owner_id: "owner_1",
        endpoint_id: "endpoint_1",
        token_hash: "e".repeat(64),
        status: "pending",
        attempts: 0,
        max_attempts: 5,
        expires_at: at,
        consumed_at: null,
        created_at: at,
        updated_at: at,
      }),
      row("owner_deletion_intents", {
        id: "deletion_1",
        owner_id: "owner_1",
        status: "pending",
        expires_at: at,
        created_at: at,
        updated_at: at,
      }),
      row("jobs", {
        id: "job_1",
        organization_id: "org_1",
        organization_name: "Jobbbler",
        title: "Platform Engineer",
        summary: "Build reliable systems",
        categories_json: '["engineering"]',
        work_model: "remote",
        employment_type: "full_time",
        seniority: "senior",
        locations_json: '["Ukraine"]',
        skills_json: '["TypeScript"]',
        salary_minimum: null,
        salary_maximum: null,
        salary_currency: null,
        salary_period: null,
        source_key: "fixture",
        source_label: "Fixture",
        source_url: "https://example.com/jobs/1",
        apply_mode: "internal",
        status: "open",
        published_at: at,
        updated_at: at,
      }),
      row("saved_searches", {
        id: "search_1",
        owner_id: "owner_1",
        name: "Platform",
        criteria_json: '{"query":"platform"}',
        version: 2,
        created_at: at,
        updated_at: at,
      }),
      row("schedules", {
        id: "schedule_1",
        owner_id: "owner_1",
        saved_search_id: "search_1",
        recurrence_json: '{"kind":"daily","hour":9,"minute":0,"timezone":"Europe/Kyiv"}',
        delivery_channel: "email",
        delivery_endpoint_id: "endpoint_1",
        enabled: 1,
        next_run_at: at,
        version: 1,
        created_at: at,
        updated_at: at,
      }),
      row("alert_evaluations", {
        id: "evaluation_1",
        owner_id: "owner_1",
        saved_search_id: "search_1",
        schedule_id: "schedule_1",
        catalog_updated_at: at,
        created_at: at,
      }),
      row("alert_evaluation_baselines", {
        evaluation_id: "evaluation_1",
        job_id: "job_1",
        fingerprint: "fingerprint-a",
      }),
      row("alert_evaluation_baselines", {
        evaluation_id: "evaluation_1",
        job_id: "job_2",
        fingerprint: "fingerprint-b",
      }),
      row("alert_changes", {
        id: "change_1",
        evaluation_id: "evaluation_1",
        job_id: "job_1",
        kind: "new",
        created_at: at,
      }),
      row("source_records", {
        id: "source_1",
        source_key: "fixture",
        partition: "ua",
        external_id: "1",
        original_url: "https://example.com/jobs/1",
        apply_url: "https://example.com/apply/1",
        source_updated_at: at,
        first_fetched_at: at,
        raw_hash: "a".repeat(64),
        policy_version: 1,
        attribution_label: "Fixture",
        attribution_url: "https://example.com",
        attribution_required: 1,
        followed_link_required: 0,
      }),
      row("source_payloads", {
        source_record_id: "source_1",
        payload_json: '{"title":"Platform Engineer"}',
        retained_until: "2026-09-29T10:00:00.000Z",
      }),
      row("normalization_results", {
        id: "normalization_1",
        source_record_id: "source_1",
        normalizer_version: 2,
        status: "accepted",
        reason: null,
        issues_json: "[]",
        normalized_hash: "b".repeat(64),
        recorded_at: at,
      }),
      row("source_run_records", {
        run_id: "run_1",
        source_record_id: "source_1",
        normalization_result_id: "normalization_1",
        observed_at: at,
      }),
      row("job_versions", {
        id: "version_1",
        job_id: "job_1",
        source_record_id: "source_1",
        normalization_result_id: "normalization_1",
        normalized_hash: "b".repeat(64),
        job_json: JSON.stringify(job),
        observed_at: at,
      }),
      row("job_source_links", {
        job_id: "job_1",
        source_key: "fixture",
        partition: "ua",
        external_id: "1",
        original_url: "https://example.com/jobs/1",
        apply_url: "https://example.com/apply/1",
        identity_basis: "source_id",
        first_seen_at: at,
        last_seen_at: at,
        status: "active",
        missing_complete_runs: 0,
        last_complete_run_id: "run_1",
        latest_source_record_id: "source_1",
        latest_source_updated_at: at,
        latest_raw_hash: "a".repeat(64),
        attribution_label: "Fixture",
        attribution_url: "https://example.com",
        attribution_required: 1,
        followed_link_required: 0,
      }),
      row("application_delegation_records", {
        id: "delegation_1",
        owner_id: "owner_1",
        agent_id: "agent_session_1",
        resource_type: "application_draft",
        resource_id: "application_1",
        operations_json: '["read"]',
        purpose: "Prepare application",
        status: "active",
        expires_at: at,
        created_at: at,
        approved_at: at,
        revoked_at: null,
      }),
      row("application_data_grant_bindings", {
        id: "grant_1",
        owner_id: "owner_1",
        draft_id: "application_1",
        recipient_id: "org_1",
        purpose: "Submit application",
        payload_hash: "c".repeat(64),
        categories_json: '["identity"]',
        field_keys_json: '["fullName"]',
        document_ids_json: "[]",
        notice_version: "1",
        legal_basis: "consent",
        status: "active",
        expires_at: at,
        created_at: at,
        approved_at: at,
        withdrawn_at: null,
        version: 2,
      }),
      row("managed_application_deliveries", {
        id: "managed_delivery_1",
        owner_id: "owner_1",
        draft_id: "application_1",
        review_id: "review_1",
        confirmation_id: "confirmation_1",
        idempotency_key: "submit-once",
        provider: "jobbbler_demo",
        provider_reference_id: "demo_submission_1",
        recipient_id: "org_1",
        recipient_name: "Jobbbler",
        payload_hash: "c".repeat(64),
        fields_json: '[{"fieldKey":"fullName","label":"Full name","value":"Ada","sensitive":true}]',
        status: "acknowledged",
        acknowledged_at: at,
        created_at: at,
      }),
      row("owner_activity_events", {
        sequence: 7,
        id: "activity_1",
        owner_id: "owner_1",
        schema_version: 1,
        kind: "application",
        activity_key: "application.submitted",
        status: "completed",
        safe_summary: "Application submitted",
        correlation_id: "correlation_1",
        actor_kind: "agent",
        aggregate_type: "application_draft",
        aggregate_version: 4,
        occurred_at: at,
        effects_json: '[{"kind":"application_updated","resourceId":"application_1"}]',
      }),
      row("rate_limit_windows", {
        key: "identity:hash-only",
        count: 2,
        reset_at_ms: 1_787_998_000_000,
      }),
      row("application_reviews", {
        id: "legacy_review_1",
        draft_id: "application_1",
        draft_version: 1,
        payload_hash: "d".repeat(64),
        findings_json: "[]",
        created_at: at,
      }),
    ];

    const plan = build(rows) as {
      readonly entities: readonly {
        readonly kind: string;
        readonly id: string;
        readonly ownerId: string | null;
        readonly body: Record<string, unknown>;
      }[];
      readonly ownerActivities: readonly {
        readonly sequence: number;
        readonly id: string;
        readonly ownerId: string;
        readonly effects: readonly unknown[];
      }[];
      readonly rateLimitWindows: readonly {
        readonly key: string;
        readonly count: number;
        readonly resetAtMs: number;
      }[];
      readonly stagedOnlyTables: readonly string[];
      readonly entityCounts: Readonly<Record<string, number>>;
    };

    expect(plan.entityCounts).toMatchObject({
      job: 1,
      saved_search: 1,
      schedule: 1,
      alert_evaluation: 1,
      source_evidence: 1,
      source_run_record: 1,
      job_version: 1,
      job_source_link: 1,
      delegation: 1,
      rich_data_grant: 1,
      managed_application_delivery: 1,
      owner_recovery_challenge: 1,
      owner_deletion_intent: 1,
    });
    expect(plan.entities.find((entity) => entity.kind === "owner")).toMatchObject({
      ownerId: "owner_1",
      body: { id: "owner_1", verified: true, version: 3 },
    });
    expect(
      plan.entities.find((entity) => entity.kind === "alert_evaluation")?.body["baseline"],
    ).toEqual([
      { jobId: "job_1", fingerprint: "fingerprint-a" },
      { jobId: "job_2", fingerprint: "fingerprint-b" },
    ]);
    expect(plan.entities.find((entity) => entity.kind === "alert_change")?.ownerId).toBe("owner_1");
    expect(
      plan.entities.find((entity) => entity.kind === "owner_recovery_challenge"),
    ).toMatchObject({
      ownerId: "owner_1",
      body: { tokenHash: "e".repeat(64), status: "pending" },
    });
    expect(plan.entities.find((entity) => entity.kind === "owner_deletion_intent")).toMatchObject({
      ownerId: "owner_1",
      body: { status: "pending" },
    });
    expect(plan.entities.find((entity) => entity.kind === "source_evidence")?.body).toMatchObject({
      id: "source_1",
      payload: { title: "Platform Engineer" },
      retainedUntil: "2026-09-29T10:00:00.000Z",
      attribution: {
        label: "Fixture",
        url: "https://example.com",
        required: true,
        followedLinkRequired: false,
      },
      normalization: { status: "accepted", normalizerVersion: 2, normalizedHash: "b".repeat(64) },
    });
    expect(plan.entities.find((entity) => entity.kind === "source_run_record")).toMatchObject({
      id: "run_1:source_1",
      body: { id: "run_1:source_1", runId: "run_1", sourceRecordId: "source_1", createdAt: at },
    });
    expect(plan.entities.find((entity) => entity.kind === "job_version")?.body["job"]).toEqual(job);
    expect(plan.entities.find((entity) => entity.kind === "job_source_link")).toMatchObject({
      id: "job_1:fixture:ua:1",
      body: { attributionRequired: true, followedLinkRequired: false },
    });
    expect(plan.entities.find((entity) => entity.kind === "delegation")?.body).toMatchObject({
      agentSessionId: "agent_session_1",
      operations: ["read"],
    });
    expect(plan.entities.find((entity) => entity.kind === "rich_data_grant")?.body).toMatchObject({
      categories: ["identity"],
      fieldKeys: ["fullName"],
      documentIds: [],
      version: 2,
    });
    expect(
      plan.entities.find((entity) => entity.kind === "managed_application_delivery"),
    ).toMatchObject({
      id: "managed_delivery_1",
      ownerId: "owner_1",
      body: {
        providerReferenceId: "demo_submission_1",
        recipientName: "Jobbbler",
        fields: [{ fieldKey: "fullName", label: "Full name", value: "Ada", sensitive: true }],
        acknowledgedAt: at,
      },
    });
    expect(plan.ownerActivities).toEqual([
      {
        sequence: 7,
        id: "activity_1",
        ownerId: "owner_1",
        schemaVersion: 1,
        kind: "application",
        activityKey: "application.submitted",
        status: "completed",
        safeSummary: "Application submitted",
        correlationId: "correlation_1",
        actorKind: "agent",
        aggregateType: "application_draft",
        aggregateVersion: 4,
        occurredAt: at,
        effects: [{ kind: "application_updated", resourceId: "application_1" }],
      },
    ]);
    expect(plan.rateLimitWindows).toEqual([
      { key: "identity:hash-only", count: 2, resetAtMs: 1_787_998_000_000 },
    ]);
    expect(plan.stagedOnlyTables).toContain("application_reviews");
    expect(plan.entities.some((entity) => entity.id === "legacy_review_1")).toBe(false);
  });

  it("blocks cutover when a superseded staged-only legacy table is non-empty", () => {
    const assertImportable = (migration as Record<string, unknown>)["assertSnapshotImportable"];
    expect(assertImportable).toBeTypeOf("function");
    if (typeof assertImportable !== "function") return;
    expect(() =>
      assertImportable({
        entities: [],
        ownerActivities: [],
        rateLimitWindows: [],
        stagedOnlyTables: ["application_reviews"],
        entityCounts: {},
      }),
    ).toThrow(/staged-only legacy/i);
  });
});
