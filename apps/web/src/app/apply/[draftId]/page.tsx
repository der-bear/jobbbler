import { ApplicationWorkspace } from "@/features/application/application-workspace";

export default async function ApplicationPage({
  params,
}: Readonly<{ params: Promise<{ draftId: string }> }>) {
  const { draftId } = await params;
  return <ApplicationWorkspace key={draftId} draftId={draftId} />;
}
