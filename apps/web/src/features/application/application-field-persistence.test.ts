import { describe, expect, it, vi } from "vitest";

import type { ApplicationWorkspace } from "@jobbbler/contracts";

import { persistApplicationField } from "./application-field-persistence";

const workspace = {
  draft: {
    id: "application_550e8400-e29b-41d4-a716-446655440000",
    version: 4,
  },
  requirements: [
    {
      fieldKey: "full_name",
      label: "Full name",
      sensitive: true,
    },
  ],
} as ApplicationWorkspace;

describe("persistApplicationField", () => {
  it("stores one human-edited field against the latest application version", async () => {
    const updatedDraft = { ...workspace.draft, version: 5 };
    const request = vi.fn().mockResolvedValue(updatedDraft);

    await expect(
      persistApplicationField({
        workspace,
        fieldKey: "full_name",
        value: "Ada Lovelace",
        request,
      }),
    ).resolves.toBe(updatedDraft);

    expect(request).toHaveBeenCalledWith(
      `/api/v1/applications/${encodeURIComponent(workspace.draft.id)}/answer`,
      expect.anything(),
      {
        method: "POST",
        body: {
          expectedVersion: 4,
          answer: {
            fieldKey: "full_name",
            value: "Ada Lovelace",
            provenance: "user_entered",
            sensitive: true,
            acceptedByHuman: true,
          },
        },
      },
    );
  });

  it("refuses to persist an unknown field", async () => {
    const request = vi.fn();

    await expect(
      persistApplicationField({ workspace, fieldKey: "unknown", value: "x", request }),
    ).rejects.toThrow("Unknown application field");
    expect(request).not.toHaveBeenCalled();
  });
});
