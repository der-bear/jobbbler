import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import { EmailVerification, emailVerificationCopy } from "./email-verification";

describe("emailVerificationCopy", () => {
  it("keeps update consent and getting back in as separate intents", () => {
    expect(emailVerificationCopy("updates")).toEqual({
      emailLabel: "Your email",
      verifyLabel: "Verify and continue",
    });
    expect(emailVerificationCopy("device-access")).toEqual({
      emailLabel: "Email to get back in",
      verifyLabel: "Verify",
    });
  });

  it("renders the shared email step with the label for its intent", () => {
    const classNames = { form: "form", hint: "hint" };
    const toErrorMessage = () => "Please try again.";
    const onVerified = vi.fn();
    const updatesMarkup = renderToStaticMarkup(
      <EmailVerification
        classNames={classNames}
        intent="updates"
        onVerified={onVerified}
        toErrorMessage={toErrorMessage}
      />,
    );
    const deviceAccessMarkup = renderToStaticMarkup(
      <EmailVerification
        classNames={classNames}
        intent="device-access"
        onVerified={onVerified}
        toErrorMessage={toErrorMessage}
      />,
    );

    expect(updatesMarkup).toContain("Your email");
    expect(updatesMarkup).toContain("Send code");
    expect(updatesMarkup).not.toContain("Email to get back in");
    expect(deviceAccessMarkup).toContain("Email to get back in");
    expect(deviceAccessMarkup).toContain("Send code");
    expect(deviceAccessMarkup).not.toContain("Your email");
    expect(`${updatesMarkup}${deviceAccessMarkup}`).not.toMatch(
      /workspace|recovery|delivery destination|digest|session/iu,
    );
  });
});
