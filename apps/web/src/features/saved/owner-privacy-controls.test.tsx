import { describe, expect, it, vi } from "vitest";

import { renderToStaticMarkup } from "react-dom/server";

import { OwnerPrivacyControls } from "./owner-privacy-controls";

const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
};

describe("OwnerPrivacyControls", () => {
  it("offers content-neutral recovery only when the private session is absent", () => {
    const markup = renderToStaticMarkup(
      <OwnerPrivacyControls
        hasVerifiedRecoveryEmail={false}
        owner={null}
        onDeleted={vi.fn()}
        onRecovered={vi.fn()}
        onRecoveryEmailEnabled={vi.fn()}
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Restore with email");
    expect(markup).toContain("Restore your Jobbbler work");
    expect(markup).toContain('type="email"');
    expect(markup).toContain("Recovery email");
    expect(markup).toContain("Enter the email you verified before");
    expect(markup).toContain("We’ll send a six-digit code");
    expect(markup).not.toContain("agent");
    expect(markup).not.toContain("workspace matched");
    expect(markup).not.toContain("never reveals whether an account exists");
    expect(markup).not.toContain("Delete private data");
  });

  it("offers explicit human-only deletion only inside a live private session", () => {
    const markup = renderToStaticMarkup(
      <OwnerPrivacyControls
        hasVerifiedRecoveryEmail
        owner={owner}
        onDeleted={vi.fn()}
        onRecovered={vi.fn()}
        onRecoveryEmailEnabled={vi.fn()}
      />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Your data");
    expect(markup).toContain("<strong>Delete private data</strong>");
    expect(markup).toContain("DELETE MY PRIVATE DATA");
    expect(markup).not.toContain("Add your email");
    expect(markup).not.toContain("Recover a verified workspace");
    expect(markup).not.toContain(owner.id);
  });

  it("offers optional recovery setup without replacing a live ephemeral session", () => {
    const markup = renderToStaticMarkup(
      <OwnerPrivacyControls
        hasVerifiedRecoveryEmail={false}
        owner={{ ...owner, kind: "ephemeral", verified: false }}
        onDeleted={vi.fn()}
        onRecovered={vi.fn()}
        onRecoveryEmailEnabled={vi.fn()}
      />,
    );

    expect(markup).toContain("<strong>Delete private data</strong>");
    expect(markup).toContain("Get back in from another device");
    expect(markup).toContain("Add your email");
    expect(markup).toContain("Email to get back in");
    expect(markup).toContain("This does not turn on email updates");
    expect(markup).not.toContain("Restore with email");
    expect(markup).toContain('type="email"');
  });
});
