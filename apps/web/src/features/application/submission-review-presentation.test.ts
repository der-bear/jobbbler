import { describe, expect, it } from "vitest";

import type { ApplicationSubmissionReviewRequest } from "./webmcp-tools";
import { compactSubmissionReview } from "./submission-review-presentation";

const review: ApplicationSubmissionReviewRequest = {
  id: "interaction_550e8400-e29b-41d4-a716-446655440000",
  draftId: "application_550e8400-e29b-41d4-a716-446655440000",
  draftVersion: 3,
  recipient: "Northstar Systems",
  purpose: "Submit this reviewed application to Northstar Systems.",
  fields: [
    {
      fieldKey: "email",
      label: "Email",
      value: "ada@example.com",
      sensitive: true,
    },
    {
      fieldKey: "motivation",
      label: "Why this role",
      value: "x".repeat(10_000),
      sensitive: false,
    },
  ],
  noticeVersion: "privacy-2026-08",
  expiresAt: "2026-08-30T08:05:00.000Z",
  href: "/apply/application_550e8400-e29b-41d4-a716-446655440000",
};

describe("compactSubmissionReview", () => {
  it("references the exact visible review without returning private field values", () => {
    const result = compactSubmissionReview(review);

    expect(result).toMatchObject({
      decisionContext: {
        draftId: review.draftId,
        draftVersion: review.draftVersion,
        reviewHref: review.href,
        fieldCount: 2,
        sensitiveFieldCount: 1,
        noticeVersion: review.noticeVersion,
        expiresAt: review.expiresAt,
      },
      presentation: {
        title: "Review and submit this application?",
        prompt: expect.stringContaining("visible review"),
        confirmLabel: "Submit this application",
        facts: expect.arrayContaining([
          { key: "Recipient", value: review.recipient },
          { key: "Purpose", value: review.purpose },
          { key: "Fields", value: 2 },
          { key: "Sensitive fields", value: 1 },
        ]),
      },
    });
    expect(JSON.stringify(result)).not.toContain("ada@example.com");
    expect(JSON.stringify(result)).not.toContain("x".repeat(100));
  });
});
