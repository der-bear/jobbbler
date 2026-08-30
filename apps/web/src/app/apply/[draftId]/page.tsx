import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";

import { isDomainError } from "@jobbbler/core-domain";

import { ApplicationWorkspace } from "@/features/application/application-workspace";
import { loadInitialApplication, type InitialApplication } from "@/server/initial-application";

export const metadata: Metadata = {
  title: "Application review",
  description: "Review one private Jobbbler application and keep the final decision yours.",
  robots: { index: false, follow: false },
};

export default async function ApplicationPage({
  params,
}: Readonly<{ params: Promise<{ draftId: string }> }>) {
  const { draftId } = await params;
  let initial: InitialApplication | null;
  try {
    initial = await loadInitialApplication(draftId, {
      request: new Request(`http://jobbbler.local/apply/${encodeURIComponent(draftId)}`, {
        headers: await headers(),
      }),
    });
  } catch (error) {
    if (isDomainError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
  return <ApplicationWorkspace initial={initial} key={draftId} draftId={draftId} />;
}
