import type { JobDetailResult } from "@jobbbler/contracts";
import type { Metadata } from "next";

import { JobDetail } from "@/features/job-detail/job-detail";
import { searchParamsToInput } from "@/lib/search-url";
import { getDiscoveryRouteDependencies } from "@/server/commands";
import { createPublicCommandContext, createRequestId } from "@/server/context";

export const metadata: Metadata = {
  title: "Role details",
  description: "Review one technology role with source, freshness, compensation, and known limits.",
};

async function loadInitialResult(
  jobId: string,
  criteriaSearch: string,
): Promise<JobDetailResult | undefined> {
  try {
    const dependencies = getDiscoveryRouteDependencies();
    const criteria = searchParamsToInput(new URLSearchParams(criteriaSearch));
    return await dependencies.commands.getJob.execute(
      createPublicCommandContext(createRequestId()),
      { jobId, criteria },
    );
  } catch {
    return undefined;
  }
}

export default async function JobDetailPage({
  params,
  searchParams,
}: Readonly<{
  params: Promise<{ readonly jobId: string }>;
  searchParams: Promise<Readonly<Record<string, string | readonly string[] | undefined>>>;
}>) {
  const { jobId } = await params;
  const resolvedSearchParams = await searchParams;
  const serialized = new URLSearchParams();
  for (const [key, value] of Object.entries(resolvedSearchParams)) {
    if (typeof value === "string") serialized.append(key, value);
    else if (value !== undefined) {
      for (const item of value) serialized.append(key, item);
    }
  }
  const criteriaSearch = serialized.size === 0 ? "" : `?${serialized.toString()}`;
  const initialResult = await loadInitialResult(jobId, criteriaSearch);
  return <JobDetail criteriaSearch={criteriaSearch} initialResult={initialResult} jobId={jobId} />;
}
