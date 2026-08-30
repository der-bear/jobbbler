import { getOwnerActivityRouteDependencies } from "@/server/owner-activity";
import {
  handleClearOwnerActivityRequest,
  handleListOwnerActivityRequest,
} from "@/server/owner-activity-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleListOwnerActivityRequest(request, getOwnerActivityRouteDependencies());
}

export async function DELETE(request: Request): Promise<Response> {
  return handleClearOwnerActivityRequest(request, getOwnerActivityRouteDependencies());
}
