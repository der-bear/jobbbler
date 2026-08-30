import type { Metadata } from "next";
import { headers } from "next/headers";

import { ApplicationsWorkspace } from "@/features/application/application-list";
import { loadInitialApplications } from "@/server/initial-applications";

export const metadata: Metadata = {
  title: "Applications",
  description: "Continue drafts and view applications you started on Jobbbler.",
};

export default async function ApplicationsPage() {
  const initialItems = await loadInitialApplications({
    request: new Request("http://jobbbler.local/applications", { headers: await headers() }),
  });
  return <ApplicationsWorkspace initialItems={initialItems} />;
}
