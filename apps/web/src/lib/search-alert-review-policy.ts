export const searchAlertReviewPolicy = {
  purpose: "Store this search and email matching-job updates.",
  dataCategories: ["saved_search_criteria", "delivery_email"] as const,
  retention: "Stored until the alert or delivery destination is removed.",
  withdrawal: "Pause or delete the alert, or revoke its delivery destination, at any time.",
  privacyNoticeVersion: "search-alert-v1",
} as const;
