import { handleStartEmailVerificationRequest } from "@/server/identity-route-handlers";
import { getIdentityRouteDependencies } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request): Promise<Response> {
  return handleStartEmailVerificationRequest(request, getIdentityRouteDependencies());
}
