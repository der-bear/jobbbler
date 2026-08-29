import { getOwnerActivityRouteDependencies } from "@/server/owner-activity";
import { handleListOwnerActivityRequest } from "@/server/owner-activity-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleListOwnerActivityRequest(request, getOwnerActivityRouteDependencies());
}
