import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { Button, Card, Chip, Dialog, Input, Sheet, Skeleton, ToastProvider } from "./index.js";

describe("Jobbbler UI primitives", () => {
  it("renders an unavailable action as a native disabled button", () => {
    const markup = renderToStaticMarkup(
      <Button disabled loading>
        Save role
      </Button>,
    );

    expect(markup).toContain("<button");
    expect(markup).toContain("disabled");
    expect(markup).toContain('aria-busy="true"');
    expect(markup).toContain("Save role");
  });

  it("connects an input label, help text, and invalid state", () => {
    const markup = renderToStaticMarkup(
      <Input
        error="Use a verified address."
        hint="We only send your job alert."
        id="alert-email"
        label="Email address"
      />,
    );

    expect(markup).toContain('for="alert-email"');
    expect(markup).toContain('aria-invalid="true"');
    expect(markup).toContain('aria-describedby="alert-email-hint alert-email-error"');
    expect(markup).toContain("Use a verified address.");
  });

  it("keeps dismissal and overlay surfaces accessible", () => {
    const markup = renderToStaticMarkup(
      <ToastProvider>
        <Chip onRemove={() => undefined}>Remote Europe</Chip>
        <Card title="Why this matches">Evidence stays visible.</Card>
        <Dialog
          description="Review before submitting."
          onOpenChange={() => undefined}
          open
          title="Application review"
        >
          Draft contents
        </Dialog>
        <Sheet
          description="Change search filters."
          onOpenChange={() => undefined}
          open
          title="Filters"
        >
          Filter controls
        </Sheet>
        <Skeleton />
      </ToastProvider>,
    );

    expect(markup).toContain('aria-label="Remove Remote Europe"');
    expect(markup).toContain('role="dialog"');
    expect(markup).toContain('aria-modal="true"');
    expect(markup).toContain('aria-hidden="true"');
  });
});
