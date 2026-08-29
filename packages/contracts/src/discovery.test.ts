import { describe, expect, it } from "vitest";

import { compareJobsInputSchema, jobDetailInputSchema } from "./discovery.js";

const firstId = "job_550e8400-e29b-41d4-a716-446655440000";
const secondId = "job_650e8400-e29b-41d4-a716-446655440000";

describe("job discovery contracts", () => {
  it("accepts strict detail criteria and rejects unrelated fields", () => {
    expect(
      jobDetailInputSchema.parse({ jobId: firstId, criteria: { skills: ["TypeScript"] } }),
    ).toMatchObject({ jobId: firstId, criteria: { skills: ["TypeScript"] } });
    expect(() => jobDetailInputSchema.parse({ jobId: firstId, hidden: true })).toThrow();
  });

  it("limits comparison to three unique jobs", () => {
    expect(compareJobsInputSchema.parse({ jobIds: [firstId, secondId] })).toMatchObject({
      jobIds: [firstId, secondId],
    });
    expect(() => compareJobsInputSchema.parse({ jobIds: [firstId, firstId] })).toThrow();
    expect(() =>
      compareJobsInputSchema.parse({ jobIds: [firstId, secondId, firstId, secondId] }),
    ).toThrow();
  });
});
