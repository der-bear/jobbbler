import { handleRequestConfirmation } from "@/server/application-route-handlers";
import { getApplicationRouteDependencies } from "@/server/applications";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(
  request: Request,
  context: { params: Promise<{ draftId: string; reviewId: string }> },
): Promise<Response> {
  return handleRequestConfirmation(request, context, getApplicationRouteDependencies());
}
