import { describe, expect, it } from "vitest";

import type {
  JobAlertSchedule,
  OwnerSummary,
  VerificationEndpointSummary,
} from "@jobbbler/contracts";

import {
  privateAccessCopy,
  savedComposerPresentation,
  scheduleFormValues,
  scheduleReviewChanges,
} from "./saved-workspace";

const owner: OwnerSummary = {
  id: "owner_550e8400-e29b-41d4-a716-446655440000",
  kind: "guest",
  verified: true,
};

function endpoint(
  status: VerificationEndpointSummary["status"],
  suffix: string = "0000",
): VerificationEndpointSummary {
  return {
    id: `endpoint_550e8400-e29b-41d4-a716-44665544${suffix}`,
    kind: "email",
    maskedDestination: "p•••••@example.com",
    status,
    verifiedAt: status === "verified" ? "2026-08-30T10:00:00.000Z" : null,
  };
}

const browserOnlyCopy = {
  eyebrow: "Private workspace",
  title: "Saved on this device",
  description:
    "Your saved searches and applications stay private to this browser. Add email only for updates or access on another device.",
};

const recoverableCopy = {
  eyebrow: "Verified email",
  title: "Access from another device",
  description:
    "Use your verified email to restore saved searches and applications. Search updates are still optional.",
};

describe("privateAccessCopy", () => {
  it("explains the no-account state before private work exists", () => {
    expect(privateAccessCopy(null, [])).toEqual({
      eyebrow: "Private workspace",
      title: "No account needed",
      description:
        "This browser can keep saved searches and applications. Add email only for updates or access on another device.",
    });
  });

  it("warns when the current browser is the only recovery path", () => {
    expect(
      privateAccessCopy(
        {
          id: "owner_550e8400-e29b-41d4-a716-446655440000",
          kind: "ephemeral",
          verified: false,
        },
        [],
      ),
    ).toEqual(browserOnlyCopy);
  });

  it("explains recovery only when a current endpoint is verified", () => {
    expect(privateAccessCopy(owner, [endpoint("verified")])).toEqual(recoverableCopy);
  });

  it("does not claim recovery while an endpoint is pending", () => {
    expect(privateAccessCopy(owner, [endpoint("pending")])).toEqual(browserOnlyCopy);
  });

  it("stops claiming recovery after the last verified endpoint is revoked", () => {
    expect(privateAccessCopy(owner, [endpoint("verified")])).toEqual(recoverableCopy);
    expect(privateAccessCopy(owner, [endpoint("revoked")])).toEqual(browserOnlyCopy);
  });

  it("remains recoverable while a mixed endpoint set still has one verified endpoint", () => {
    expect(
      privateAccessCopy(owner, [
        endpoint("pending", "0001"),
        endpoint("revoked", "0002"),
        endpoint("verified", "0003"),
      ]),
    ).toEqual(recoverableCopy);
  });
});

const weeklySchedule: JobAlertSchedule = {
  id: "schedule_550e8400-e29b-41d4-a716-446655440000",
  ownerId: owner.id,
  savedSearchId: "saved_search_550e8400-e29b-41d4-a716-446655440000",
  recurrence: {
    frequency: "weekly",
    time: "09:00",
    timeZone: "Europe/Kyiv",
    days: ["monday", "wednesday", "friday"],
  },
  delivery: { channel: "email", endpointId: endpoint("verified").id },
  enabled: true,
  nextRunAt: "2026-08-31T06:00:00.000Z",
  version: 2,
  createdAt: "2026-08-30T10:00:00.000Z",
  updatedAt: "2026-08-30T10:00:00.000Z",
};

describe("email-update schedule editing", () => {
  it("prefills every editable value from the current schedule", () => {
    expect(scheduleFormValues(weeklySchedule)).toEqual({
      frequency: "weekly",
      time: "09:00",
      timeZone: "Europe/Kyiv",
      days: ["monday", "wednesday", "friday"],
      endpointId: endpoint("verified").id,
    });
  });

  it("describes only the values that will change", () => {
    expect(
      scheduleReviewChanges(
        weeklySchedule,
        { frequency: "daily", time: "10:30", timeZone: "Europe/Kyiv" },
        weeklySchedule.delivery.endpointId,
        "p•••••@example.com",
        "p•••••@example.com",
      ),
    ).toEqual([
      {
        label: "Schedule",
        previous: "Weekly on Mon, Wed, Fri at 09:00 (Europe/Kyiv)",
        next: "Daily at 10:30 (Europe/Kyiv)",
      },
    ]);
  });

  it("includes a destination change without repeating an unchanged schedule", () => {
    expect(
      scheduleReviewChanges(
        weeklySchedule,
        weeklySchedule.recurrence,
        "endpoint_550e8400-e29b-41d4-a716-446655440001",
        "p•••••@example.com",
        "n•••@example.com",
      ),
    ).toEqual([
      {
        label: "Destination",
        previous: "p•••••@example.com",
        next: "n•••@example.com",
      },
    ]);
  });
});

describe("saved-search composer", () => {
  it("treats adding updates to an existing saved search as a distinct task", () => {
    expect(
      savedComposerPresentation({
        hasExistingSavedSearch: true,
        isEditingSchedule: false,
      }),
    ).toEqual({
      title: "Add email updates",
      showSearchSetup: false,
    });
  });

  it("keeps first-time saving and schedule editing in their own modes", () => {
    expect(
      savedComposerPresentation({
        hasExistingSavedSearch: false,
        isEditingSchedule: false,
      }),
    ).toEqual({
      title: "Save this search",
      showSearchSetup: true,
    });
    expect(
      savedComposerPresentation({
        hasExistingSavedSearch: true,
        isEditingSchedule: true,
      }),
    ).toEqual({
      title: "Edit email updates",
      showSearchSetup: false,
    });
  });
});
