export const searchAlertReviewPolicy = {
  purpose: "Store this search and email matching-job updates.",
  dataCategories: ["saved_search_criteria", "delivery_email"] as const,
  retention: "Used only while this search alert is on and your email is attached.",
  withdrawal: "Stop it any time: pause or delete the alert, or remove your email.",
  privacyNoticeVersion: "search-alert-v2",
} as const;
