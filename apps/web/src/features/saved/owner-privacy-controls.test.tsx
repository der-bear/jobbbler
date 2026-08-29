import { describe, expect, it, vi } from "vitest";

import { renderToStaticMarkup } from "react-dom/server";

import { OwnerPrivacyControls } from "./owner-privacy-controls";

const owner = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest" as const,
  verified: true,
  recoverable: true,
};

describe("OwnerPrivacyControls", () => {
  it("offers enumeration-safe recovery only when the private session is absent", () => {
    const markup = renderToStaticMarkup(
      <OwnerPrivacyControls owner={null} onDeleted={vi.fn()} onRecovered={vi.fn()} />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Recover workspace");
    expect(markup).toContain("Recover a verified workspace");
    expect(markup).toContain('type="email"');
    expect(markup).toContain("If a verified workspace matches");
    expect(markup).not.toContain("Delete private data");
  });

  it("offers explicit human-only deletion only inside a live private session", () => {
    const markup = renderToStaticMarkup(
      <OwnerPrivacyControls owner={owner} onDeleted={vi.fn()} onRecovered={vi.fn()} />,
    );

    expect(markup).toContain("<details");
    expect(markup).toContain("Privacy &amp; access");
    expect(markup).toContain("Delete private data");
    expect(markup).toContain("DELETE MY PRIVATE DATA");
    expect(markup).not.toContain("Recover a verified workspace");
    expect(markup).not.toContain(owner.id);
  });
});
