import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import PrivacyPage from "./page";

describe("Privacy page", () => {
  it("explains the passwordless workspace, email choices, and agent consent in plain language", () => {
    const markup = renderToStaticMarkup(<PrivacyPage />);

    expect(markup).toContain("Privacy, without the fine-print maze");
    expect(markup).toContain("Saving a search never requires an email");
    expect(markup).toContain("Email updates are optional");
    expect(markup).toContain("one-time code");
    expect(markup).toContain("final decision");
    expect(markup).toContain("withdraw consent");
    expect(markup).toContain('href="/saved"');
    expect(markup).toContain('href="/applications"');
    expect(markup).not.toContain("GDPR compliant");
    expect(markup).not.toContain("anonymous");
  });
});
