import { handleGetLatestSavedSearchRunRequest } from "@/server/saved-search-route-handlers";
import { getSavedSearchRouteDependencies } from "@/server/saved-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ readonly savedSearchId: string }> },
): Promise<Response> {
  return handleGetLatestSavedSearchRunRequest(request, context, getSavedSearchRouteDependencies());
}
