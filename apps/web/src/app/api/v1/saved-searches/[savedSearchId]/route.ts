import { handleDeleteSavedSearchRequest } from "@/server/saved-search-route-handlers";
import { getSavedSearchRouteDependencies } from "@/server/saved-searches";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ readonly savedSearchId: string }> },
): Promise<Response> {
  return handleDeleteSavedSearchRequest(request, context, getSavedSearchRouteDependencies());
}
