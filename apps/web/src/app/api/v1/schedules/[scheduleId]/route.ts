import { handleUpdateScheduleRequest } from "@/server/saved-search-route-handlers";
import { getSavedSearchRouteDependencies } from "@/server/saved-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function PATCH(
  request: Request,
  context: { readonly params: Promise<{ readonly scheduleId: string }> },
): Promise<Response> {
  return handleUpdateScheduleRequest(request, context, getSavedSearchRouteDependencies());
}
