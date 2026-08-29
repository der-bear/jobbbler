import { JobDetail } from "@/features/job-detail/job-detail";

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
  return <JobDetail criteriaSearch={criteriaSearch} jobId={jobId} />;
}
