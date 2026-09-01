import type { Metadata } from "next";
import { headers } from "next/headers";
import { SavedWorkspace } from "@/features/saved/saved-workspace";
import { loadInitialSavedWorkspace } from "@/server/initial-saved-workspace";

export const metadata: Metadata = {
  title: "Saved searches",
  description:
    "Save a search once and let Jobbbler keep checking — you hear only about real changes.",
};

/*
 * The query string comes in as a page prop and goes to the workspace as one.
 * Reading it on the client with `useSearchParams` made the workspace suspend
 * for a beat during hydration, and the `fallback={null}` around it unmounted
 * the whole page for that beat — measured at 375px, the footer jumped 900px
 * and back, a layout shift of 0.34. Nothing here needs to suspend.
 */
export default async function SavedPage({
  searchParams,
}: Readonly<{ searchParams: Promise<Record<string, string | string[] | undefined>> }>) {
  const [initialData, query] = await Promise.all([
    loadInitialSavedWorkspace({
      request: new Request("http://jobbbler.local/saved", { headers: await headers() }),
    }),
    searchParams,
  ]);
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (typeof value === "string") parameters.set(key, value);
    else if (Array.isArray(value)) for (const item of value) parameters.append(key, item);
  }
  return <SavedWorkspace initialData={initialData} searchParamsKey={parameters.toString()} />;
}
