import { createHash } from "node:crypto";

import sanitizeHtml from "sanitize-html";

import {
  jobSchema,
  type EmploymentType,
  type JobCategory,
  type SalaryRange,
  type Seniority,
  type WorkModel,
} from "@jobbbler/contracts";

import type { NormalizationResult, RawSourceRecord } from "./contracts.js";
import type { SourcePolicy } from "./policy.js";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value !== "object" || value === null) return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, item]) => [key, canonicalize(item)]),
  );
}

export function stableJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function hashRawPayload(value: unknown): string {
  return createHash("sha256").update(stableJson(value)).digest("hex");
}

export function deterministicEntityId(prefix: string, identity: string): string {
  const hash = createHash("sha256").update(identity).digest("hex").slice(0, 32).split("");
  hash[12] = "7";
  hash[16] = "8";
  const uuid = `${hash.slice(0, 8).join("")}-${hash.slice(8, 12).join("")}-${hash.slice(12, 16).join("")}-${hash.slice(16, 20).join("")}-${hash.slice(20, 32).join("")}`;
  return `${prefix}_${uuid}`;
}

export function toHttpsUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function plainText(value: unknown, maximumLength: number): string {
  if (typeof value !== "string") return "";
  const stripped = sanitizeHtml(value, {
    allowedTags: [],
    allowedAttributes: {},
    nonTextTags: ["script", "style", "textarea", "option", "noscript", "iframe"],
  })
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/gu, " ")
    .trim();
  if (stripped.length <= maximumLength) return stripped;
  const clipped = stripped.slice(0, maximumLength - 1);
  const boundary = clipped.lastIndexOf(" ");
  return `${clipped.slice(0, boundary > maximumLength * 0.7 ? boundary : undefined).trim()}…`;
}

function slugify(value: string): string {
  const slug = value
    .normalize("NFKD")
    .replace(/\p{Diacritic}/gu, "")
    .toLocaleLowerCase("en")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : "organization";
}

export function classifyTechCategories(signals: readonly string[]): JobCategory[] {
  const text = signals.join(" ").normalize("NFKC").toLocaleLowerCase("en");
  const categories = new Set<JobCategory>();
  const addWhen = (category: JobCategory, pattern: RegExp) => {
    if (pattern.test(text)) categories.add(category);
  };

  addWhen("security", /\b(?:security|appsec|cyber|threat|iam)\b/u);
  addWhen("data_ai", /\b(?:data|analytics?|machine learning|ml|artificial intelligence|ai)\b/u);
  addWhen("product", /\b(?:product manager|product designer|product analyst|product lead)\b/u);
  addWhen("design_research", /\b(?:design|designer|ux|ui|user research|researcher)\b/u);
  addWhen(
    "quality_assurance",
    /\b(?:quality assurance|quality engineer|qa|test automation|sdet)\b/u,
  );
  addWhen(
    "developer_relations",
    /\b(?:developer relations|developer advocate|devrel|technical writer|developer experience)\b/u,
  );
  addWhen(
    "technical_support_success",
    /\b(?:technical support|support engineer|customer engineer|customer success engineer)\b/u,
  );
  addWhen(
    "technical_recruiting",
    /\b(?:technical recruiter|technical recruiting|talent partner|engineering recruiter)\b/u,
  );
  addWhen(
    "tech_operations_sales",
    /\b(?:sales engineer|solutions engineer|solution architect|technical account|technical operations|revenue operations)\b/u,
  );
  addWhen(
    "infrastructure",
    /\b(?:devops|site reliability|sre|cloud|platform engineer|infrastructure|kubernetes|terraform)\b/u,
  );
  addWhen(
    "software_engineering",
    /\b(?:software|engineer|developer|frontend|front-end|backend|back-end|full[ -]stack|programmer)\b/u,
  );

  return [...categories].slice(0, 4);
}

export function inferSeniority(signals: readonly string[]): Seniority | null {
  const text = signals.join(" ").toLocaleLowerCase("en");
  const levels: readonly [Seniority, RegExp][] = [
    ["executive", /\b(?:chief|vp|vice president|executive)\b/u],
    ["director", /\bdirector\b/u],
    ["manager", /\bmanager\b/u],
    ["principal", /\bprincipal\b/u],
    ["staff", /\bstaff\b/u],
    ["lead", /\blead\b/u],
    ["senior", /\b(?:senior|sr\.?|mid-senior)\b/u],
    ["entry", /\b(?:entry|junior|jr\.?)\b/u],
    ["mid", /\bmid(?:dle)?\b/u],
  ];
  return levels.find(([, pattern]) => pattern.test(text))?.[0] ?? null;
}

