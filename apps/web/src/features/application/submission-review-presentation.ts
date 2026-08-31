import type { ApplicationSubmissionReviewRequest } from "@jobbbler/contracts";
import type { JsonValue } from "@jobbbler/webmcp";

import type { UserActionPresentation } from "@/lib/webmcp-tool-result";

export const MAX_APPLICATION_SUBMISSION_REVIEW_RESULT_BYTES = 64 * 1_024;

interface VisibleSubmissionReview extends ApplicationSubmissionReviewRequest {
  readonly href: string;
}

export interface SubmissionReviewPresentation {
  readonly decisionContext: JsonValue;
  readonly presentation: UserActionPresentation;
}

export function buildSubmissionReviewPresentation(
  review: VisibleSubmissionReview,
): SubmissionReviewPresentation {
  const sensitiveFieldCount = review.fields.filter(({ sensitive }) => sensitive).length;
  return {
    decisionContext: {
      draftId: review.draftId,
      draftVersion: review.draftVersion,
      reviewHref: review.href,
      recipient: review.recipient,
      fieldCount: review.fields.length,
      sensitiveFieldCount,
      fields: review.fields,
      noticeVersion: review.noticeVersion,
      expiresAt: review.expiresAt,
    },
    presentation: {
      title: "Review and submit this application?",
      prompt:
        "Show the person the exact values below in the agent client before asking for this final decision. The optional review link opens the same unchanged application.",
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
