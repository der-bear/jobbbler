import type { Metadata } from "next";

import { ApplicationsWorkspace } from "@/features/application/application-list";

export const metadata: Metadata = {
  title: "Applications",
  description: "Continue drafts and view applications you started on Jobbbler.",
};

export default function ApplicationsPage() {
  return <ApplicationsWorkspace />;
}