export function inferEmploymentType(signals: readonly string[]): EmploymentType {
  const text = signals.join(" ").toLocaleLowerCase("en").replaceAll("-", "_");
  if (/\bpart_time\b/u.test(text)) return "part_time";
  if (/\b(?:contract|temporary)\b/u.test(text)) return "contract";
  if (/\bfreelance\b/u.test(text)) return "freelance";
  if (/\bintern(?:ship)?\b/u.test(text)) return "internship";
  return "full_time";
}

export interface RawRecordInput {
  readonly policy: SourcePolicy;
  readonly partition: string;
  readonly externalId: string;
  readonly originalUrl: string;
  readonly applyUrl: string;
  readonly sourceUpdatedAt: string | null;
  readonly fetchedAt: string;
  readonly payload: unknown;
}

export function createRawSourceRecord(input: RawRecordInput): RawSourceRecord {
  const retainUntil = new Date(
    Date.parse(input.fetchedAt) + input.policy.rawPayloadRetentionDays * 24 * 60 * 60 * 1_000,
  ).toISOString();
  return {
    sourceKey: input.policy.sourceKey,
    partition: input.partition,
    externalId: input.externalId,
    originalUrl: input.originalUrl,
    applyUrl: input.applyUrl,
    sourceUpdatedAt: input.sourceUpdatedAt,
    fetchedAt: input.fetchedAt,
    retainUntil,
    rawHash: hashRawPayload(input.payload),
    payload: input.payload,
    policyVersion: input.policy.version,
    attribution: input.policy.attribution,
    actionCapability: "external_only",
  };
}

export interface NormalizedListingInput {
  readonly record: RawSourceRecord;
  readonly companyName: unknown;
  readonly companyWebsite?: unknown;
  readonly title: unknown;
  readonly summaryHtml: unknown;
  readonly categorySignals: readonly string[];
  readonly workModel: WorkModel;
  readonly employmentSignals: readonly string[];
  readonly senioritySignals: readonly string[];
  readonly locations: readonly string[];
  readonly salary: SalaryRange | null;
  readonly publishedAt: string | null;
}

export function normalizeListing(input: NormalizedListingInput): NormalizationResult {
  const title = plainText(input.title, 180);
  const companyName = plainText(input.companyName, 160);
  const summary = plainText(input.summaryHtml, 2_000);
  const originalUrl = toHttpsUrl(input.record.originalUrl);
  const applyUrl = toHttpsUrl(input.record.applyUrl) ?? originalUrl;
  if (
    title.length === 0 ||
    companyName.length === 0 ||
    summary.length === 0 ||
    originalUrl === null ||
    applyUrl === null
  ) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: ["Required listing text or HTTPS URLs are missing."],
    };
  }

  const categories = classifyTechCategories([title, ...input.categorySignals]);
  if (categories.length === 0) {
    return {
      accepted: false,
      reason: "outside_tech_taxonomy",
      validationIssues: [],
    };
  }

  const organizationId = deterministicEntityId(
    "org",
    `${input.record.sourceKey}:organization:${companyName.toLocaleLowerCase("en")}`,
  );
  const job = jobSchema.safeParse({
    id: deterministicEntityId(
      "job",
      `${input.record.sourceKey}:${input.record.partition}:${input.record.externalId}`,
    ),
    organizationId,
    organizationName: companyName,
    title,
    summary,
    categories,
    workModel: input.workModel,
    employmentType: inferEmploymentType(input.employmentSignals),
    seniority: inferSeniority([title, ...input.senioritySignals]),
    locations: input.locations
      .map((location) => plainText(location, 120))
      .filter(Boolean)
      .slice(0, 8),
    skills: input.categorySignals
      .map((skill) => plainText(skill, 80))
      .filter(Boolean)
      .slice(0, 30),
    salary: input.salary,
    source: {
      key: input.record.sourceKey,
      label: input.record.attribution.label,
      url: originalUrl,
    },
    applyMode: "external",
    status: "open",
    publishedAt: input.publishedAt ?? input.record.fetchedAt,
    updatedAt: input.record.sourceUpdatedAt ?? input.publishedAt ?? input.record.fetchedAt,
  });
  if (!job.success) {
    return {
      accepted: false,
      reason: "invalid_record",
      validationIssues: job.error.issues.map((issue) => issue.message).slice(0, 8),
    };
  }

  return {
    accepted: true,
    organization: {
      id: organizationId,
      name: companyName,
      slug: `${slugify(companyName)}-${organizationId.slice(-8)}`,
      website: toHttpsUrl(input.companyWebsite),
      description: `Organization represented by an attributed ${input.record.attribution.label} listing.`,
      createdAt: input.record.fetchedAt,
      updatedAt: input.record.fetchedAt,
    },
    job: job.data,
    sourceLink: {
      sourceKey: input.record.sourceKey,
      partition: input.record.partition,
      externalId: input.record.externalId,
      originalUrl,
      applyUrl,
      rawHash: input.record.rawHash,
      identityBasis: "source_id",
    },
  };
}
