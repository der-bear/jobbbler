import { handleListVerificationEndpointsRequest } from "@/server/identity-route-handlers";
import { getIdentityRouteDependencies } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request): Promise<Response> {
  return handleListVerificationEndpointsRequest(request, getIdentityRouteDependencies());
}
