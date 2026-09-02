export const searchAlertReviewPolicy = {
  purpose: "Store this search and email matching-job updates.",
  dataCategories: ["saved_search_criteria", "delivery_email"] as const,
  retention: "Kept until you delete this search alert or remove your email.",
  withdrawal: "Stop it any time: pause or delete the alert, or remove your email.",
  privacyNoticeVersion: "search-alert-v1",
} as const;
