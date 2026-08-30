import { describe, expect, it } from "vitest";

import { privateAccessCopy } from "./saved-workspace";

describe("privateAccessCopy", () => {
  it("explains the no-account state before private work exists", () => {
    expect(privateAccessCopy(null)).toEqual({
      eyebrow: "No account required",
      title: "Save an alert without signing up",
      description:
        "Turning on an alert saves it privately in this browser. Verify an email to receive updates and restore your alerts elsewhere.",
    });
  });

  it("warns when the current browser is the only recovery path", () => {
    expect(
      privateAccessCopy({
        id: "owner_550e8400-e29b-41d4-a716-446655440000",
        kind: "ephemeral",
        verified: false,
        recoverable: false,
      }),
    ).toEqual({
      eyebrow: "Saved in this browser",
      title: "Verify an email for delivery",
      description:
        "This browser is the only way back to your saved work. Verification lets Jobbbler email updates and restore access elsewhere.",
    });
  });

  it("explains email recovery without calling it a backup", () => {
    expect(
      privateAccessCopy({
        id: "owner_550e8400-e29b-41d4-a716-446655440000",
        kind: "guest",
        verified: true,
        recoverable: true,
      }),
    ).toEqual({
      eyebrow: "Verified email",
      title: "Alerts can be recovered",
      description:
        "Your verified address receives updates and can restore your alerts on another device. It is never exposed to agents.",
    });
  });
});
