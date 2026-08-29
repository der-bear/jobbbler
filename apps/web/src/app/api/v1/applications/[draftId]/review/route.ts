import { handleApplicationCommand } from "@/server/application-route-handlers";
import { getApplicationRouteDependencies } from "@/server/applications";
export const runtime = "nodejs";
export async function POST(request: Request, context: { params: Promise<{ draftId: string }> }) {
  return handleApplicationCommand(request, context, getApplicationRouteDependencies(), "review");
}
