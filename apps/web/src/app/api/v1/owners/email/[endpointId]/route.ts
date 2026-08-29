import { handleRevokeVerificationEndpointRequest } from "@/server/identity-route-handlers";
import { getIdentityRouteDependencies } from "@/server/identity";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function DELETE(
  request: Request,
  context: { readonly params: Promise<{ readonly endpointId: string }> },
): Promise<Response> {
  return handleRevokeVerificationEndpointRequest(request, context, getIdentityRouteDependencies());
}
