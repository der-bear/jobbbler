import type { Job } from "@jobbbler/contracts";
import type { JsonValue } from "@jobbbler/webmcp";

export function supportsJobbblerPreparation(job: Job): boolean {
  return job.applyMode === "internal";
}

export function externalApplicationUrl(job: Job): string | null {
  if (job.applyMode !== "external") return null;
  if (job.source.url === null) return null;
  try {
    const source = new URL(job.source.url);
    return source.protocol === "https:" &&
      source.username.length === 0 &&
      source.password.length === 0
      ? source.href
      : null;
  } catch {
    return null;
  }
}

function externalTarget(job: Job): string | null {
  if (job.source.url === null) return null;
  try {
    return new URL(job.source.url).hostname;
  } catch {
    return null;
  }
}

/**
 * Machine-readable answer to "how does this role accept applications?" so an
 * agent can negotiate capabilities before starting a workflow. Every claim maps
 * to implemented behavior; nothing here is aspirational.
 */
export function applicationCapabilityData(job: Job): JsonValue {
  const prepared = supportsJobbblerPreparation(job);
  const employerUrl = externalApplicationUrl(job);
  return {
    jobId: job.id,
    applyMode: job.applyMode,
    preparationAvailable: prepared,
    stages: ["your_details", "review", "data_permission", "final_confirmation"],
    agentAccess:
      "Draft-bound, stage-scoped, expiring delegation; requested by the agent and approved only in the private workspace.",
    humanSteps: [
      "Accept or edit every suggested answer",
      "Approve the exact data disclosure",
      "Give the final confirmation (single-use, expires in five minutes)",
    ],
    submission:
      job.applyMode === "internal"
        ? "Submitted by Jobbbler after a fresh human confirmation; material edits invalidate the review."
        : "Never submitted externally: Jobbbler prepares the package and records an honest handoff.",
    employerSite:
      job.applyMode === "external"
        ? { required: true, target: externalTarget(job), available: employerUrl !== null }
        : { required: false },
    withdrawalSupported: false,
    statusSyncSupported: false,
  };
}

export function applicationCapabilitySummary(job: Job): string {
  if (job.applyMode === "internal") {
    return "Internal application: an agent may prepare it; sharing and the final confirmation stay with the human.";
  }
  return externalApplicationUrl(job) === null
    ? "External role: the employer's application page is unavailable."
    : "External role: continue on the employer's website; Jobbbler does not submit it.";
}
