import type { ApplicationSubmissionReviewRequest } from "@jobbbler/contracts";
import type { JsonValue } from "@jobbbler/webmcp";

import type { UserActionPresentation } from "@/lib/webmcp-tool-result";

interface VisibleSubmissionReview extends ApplicationSubmissionReviewRequest {
  readonly href: string;
}

export interface CompactSubmissionReview {
  readonly decisionContext: JsonValue;
  readonly presentation: UserActionPresentation;
}

export function compactSubmissionReview(review: VisibleSubmissionReview): CompactSubmissionReview {
  const sensitiveFieldCount = review.fields.filter(({ sensitive }) => sensitive).length;
  return {
    decisionContext: {
      draftId: review.draftId,
      draftVersion: review.draftVersion,
      reviewHref: review.href,
      recipient: review.recipient,
      fieldCount: review.fields.length,
      sensitiveFieldCount,
      noticeVersion: review.noticeVersion,
      expiresAt: review.expiresAt,
    },
    presentation: {
      title: "Review and submit this application?",
      prompt:
        "Show the person the exact values in the visible review before asking for this final decision. Submission uses only that unchanged review.",
      confirmLabel: "Submit this application",
      facts: [
        { key: "Recipient", value: review.recipient },
        { key: "Purpose", value: review.purpose },
        { key: "Fields", value: review.fields.length },
        { key: "Sensitive fields", value: sensitiveFieldCount },
        { key: "Privacy notice", value: review.noticeVersion },
      ],
    },
  };
}
