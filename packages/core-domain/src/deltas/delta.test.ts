import { describe, expect, it } from "vitest";

import { calculateSearchDeltas } from "./delta.js";

describe("calculateSearchDeltas", () => {
  it("classifies each material difference once in deterministic order", () => {
    expect(
      calculateSearchDeltas({
        previous: [
          { jobId: "job_1", fingerprint: "a" },
          { jobId: "job_2", fingerprint: "b" },
          { jobId: "job_3", fingerprint: "c" },
        ],
        current: [
          { jobId: "job_4", fingerprint: "d", state: "matching" },
          { jobId: "job_2", fingerprint: "changed", state: "matching" },
          { jobId: "job_3", fingerprint: "c", state: "closed" },
          { jobId: "job_1", fingerprint: "a", state: "no_longer_matching" },
        ],
      }),
    ).toEqual({
      deltas: [
        { jobId: "job_4", kind: "new" },
        { jobId: "job_2", kind: "updated" },
        { jobId: "job_3", kind: "closed" },
        { jobId: "job_1", kind: "no_longer_matching" },
      ],
      shouldNotify: true,
    });
  });

  it("suppresses a first baseline and a no-change evaluation by default", () => {
    expect(
      calculateSearchDeltas({
        previous: null,
        current: [{ jobId: "job_1", fingerprint: "a", state: "matching" }],
      }),
    ).toEqual({ deltas: [], shouldNotify: false });

    expect(
      calculateSearchDeltas({
        previous: [{ jobId: "job_1", fingerprint: "a" }],
        current: [{ jobId: "job_1", fingerprint: "a", state: "matching" }],
      }),
    ).toEqual({ deltas: [], shouldNotify: false });
  });

  it("can explicitly notify a no-change run", () => {
    expect(
      calculateSearchDeltas({
        previous: [{ jobId: "job_1", fingerprint: "a" }],
        current: [{ jobId: "job_1", fingerprint: "a", state: "matching" }],
        notifyOnNoChanges: true,
      }).shouldNotify,
    ).toBe(true);
  });

  it("rejects ambiguous duplicate records rather than choosing an arbitrary state", () => {
    expect(() =>
      calculateSearchDeltas({
        previous: [{ jobId: "job_1", fingerprint: "a" }],
        current: [
          { jobId: "job_1", fingerprint: "a", state: "matching" },
          { jobId: "job_1", fingerprint: "b", state: "matching" },
        ],
      }),
    ).toThrow("duplicate job ID");
  });
});
