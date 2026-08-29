import arbeitnowPolicyJson from "../source-policies/arbeitnow.json" with { type: "json" };
import jobicyPolicyJson from "../source-policies/jobicy.json" with { type: "json" };
import remoteOkPolicyJson from "../source-policies/remoteok.json" with { type: "json" };

import { createArbeitnowConnector } from "./arbeitnow/index.js";
import type { JobConnector } from "./contracts.js";
import { createJobicyConnector } from "./jobicy/index.js";
import { sourcePolicySchema, type SourceKey, type SourcePolicy } from "./policy.js";
import { createRemoteOkConnector } from "./remoteok/index.js";
import type { FetchLike } from "./runtime.js";

const policyInputs = {
  jobicy: jobicyPolicyJson,
  remoteok: remoteOkPolicyJson,
  arbeitnow: arbeitnowPolicyJson,
} as const;

export function getBuiltInSourcePolicies(): SourcePolicy[] {
  return (Object.keys(policyInputs) as SourceKey[]).map((sourceKey) =>
    sourcePolicySchema.parse(policyInputs[sourceKey]),
  );
}

export function createCatalogConnectors(fetch: FetchLike): JobConnector[] {
  return getBuiltInSourcePolicies().map((policy) => {
    if (policy.sourceKey === "jobicy") return createJobicyConnector({ policy, fetch });
    if (policy.sourceKey === "remoteok") return createRemoteOkConnector({ policy, fetch });
    return createArbeitnowConnector({ policy, fetch });
  });
}
