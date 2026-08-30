import { headers } from "next/headers";

import { SearchWorkspace } from "@/features/search/search-workspace";
import type { PageSearchParams } from "@/features/search/initial-search-state";
import { loadInitialSearch } from "@/server/initial-search";

export default async function HomePage({
  searchParams,
}: Readonly<{ searchParams: Promise<PageSearchParams> }>) {
  const initialSearch = await loadInitialSearch(await searchParams, {
    request: new Request("http://jobbbler.local/", { headers: await headers() }),
  });
  return <SearchWorkspace initialSearch={initialSearch} mode="home" />;
}
