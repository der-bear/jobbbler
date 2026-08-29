import { getIdentityRouteDependencies } from "@/server/identity";
import { handleStartOwnerRecoveryRequest } from "@/server/owner-privacy-route-handlers";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleStartOwnerRecoveryRequest(request, getIdentityRouteDependencies());
}
