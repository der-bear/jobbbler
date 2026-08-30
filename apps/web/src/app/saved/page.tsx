import type { Metadata } from "next";
import { headers } from "next/headers";
import { Suspense } from "react";

import { SavedWorkspace } from "@/features/saved/saved-workspace";
import { loadInitialSavedWorkspace } from "@/server/initial-saved-workspace";

export const metadata: Metadata = {
  title: "Saved searches",
  description:
    "Save a search once and let Jobbbler keep checking — you hear only about real changes.",
};

export default async function SavedPage() {
  const initialData = await loadInitialSavedWorkspace({
    request: new Request("http://jobbbler.local/saved", { headers: await headers() }),
  });
  return (
    <Suspense fallback={null}>
      <SavedWorkspace initialData={initialData} />
    </Suspense>
  );
}
