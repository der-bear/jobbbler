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
  const employerUrl = externalApplicationUrl(job);
  if (!supportsJobbblerPreparation(job)) {
    return {
      jobId: job.id,
      applyMode: job.applyMode,
      preparationAvailable: false,
      stages: [],
      agentAccess:
        "Unavailable: Jobbbler does not create an application resource for external roles.",
      humanSteps: [
        employerUrl === null
          ? "The employer application page is unavailable; do not continue from Jobbbler"
          : "Continue on the validated HTTPS employer application page",
      ],
      submission:
        "Jobbbler creates no draft, receipt, handoff record, or submitted claim for this external role.",
      employerSite: {
        required: true,
        target: externalTarget(job),
        available: employerUrl !== null,
      },
      withdrawalSupported: false,
      statusSyncSupported: false,
    };
  }

  return {
    jobId: job.id,
    applyMode: job.applyMode,
    preparationAvailable: true,
    stages: ["private_draft", "assistance_decision", "application_review", "submission_decision"],
    agentAccess:
      "Assistance requires the person's decision in the external agent client; the server accepts only the exact live request and records request-bound evidence.",
    humanSteps: [
      "Review or correct the answers the agent prepared",
      "Decide on the exact disclosure and submission in the external agent client",
      "Withdraw active consent from the same agent workflow when needed",
    ],
    submission:
      "Jobbbler submits only the unchanged internal-demo payload after an explicit request-bound decision in the external agent client; approval is single-use and expires in fifteen minutes.",
    employerSite: { required: false },
    withdrawalSupported: true,
    statusSyncSupported: false,
  };
}

export function applicationCapabilitySummary(job: Job): string {
  if (job.applyMode === "internal") {
    return "Internal application: an agent may prepare it; the person makes request-bound assistance and submission decisions in the external agent client.";
  }
  return externalApplicationUrl(job) === null
    ? "External role: the employer's application page is unavailable."
    : "External role: continue on the employer's website; Jobbbler does not submit it.";
}
