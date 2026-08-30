import type { Metadata } from "next";
import { headers } from "next/headers";

import { SearchWorkspace } from "@/features/search/search-workspace";
import type { PageSearchParams } from "@/features/search/initial-search-state";
import { loadInitialSearch } from "@/server/initial-search";

export const metadata: Metadata = {
  title: "Technology jobs",
  description: "Search explainable technology roles by the work, location, and terms that matter.",
};

export default async function JobsPage({
  searchParams,
}: Readonly<{ searchParams: Promise<PageSearchParams> }>) {
  const initialSearch = await loadInitialSearch(await searchParams, {
    request: new Request("http://jobbbler.local/jobs", { headers: await headers() }),
  });
  return <SearchWorkspace initialSearch={initialSearch} mode="catalog" />;
}
